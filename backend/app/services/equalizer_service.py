import numpy as np
from typing import Dict, Any, List


def apply_equalizer(
    signal: np.ndarray,
    sample_rate: float,
    bands: List[Dict[str, Any]],
    weights: Dict[str, float],
) -> np.ndarray:
    """
    Apply band-gain equalization using np.fft.rfft and np.fft.irfft.

    Parameters
    ----------
    signal : np.ndarray
        Time-domain signal.
    sample_rate : float
        Sampling rate in Hz.
    bands : List[Dict]
        List of band dictionaries with keys: id, min_hz, max_hz.
    weights : Dict[str, float]
        Mapping from band id -> gain multiplier.

    Returns
    -------
    np.ndarray
        Equalized time-domain signal.
    """
    if not bands:
        return signal

    # Use rfft for real-valued signals (more efficient)
    spectrum = np.fft.rfft(signal)
    N = len(signal)
    freqs = np.fft.rfftfreq(N, d=1.0 / sample_rate)

    equalized_spectrum = spectrum.copy()

    for band in bands:
        band_id = band.get("id")
        if band_id is None:
            continue
        gain = float(weights.get(band_id, 1.0))
        f_min = float(band.get("min_hz", 0.0))
        f_max = float(band.get("max_hz", sample_rate / 2.0))

        # Apply gain to frequencies in this band
        mask = (freqs >= f_min) & (freqs < f_max)
        equalized_spectrum[mask] *= gain

    # Convert back to time domain
    equalized_signal = np.fft.irfft(equalized_spectrum, n=N)
    return equalized_signal.astype(np.float32)
