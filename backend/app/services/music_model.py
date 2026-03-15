"""
music_model.py
--------------
HTDemucs source separation with band-slider control.
Features: 
  - Cache with 10-minute Auto-Clear (Memory Management)
  - Soft-Knee Limiter (Prevents Distortion)
"""

import numpy as np
import torch
import librosa
import os
import time
import warnings
warnings.filterwarnings("ignore")

# ── Band definitions aligned with modes.json ─────────────────────────────────
# This maps the AI stems directly to your new JSON IDs: drums, bass, vocals, other
STEM_BAND_CONTRIBUTIONS = {
    "drums":  {"drums": 1.0},
    "bass":   {"bass": 1.0},
    "vocals": {"vocals": 1.0},
    "other":  {"other": 1.0},
}

# The order of weights coming from the frontend
BAND_ORDER = ["drums", "bass", "vocals", "other"]

# ── Singleton model ───────────────────────────────────────────────────────────
_model = None

def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model
        torch.set_num_threads(4)
        torch.set_num_interop_threads(2)
        print("🎵 Loading htdemucs (once)...")
        _model = get_model("htdemucs")   # 4-stem
        _model.eval()
        _model.to("cpu")
        print(f"   ✓ Sources: {_model.sources}")
    return _model


# ── Stem cache with Memory Management ────────────────────────────────────────
_cache_key   = None
_cache_stems = None   
_cache_time  = 0
CACHE_TTL_SEC = 600  # 10 minutes (Clears RAM if inactive)

def _make_cache_key(audio: np.ndarray) -> tuple:
    """Cheap key: length + 3 sample values. Fast and unique enough."""
    n = len(audio)
    return (n,
            float(audio[0]),
            float(audio[n // 2]),
            float(audio[-1]))

def _get_stems(audio_44k: np.ndarray) -> dict:
    """Return separated stems, using cache if same file and not expired."""
    global _cache_key, _cache_stems, _cache_time

    key = _make_cache_key(audio_44k)
    current_time = time.time()

    if _cache_key == key and _cache_stems is not None:
        if current_time - _cache_time < CACHE_TTL_SEC:
            _cache_time = current_time  # Refresh access time
            print("   Using cached stems (TTL refreshed)")
            return _cache_stems

    _cache_stems = None 
    print("   Separating stems (first time or cache expired)...")
    
    model = _get_model()
    from demucs.apply import apply_model

    stereo = torch.tensor(
        np.stack([audio_44k, audio_44k], axis=0)
    ).unsqueeze(0).float()

    with torch.no_grad():
        estimates = apply_model(
            model, stereo,
            shifts=0,       
            overlap=0.1,    
            split=True,
            progress=False,
        )[0]   

    stems = {
        name: estimates[i].mean(dim=0).cpu().numpy().astype(np.float32)
        for i, name in enumerate(model.sources)
    }

    _cache_key   = key
    _cache_stems = stems
    _cache_time  = current_time
    return stems


# ── Helpers & Audio Processing ───────────────────────────────────────────────

def compute_stem_gain(stem_name: str, band_weights: dict) -> float:
    """Maps the slider weight directly to the stem name."""
    return float(band_weights.get(stem_name, 1.0))


def _apply_soft_limiter(signal: np.ndarray, threshold: float = 0.95) -> np.ndarray:
    """Soft-knee limiter to prevent clipping/distortion."""
    peak = np.max(np.abs(signal))
    if peak <= threshold:
        return signal
    
    mask = np.abs(signal) > threshold
    signal[mask] = np.sign(signal[mask]) * (threshold + (peak - threshold) * np.tanh((np.abs(signal[mask]) - threshold) / (peak - threshold)))
    
    new_peak = np.max(np.abs(signal))
    if new_peak > 0.99:
        signal = signal / new_peak * 0.99
    return signal


def _mix(stems: dict, band_weights: dict) -> np.ndarray:
    """Apply stem-level gain then sum with Limiter. Removed broken BAND_RANGES logic."""
    mixed = np.zeros(len(list(stems.values())[0]), dtype=np.float32)
    for stem_name, stem_audio in stems.items():
        gain = compute_stem_gain(stem_name, band_weights)
        mixed += gain * stem_audio
        print(f"    {stem_name:<10} gain={gain:.2f}")

    mixed = _apply_soft_limiter(mixed, threshold=0.95)
    return mixed


# ── Main entry point ──────────────────────────────────────────────────────────

def process_from_array(signal: np.ndarray,
                       sr: int,
                       band_weights: dict) -> np.ndarray:
    """
    Called by your route on every slider change.
    """
    orig_len  = len(signal)

    # 1. Resample to 44100 Hz for HTDemucs
    audio_44k = librosa.resample(signal.astype(np.float32),
                                 orig_sr=sr, target_sr=44100)

    # 2. Get stems — cached with TTL memory management
    stems = _get_stems(audio_44k)

    # 3. Mix with band weights and Soft Limiter
    mixed = _mix(stems, band_weights)

    # 4. Resample back to app sr
    result = librosa.resample(mixed, orig_sr=44100, target_sr=sr)

    # 5. Match original length
    if len(result) > orig_len:
        result = result[:orig_len]
    else:
        result = np.pad(result, (0, orig_len - len(result)))

    return result.astype(np.float32)