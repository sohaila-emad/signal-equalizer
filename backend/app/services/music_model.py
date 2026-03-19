"""
music_model.py
--------------
HTDemucs source separation with band-slider control.
Features: 
  - Cache with 10-minute Auto-Clear (Memory Management)
  - Soft-Knee Limiter (Prevents Distortion)
  - Dynamic Spectral Analysis (Ground Truth detection)
"""

import numpy as np
import torch
import librosa
import os
import time
import warnings
warnings.filterwarnings("ignore")

# ── Band definitions aligned with modes.json ─────────────────────────────────
STEM_BAND_CONTRIBUTIONS = {
    "drums":  {"drums": 1.0},
    "bass":   {"bass": 1.0},
    "vocals": {"vocals": 1.0},
    "other":  {"other": 1.0},
}

BAND_ORDER = ["drums", "bass", "vocals", "other"]

# ── Singleton model ───────────────────────────────────────────────────────────
_model = None

def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model
        try:
            torch.set_num_threads(4)
            torch.set_num_interop_threads(2)
        except RuntimeError:
            pass  # threads already configured by another model
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
CACHE_TTL_SEC = 600

def _make_cache_key(audio: np.ndarray) -> tuple:
    n = len(audio)
    return (n, float(audio[0]), float(audio[n // 2]), float(audio[-1]))

def _get_stems(audio_44k: np.ndarray) -> dict:
    global _cache_key, _cache_stems, _cache_time
    key = _make_cache_key(audio_44k)
    current_time = time.time()

    if _cache_key == key and _cache_stems is not None:
        if current_time - _cache_time < CACHE_TTL_SEC:
            _cache_time = current_time
            print("   Using cached stems (TTL refreshed)")
            return _cache_stems

    _cache_stems = None 
    print("   Separating stems (first time or cache expired)...")
    model = _get_model()
    from demucs.apply import apply_model

    stereo = torch.tensor(np.stack([audio_44k, audio_44k], axis=0)).unsqueeze(0).float()
    with torch.no_grad():
        estimates = apply_model(model, stereo, shifts=0, overlap=0.1, split=True, progress=False)[0]

    stems = {
        name: estimates[i].mean(dim=0).cpu().numpy().astype(np.float32)
        for i, name in enumerate(model.sources)
    }
    _cache_key = key
    _cache_stems = stems
    _cache_time = current_time
    return stems


# ── New Analysis Function (The TA's requirement) ──────────────────────────────

def get_ai_footprint(stem_audio: np.ndarray, sr: int = 44100) -> dict:
    """Calculates the 90% energy bandwidth for the Manual EQ to sync with."""
    fft_vals = np.abs(np.fft.rfft(stem_audio))
    freqs = np.fft.rfftfreq(len(stem_audio), 1/sr)
    
    total_power = np.sum(fft_vals)
    if total_power < 1e-6:
        return {"min_hz": 0, "max_hz": 0}
        
    cum_power = np.cumsum(fft_vals)
    # Find indices for 5% and 95% of spectral energy
    low_idx = np.searchsorted(cum_power, total_power * 0.05)
    high_idx = np.searchsorted(cum_power, total_power * 0.95)
    
    return {
        "min_hz": int(freqs[low_idx]),
        "max_hz": int(freqs[high_idx])
    }


# ── Audio Processing Helpers ──────────────────────────────────────────────────

def compute_stem_gain(stem_name: str, band_weights: dict) -> float:
    return float(band_weights.get(stem_name, 1.0))

def _apply_soft_limiter(signal: np.ndarray, threshold: float = 0.95) -> np.ndarray:
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
    mixed = np.zeros(len(list(stems.values())[0]), dtype=np.float32)
    for stem_name, stem_audio in stems.items():
        gain = compute_stem_gain(stem_name, band_weights)
        mixed += gain * stem_audio
        print(f"    {stem_name:<10} gain={gain:.2f}")
    return _apply_soft_limiter(mixed, threshold=0.95)


# ── Main entry point (Updated to return Analysis) ─────────────────────────────

def process_from_array(signal: np.ndarray,
                       sr: int,
                       band_weights: dict) -> tuple:
    """
    Returns: (processed_signal, ai_analysis_results)
    """
    orig_len = len(signal)
    audio_44k = librosa.resample(signal.astype(np.float32), orig_sr=sr, target_sr=44100)
    
    # 1. Separate
    stems = _get_stems(audio_44k)

    # 2. Analyze (Calculate Ground Truth for the Manual EQ)
    ai_analysis = {}
    for name, audio in stems.items():
        ai_analysis[name] = get_ai_footprint(audio, 44100)

    # 3. Mix
    mixed = _mix(stems, band_weights)

    # 4. Cleanup and Resample
    result = librosa.resample(mixed, orig_sr=44100, target_sr=sr)
    if len(result) > orig_len:
        result = result[:orig_len]
    else:
        result = np.pad(result, (0, orig_len - len(result)))

    return result.astype(np.float32), ai_analysis