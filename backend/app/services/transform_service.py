import numpy as np
from typing import Dict, Any, List, Tuple


def compute_spectrogram(
    signal: np.ndarray,
    sample_rate: float,
    window_size: int = 1024, 
    target_points: int = 800,
) -> Tuple[List[float], List[float], List[List[float]]]:
    
    N = len(signal)
    
    # --- AUTO-ADJUST FOR ECG / LOW SAMPLE RATE ---
    # If it's 100Hz, a 1024 window is 10 seconds (Too Big!).
    # We shrink it to 256 (2.5 seconds) or 128 (1.2 seconds).
    if sample_rate <= 200:
        window_size = 256 
        # We also need more 'target_points' for ECG to see individual beats
        target_points = max(target_points, 1000)
    
    # Safety check for very short signals
    if N < window_size:
        window_size = 2**int(np.log2(N)) if N > 2 else 2

    # --- PADDING FOR 0.0s START ---
    pad_amount = window_size // 2
    padded_signal = np.pad(signal, (pad_amount, pad_amount), mode='edge')
    
    # --- DYNAMIC HOP SIZE ---
    # hop_size determines the 'Time Resolution'
    hop_size = max(1, N // target_points)
    
    window = np.hanning(window_size)
    frames = []
    times = []

    # --- THE SLIDING WINDOW ---
    # We use len(padded_signal) to ensure we don't cut off the end
    for start in range(0, len(padded_signal) - window_size + 1, hop_size):
        segment = padded_signal[start : start + window_size] * window
        
        # FFT Math
        spectrum = np.fft.rfft(segment)
        mag = np.abs(spectrum)
        
        frames.append(mag)
        # Fix: Dividing start by sample_rate gives exactly 0.0s for the first frame
        times.append(start / sample_rate)

    if not frames:
        return [], [], []

    # --- POST-PROCESSING ---
    S = np.stack(frames, axis=1)
    freqs = np.fft.rfftfreq(window_size, d=1.0 / sample_rate)

    # Log scale (dB) 
    S_db = np.clip(20.0 * np.log10(S + 1e-5), -100, 0)

    # Final decimation for UI performance
    row_step = max(1, S_db.shape[0] // 256) 
    
    return (
        freqs[::row_step].tolist(), 
        times, 
        S_db[::row_step, :].tolist()
    )


def compute_fft_magnitude(
    signal: np.ndarray,
    sample_rate: float,
    max_fft_bins: int = 2048,
) -> Tuple[List[float], List[float]]:
    """
    Computes the FFT of the entire signal, then downsamples the 
    result so the frontend doesn't have to render 100,000 points.
    """
    N = len(signal)
    
    # We use rfft on the whole signal
    spectrum = np.fft.rfft(signal)
    magnitude = np.abs(spectrum)
    freqs = np.fft.rfftfreq(N, d=1.0 / sample_rate)

    # Downsample the frequency bins for the UI
    # This ensures we don't send more than 2048 points to the graph
    step = max(1, len(magnitude) // max_fft_bins)
    
    return freqs[::step].tolist(), magnitude[::step].tolist()


# --- Wavelet Level Frequency Ranges Helper ---
def compute_wavelet_level_ranges(
    sample_rate: float,
    wavelet: str,
    levels: int,
    band_labels: Dict[str, str] | None = None,
    mode: str = "generic",
) -> List[Dict[str, Any]]:
    """
    Returns a list of dicts for each DWT level with id, label, min_hz, max_hz.

    For human/animal modes with Wiener masks, returns 4 source-based bands.
    For other modes, returns level-based bands:
    min_hz = sample_rate / 2**(level+1)
    max_hz = sample_rate / 2**level
    Level 1 = highest frequency detail coefficients.
    """
    bands = []
    band_labels = band_labels or {}

    # Human mode with Wiener wavelet masks - return source-based bands
    if mode == "human":
        human_sources = [
            ("man", "Man Voice", 85, 180),
            ("woman", "Woman Voice", 165, 255),
            ("child", "Child Voice", 250, 400),
            ("elderly", "Elderly Voice", 100, 200),
        ]
        for src_id, default_label, min_hz, max_hz in human_sources:
            bands.append({
                "id": src_id,
                "label": band_labels.get(src_id, default_label),
                "min_hz": float(min_hz),
                "max_hz": float(max_hz),
            })
        return bands

    # Animal mode with Wiener wavelet masks - return source-based bands
    if mode == "animal":
        animal_sources = [
            ("dog", "Dog Voice", 67, 1000),
            ("cat", "Cat Voice", 45, 1500),
            ("cow", "Cow Voice", 20, 500),
            ("bird", "Bird Voice", 1000, 8000),
        ]
        for src_id, default_label, min_hz, max_hz in animal_sources:
            bands.append({
                "id": src_id,
                "label": band_labels.get(src_id, default_label),
                "min_hz": float(min_hz),
                "max_hz": float(max_hz),
            })
        return bands

    # Generic mode - level-based bands
    for level in range(1, levels + 1):
        min_hz = sample_rate / (2 ** (level + 1))
        max_hz = sample_rate / (2 ** level)
        bands.append({
            "id": f"level_{level}",
            "label": band_labels.get(f"level_{level}", f"Level {level}"),
            "min_hz": min_hz,
            "max_hz": max_hz
        })
    # Approximation band (lowest frequencies)
    min_hz = 0.0
    max_hz = sample_rate / (2 ** (levels + 1))
    bands.append({
        "id": "approx",
        "label": band_labels.get("approx", "Approx"),
        "min_hz": min_hz,
        "max_hz": max_hz
    })
    return bands
