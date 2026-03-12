import numpy as np
from typing import Dict, Any, List

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