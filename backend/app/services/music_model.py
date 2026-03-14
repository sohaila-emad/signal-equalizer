"""
music_model.py
--------------
HTDemucs source separation with band-slider control.

Performance strategy:
  - Stem separation is cached per unique audio file (heavy, once only)
  - Slider changes only re-run the fast mix step (no neural net)
  - shifts=0, overlap=0.1 for fastest CPU inference
  - htdemucs (4-stem) — lighter than htdemucs_6s
"""

import numpy as np
import torch
import librosa
import os
import warnings
warnings.filterwarnings("ignore")

# ── Band definitions from modes.json ─────────────────────────────────────────
BAND_RANGES = {
    "sub":        (20,    60),
    "bass":       (60,    250),
    "low_mid":    (250,   1000),
    "high_mid":   (1000,  4000),
    "presence":   (4000,  6000),
    "brilliance": (6000,  20000),
}

STEM_BAND_CONTRIBUTIONS = {
    #              sub   bass  low_mid  high_mid  presence  brilliance
    "bass":       [0.6,  0.4,  0.0,    0.0,      0.0,      0.0],
    "drums":      [0.2,  0.3,  0.2,    0.1,      0.0,      0.2],
    "vocals":     [0.0,  0.0,  0.1,    0.5,      0.3,      0.1],
    "other":      [0.0,  0.1,  0.3,    0.3,      0.2,      0.1],
}

BAND_ORDER = ["sub", "bass", "low_mid", "high_mid", "presence", "brilliance"]


# ── Singleton model ───────────────────────────────────────────────────────────
_model = None

def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model
        torch.set_num_threads(4)
        torch.set_num_interop_threads(2)
        print("🎵 Loading htdemucs (once)...")
        _model = get_model("htdemucs")   # 4-stem, lighter than 6s
        _model.eval()
        _model.to("cpu")
        print(f"   ✓ Sources: {_model.sources}")
    return _model


# ── Stem cache — separation runs once per unique file ────────────────────────
_cache_key   = None
_cache_stems = None   # dict: stem_name → mono float32 at 44100 Hz

def _make_cache_key(audio: np.ndarray) -> tuple:
    """Cheap key: length + 3 sample values. Fast and unique enough."""
    n = len(audio)
    return (n,
            float(audio[0]),
            float(audio[n // 2]),
            float(audio[-1]))

def _get_stems(audio_44k: np.ndarray) -> dict:
    """Return separated stems, using cache if same file."""
    global _cache_key, _cache_stems

    key = _make_cache_key(audio_44k)
    if _cache_key == key and _cache_stems is not None:
        print("  Using cached stems (no separation needed)")
        return _cache_stems

    print("  Separating stems (first time for this file)...")
    model = _get_model()
    from demucs.apply import apply_model

    stereo = torch.tensor(
        np.stack([audio_44k, audio_44k], axis=0)
    ).unsqueeze(0).float()

    with torch.no_grad():
        estimates = apply_model(
            model, stereo,
            shifts=0,       # single pass — fastest on CPU
            overlap=0.1,    # minimal overlap
            split=True,
            progress=False,
        )[0]   # (n_sources, 2, samples)

    stems = {
        name: estimates[i].mean(dim=0).cpu().numpy().astype(np.float32)
        for i, name in enumerate(model.sources)
    }

    _cache_key   = key
    _cache_stems = stems
    return stems


# ── Helpers ───────────────────────────────────────────────────────────────────

def compute_stem_gain(stem_name: str, band_weights: dict) -> float:
    """Weighted average of band sliders → single gain for this stem."""
    contributions = STEM_BAND_CONTRIBUTIONS.get(stem_name, [1/6] * 6)
    total = sum(contributions)
    if total < 1e-8:
        return 1.0
    return sum(
        contributions[i] * float(band_weights.get(bid, 1.0))
        for i, bid in enumerate(BAND_ORDER)
    ) / total


def _apply_eq(stem: np.ndarray, sr: int, band_weights: dict) -> np.ndarray:
    """
    Apply frequency band EQ to a mono stem.
    This shapes the frequency content WITHIN the stem —
    different from the stem-level gain which scales the whole stem.
    Together they give both coarse (stem gain) and fine (EQ) control.
    """
    fft   = np.fft.rfft(stem)
    freqs = np.fft.rfftfreq(len(stem), d=1.0 / sr)
    for band_id, (lo, hi) in BAND_RANGES.items():
        w = float(band_weights.get(band_id, 1.0))
        if w != 1.0:
            fft[(freqs >= lo) & (freqs < hi)] *= w
    return np.fft.irfft(fft, n=len(stem)).astype(np.float32)


def _mix(stems: dict, band_weights: dict, sr: int = 44100) -> np.ndarray:
    """
    Apply stem-level gain + per-stem EQ then sum.
    This is the fast step — runs on every slider change.
    """
    mixed = np.zeros(len(list(stems.values())[0]), dtype=np.float32)
    for stem_name, stem_audio in stems.items():
        gain     = compute_stem_gain(stem_name, band_weights)
        stem_eq  = _apply_eq(stem_audio, sr, band_weights)
        mixed   += gain * stem_eq
        print(f"    {stem_name:<10} gain={gain:.2f}")

    peak = np.max(np.abs(mixed))
    if peak > 1.0:
        mixed = mixed / peak * 0.99
    return mixed


# ── Main entry point ──────────────────────────────────────────────────────────

def process_from_array(signal: np.ndarray,
                       sr: int,
                       band_weights: dict) -> np.ndarray:
    """
    Called by your route on every slider change.

    First call for a new file: separates stems (~15-30s on CPU), caches them.
    Subsequent calls (slider moves): only runs _mix() which is instant.

    Args:
        signal      : mono float32 at sr Hz (11025 from your app)
        sr          : sample rate
        band_weights: {"sub":1.0, "bass":0.5, ...}

    Returns:
        processed mono float32 at sr Hz, same length as input
    """
    orig_len  = len(signal)

    # 1. Resample to 44100 Hz for HTDemucs
    audio_44k = librosa.resample(signal.astype(np.float32),
                                  orig_sr=sr, target_sr=44100)

    # 2. Get stems — heavy only on first call, cached after
    stems = _get_stems(audio_44k)

    # 3. Mix with band weights — always fast
    mixed = _mix(stems, band_weights, sr=44100)

    # 4. Resample back to app sr
    result = librosa.resample(mixed, orig_sr=44100, target_sr=sr)

    # 5. Match original length
    if len(result) > orig_len:
        result = result[:orig_len]
    else:
        result = np.pad(result, (0, orig_len - len(result)))

    return result.astype(np.float32)