import numpy as np
from typing import Dict, Any, List

# Wavelet equalization import
import pywt

def apply_equalizer(
    signal: np.ndarray,
    sample_rate: float,
    bands: List[Dict[str, Any]],
    weights: Dict[str, float],
    mode: str = "generic"
) -> np.ndarray:
    """
    Applies high-precision filtering. 
    Boosted bands will grow visually until they hit the clipping limit (-1.0 to 1.0).
    """
    if not bands:
        return signal

    N_original = len(signal)
    
    # --- STEP 1: RESOLUTION STRATEGY ---
    # Surgical precision for ECG mode to target 60Hz hum accurately
    if mode == "ecg":
        n_fft = max(16384, N_original)
    else:
        n_fft = N_original

    # --- STEP 2: FFT ---
    spectrum = np.fft.rfft(signal, n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    equalized_spectrum = spectrum.copy()

    # --- STEP 3: APPLY GAINS ---
    for band in bands:
        band_id = band.get("id")
        gain = float(weights.get(band_id, 1.0))
        
        current_ranges = band.get("ranges") if band.get("ranges") else [band]
        
        for r in current_ranges:
            f_min = float(r.get("min_hz", 0.0))
            f_max = float(r.get("max_hz", sample_rate / 2.0))
            
            # Masking logic
            mask = (freqs >= f_min) & (freqs <= f_max)
            equalized_spectrum[mask] *= gain

    # --- STEP 4: INVERSE FFT ---
    equalized_signal = np.fft.irfft(equalized_spectrum, n=n_fft)
    
    # Crop back to original size if we padded n_fft
    equalized_signal = equalized_signal[:N_original]

    # --- STEP 5: CLIPPING PROTECTION (AS REQUESTED) ---
    # This allows spikes to grow taller visually. 
    # If they exceed the limit, they are 'flattened' at 1.0 to prevent error.
    equalized_signal = np.clip(equalized_signal, -1.0, 1.0)

    return equalized_signal.astype(np.float32)


# --- DWT-based Equalization ---
def apply_wavelet_equalizer(
    signal: np.ndarray,
    sample_rate: float,
    wavelet: str,
    levels: int,
    wavelet_weights: Dict[str, float],
) -> np.ndarray:
    """
    DWT-based equalization. Decomposes signal into `levels` levels using
    the specified wavelet, scales each level's coefficients by the
    corresponding weight, then reconstructs.
    wavelet_weights keys are "level_1", "level_2", ... "level_N"
    where level_1 = highest frequency detail coefficients.
    approximation coefficients key = "approx"
    """
    # Clamp levels to max allowed by signal length and wavelet
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(wavelet).dec_len)
    levels = min(levels, max_level)
    if levels < 1:
        levels = 1

    coeffs = pywt.wavedec(signal, wavelet, level=levels)
    # coeffs: [cA_n, cD_n, cD_{n-1}, ..., cD_1]
    scaled_coeffs = []
    for i, arr in enumerate(coeffs):
        if i == 0:
            # Approximation coefficients
            weight = float(wavelet_weights.get("approx", 1.0))
            scaled_coeffs.append(arr * weight)
        else:
            # Detail coefficients: cD_n is level_n, cD_1 is level_1
            level_id = f"level_{levels - i + 1}"
            weight = float(wavelet_weights.get(level_id, 1.0))
            scaled_coeffs.append(arr * weight)

    eq_signal = pywt.waverec(scaled_coeffs, wavelet)
    eq_signal = eq_signal[:len(signal)]  # Crop to original length
    eq_signal = np.clip(eq_signal, -1.0, 1.0)
    return eq_signal.astype(np.float32)