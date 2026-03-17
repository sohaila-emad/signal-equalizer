import numpy as np
from typing import Dict, Any, List, Tuple


def compute_spectrogram(
    signal: np.ndarray,
    sample_rate: float,
    window_size: int = 1024, # Slightly larger for better freq resolution
    target_points: int = 800, # Target number of time columns to send to UI
) -> Tuple[List[float], List[float], List[List[float]]]:
    """
    Dynamically adjusts hop_size to ensure the spectrogram covers the full signal
    without exceeding memory limits.
    """
    N = len(signal)
    if N < window_size:
        # Fallback for very short signals
        window_size = 2**int(np.log2(N)) if N > 2 else 2
        
    # --- DYNAMIC HOP SIZE ---
    # We want (N / hop_size) to be roughly target_points
    hop_size = max(window_size // 4, N // target_points)
    
    window = np.hanning(window_size)
    frames = []
    times = []

    # Slide through the WHOLE signal
    for start in range(0, N - window_size + 1, hop_size):
        end = start + window_size
        segment = signal[start:end] * window
        
        # Compute magnitude spectrum
        spectrum = np.fft.rfft(segment)
        mag = np.abs(spectrum)
        
        frames.append(mag)
        times.append((start + window_size / 2) / sample_rate)

    if not frames:
        return [], [], []

    # Stack: Rows = Freq, Cols = Time
    S = np.stack(frames, axis=1)
    freqs = np.fft.rfftfreq(window_size, d=1.0 / sample_rate)

    # Log scale (dB) - Clip at -100dB to avoid log(0)
    S_db = np.clip(20.0 * np.log10(S + 1e-5), -100, 0)

    # Final decimation: If we still have too many frequency bins (rows), 
    # we take every 2nd or 4th bin to keep UI snappy.
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
) -> List[Dict[str, Any]]:
    """
    Returns a list of dicts for each DWT level with id, label, min_hz, max_hz.
    min_hz = sample_rate / 2**(level+1)
    max_hz = sample_rate / 2**level
    Level 1 = highest frequency detail coefficients.
    """
    bands = []
    band_labels = band_labels or {}
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
