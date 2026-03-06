import numpy as np
from typing import Dict, Any, List, Tuple


def compute_spectrogram(
    signal: np.ndarray,
    sample_rate: float,
    window_size: int = 512,
    hop_size: int = 256,
    max_samples: int = 16384,
) -> Tuple[List[float], List[float], List[List[float]]]:
    """
    Compute spectrogram using np.fft and return in dB scale.

    Parameters
    ----------
    signal : np.ndarray
        Time-domain signal.
    sample_rate : float
        Sampling rate in Hz.
    window_size : int
        FFT window size.
    hop_size : int
        Number of samples between successive windows.
    max_samples : int
        Maximum number of samples to process for performance.

    Returns
    -------
    Tuple[List[float], List[float], List[List[float]]]
        (frequencies, times, spectrogram_db)
    """
    sig = signal[:max_samples]
    N = len(sig)
    
    if N < window_size:
        raise ValueError("Signal too short for spectrogram")

    window = np.hanning(window_size)
    frames = []
    times = []

    for start in range(0, N - window_size + 1, hop_size):
        end = start + window_size
        segment = sig[start:end] * window
        
        # Use np.fft for spectrogram computation
        spectrum = np.fft.rfft(segment)
        frames.append(np.abs(spectrum))
        times.append((start + window_size / 2) / sample_rate)

    if not frames:
        raise ValueError("No frames generated")

    S = np.stack(frames, axis=1)  # shape: (freq_bins, num_frames)
    freqs = np.fft.rfftfreq(window_size, d=1.0 / sample_rate)

    # Convert to dB
    S_db = 20.0 * np.log10(np.abs(S) + 1e-6)

    # Downsample for payload size
    f_ds = freqs[::2]
    t_ds = np.array(times)[::2]
    S_ds = S_db[::2, ::2]

    return f_ds.tolist(), t_ds.tolist(), S_ds.tolist()


def compute_fft_magnitude(
    signal: np.ndarray,
    sample_rate: float,
    fft_size: int = 1024,
) -> Tuple[List[float], List[float]]:
    """
    Compute FFT magnitude spectrum using np.fft.

    Parameters
    ----------
    signal : np.ndarray
        Time-domain signal.
    sample_rate : float
        Sampling rate in Hz.
    fft_size : int
        FFT size.

    Returns
    -------
    Tuple[List[float], List[float]]
        (frequencies, magnitudes)
    """
    # Take the first fft_size samples, pad if necessary
    block = signal[:fft_size]
    if len(block) < fft_size:
        block = np.pad(block, (0, fft_size - len(block)))

    # Use np.fft.rfft for real signals
    spectrum = np.fft.rfft(block)
    magnitude = np.abs(spectrum)
    freqs = np.fft.rfftfreq(fft_size, d=1.0 / sample_rate)

    return freqs.tolist(), magnitude.tolist()
