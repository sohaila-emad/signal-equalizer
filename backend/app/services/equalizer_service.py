import numpy as np
from typing import Dict, Any, List
import os

# Wavelet equalization import
import pywt

# Try to import librosa for STFT (preferred), fallback to numpy
try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

# Map frontend band IDs to notebook animal names
# Animal 1: dog, Animal 2: cow, Animal 3: bird, Animal 4: cat
ANIMAL_ID_MAP = {
    'dog': 'Animal 1',
    'cow': 'Animal 2',
    'bird': 'Animal 3',
    'cat': 'Animal 4',
}


def _make_smooth_mask(freqs: np.ndarray, f_min: float, f_max: float) -> np.ndarray:
    """
    Builds a gain mask with cosine roll-off at each edge instead of a hard cut.
    """
    mask = np.zeros(len(freqs))
    band_width = f_max - f_min
    transition = np.clip(band_width * 0.05, 20.0, 200.0)

    for i, f in enumerate(freqs):
        if f < f_min - transition or f > f_max + transition:
            mask[i] = 0.0
        elif f > f_min + transition and f < f_max - transition:
            mask[i] = 1.0
        elif f <= f_min + transition:
            t = (f - (f_min - transition)) / (2 * transition)
            mask[i] = 0.5 * (1 - np.cos(np.pi * t))
        else:
            t = (f - (f_max - transition)) / (2 * transition)
            mask[i] = 0.5 * (1 + np.cos(np.pi * t))

    return mask


def _soft_clip(signal: np.ndarray, threshold: float = 0.95) -> np.ndarray:
    """
    Tanh soft clipping for smooth peak limiting.
    """
    scale = np.abs(signal).max()
    if scale < 1e-9:
        return signal
    normalized = signal / scale
    clipped = np.where(
        np.abs(normalized) <= threshold,
        normalized,
        np.sign(normalized) * (threshold + (1 - threshold) * np.tanh(
            (np.abs(normalized) - threshold) / (1 - threshold)
        ))
    )
    return (clipped * scale).astype(np.float32)


# ── Load Wiener data at startup ───────────────────────────────────────
_WIENER_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wiener_gains_animals.npz')

# Data containers
WIENER_MASKS = None       # Full per-frame masks (4, freq_bins, time_frames)
WIENER_ANIMAL_NAMES = []  # ['Animal 1', 'Animal 2', ...]
WIENER_GAINS = {}         # Averaged fallback gains
WIENER_META = {}          # Per-animal metadata
WIENER_STFT_PARAMS = {}   # {n_fft, hop_length, sample_rate}

if os.path.exists(_WIENER_PATH):
    try:
        _data = np.load(_WIENER_PATH, allow_pickle=True)

        # Full masks (preferred)
        if 'masks' in _data:
            WIENER_MASKS = _data['masks']
            WIENER_ANIMAL_NAMES = list(_data['animal_names'])
            WIENER_STFT_PARAMS = {
                'n_fft': int(_data['n_fft']),
                'hop_length': int(_data['hop_length']),
                'sample_rate': int(_data['sample_rate']),
            }
            print(f"[INFO] Loaded full Wiener masks: {WIENER_MASKS.shape}")

        # Averaged gains (fallback)
        if 'gains' in _data:
            WIENER_GAINS = _data['gains'].item()

        # Metadata
        if 'meta' in _data:
            WIENER_META = _data['meta'].item()

    except Exception as e:
        print(f"[WARNING] Failed to load Wiener data: {e}")
else:
    print(f"[WARNING] Wiener gains file not found: {_WIENER_PATH}")


def apply_equalizer(
    signal: np.ndarray,
    sample_rate: float,
    bands: List[Dict[str, Any]],
    weights: Dict[str, float],
    mode: str = "generic"
) -> np.ndarray:
    """
    FFT/STFT-based equalizer with Wiener soft-mask support.

    For animal mode with full masks: Uses per-frame soft-mask equalization (best quality).
    For animal mode with averaged gains: Uses single-FFT with interpolated curves.
    For other modes: Applies flat gain to frequency bands with smooth edges.
    """
    if not bands:
        return signal

    N_original = len(signal)

    # Check if we can use full soft-mask EQ (requires full masks + librosa)
    # Detect animal mode by checking if bands contain animal IDs
    has_animal_bands = any(band.get("id") in ANIMAL_ID_MAP for band in bands)

    use_full_softmask = (
        WIENER_MASKS is not None and
        HAS_LIBROSA and
        has_animal_bands and
        any(ANIMAL_ID_MAP.get(band.get("id")) in WIENER_ANIMAL_NAMES for band in bands)
    )

    # DEBUG
    print(f"[EQ DEBUG] mode={mode}, has_animal_bands={has_animal_bands}, use_full_softmask={use_full_softmask}")
    print(f"[EQ DEBUG] WIENER_MASKS loaded: {WIENER_MASKS is not None}")
    print(f"[EQ DEBUG] bands: {[b.get('id') for b in bands]}")
    print(f"[EQ DEBUG] weights: {weights}")

    if use_full_softmask:
        print("[EQ DEBUG] Using FULL SOFT-MASK path")
        return _apply_softmask_eq(signal, sample_rate, bands, weights)
    else:
        print("[EQ DEBUG] Using FFT fallback path")
        return _apply_fft_eq(signal, sample_rate, bands, weights, mode)


def _apply_softmask_eq(
    signal: np.ndarray,
    sample_rate: float,
    bands: List[Dict[str, Any]],
    weights: Dict[str, float],
) -> np.ndarray:
    """
    Per-frame soft-mask equalization using STFT (high quality).

    eq_gain[freq, time] = Σ (mask_i[freq, time] * gain_i)
    """
    n_fft = WIENER_STFT_PARAMS['n_fft']
    hop_length = WIENER_STFT_PARAMS['hop_length']
    stored_sr = WIENER_STFT_PARAMS['sample_rate']

    original_sr = int(sample_rate)
    original_len = len(signal)

    # Resample signal to stored sample rate if needed
    if original_sr != stored_sr:
        print(f"[SOFTMASK DEBUG] Resampling {original_sr} -> {stored_sr}")
        signal = librosa.resample(signal, orig_sr=original_sr, target_sr=stored_sr)

    # Compute STFT of input
    D = librosa.stft(signal, n_fft=n_fft, hop_length=hop_length)
    n_freq_bins, n_time_frames = D.shape

    # Get stored masks
    masks = WIENER_MASKS  # shape: (n_animals, freq_bins, stored_time_frames)
    stored_time_frames = masks.shape[2]

    # Interpolate masks to match input time frames if needed
    if n_time_frames != stored_time_frames:
        # Linear interpolation along time axis
        from scipy.ndimage import zoom
        zoom_factor = n_time_frames / stored_time_frames
        masks_interp = np.zeros((masks.shape[0], n_freq_bins, n_time_frames))
        for i in range(masks.shape[0]):
            masks_interp[i] = zoom(masks[i], (1.0, zoom_factor), order=1)
        masks = masks_interp

    # Build gain array for each animal
    n_animals = len(WIENER_ANIMAL_NAMES)
    gains_lin = np.ones(n_animals)

    for band in bands:
        band_id = band.get("id")
        notebook_name = ANIMAL_ID_MAP.get(band_id, band_id)
        if notebook_name in WIENER_ANIMAL_NAMES:
            idx = WIENER_ANIMAL_NAMES.index(notebook_name)
            user_gain = float(weights.get(band_id, 1.0))
            gains_lin[idx] = user_gain
            print(f"[SOFTMASK DEBUG] {band_id} -> {notebook_name} idx={idx} gain={user_gain}")

    print(f"[SOFTMASK DEBUG] Final gains_lin: {gains_lin}")

    # Compute per-cell weighted gain: eq_gain[f,t] = Σ (mask_i[f,t] * gain_i)
    # Using einsum for efficiency
    eq_gain = np.einsum('i,ift->ft', gains_lin, masks)  # (freq, time)

    # Apply gain to STFT
    D_out = D * eq_gain

    # Reconstruct with ISTFT
    y_out = librosa.istft(D_out, hop_length=hop_length, n_fft=n_fft, length=len(signal))

    # Resample back to original sample rate if needed
    if original_sr != stored_sr:
        print(f"[SOFTMASK DEBUG] Resampling back {stored_sr} -> {original_sr}")
        y_out = librosa.resample(y_out, orig_sr=stored_sr, target_sr=original_sr)
        # Ensure output length matches input length
        if len(y_out) > original_len:
            y_out = y_out[:original_len]
        elif len(y_out) < original_len:
            y_out = np.pad(y_out, (0, original_len - len(y_out)))

    # Soft clip
    y_out = _soft_clip(y_out)

    return y_out.astype(np.float32)


def _apply_fft_eq(
    signal: np.ndarray,
    sample_rate: float,
    bands: List[Dict[str, Any]],
    weights: Dict[str, float],
    mode: str
) -> np.ndarray:
    """
    Single-FFT equalization with Hanning window (fallback mode).
    """
    N_original = len(signal)

    # Use larger FFT for ECG (better frequency resolution)
    n_fft = max(16384, N_original) if mode == "ecg" else N_original

    # Apply Hanning window
    window = np.hanning(N_original)
    windowed_signal = signal * window

    # FFT
    spectrum = np.fft.rfft(windowed_signal, n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    equalized_spectrum = spectrum.copy()

    for band in bands:
        band_id = band.get("id")
        user_gain = float(weights.get(band_id, 1.0))

        # Check for Wiener gains (try mapped name first, then original)
        notebook_name = ANIMAL_ID_MAP.get(band_id, band_id)
        wiener_key = notebook_name if notebook_name in WIENER_GAINS else (band_id if band_id in WIENER_GAINS else None)

        if wiener_key:
            # Use averaged Wiener gain curve
            stored_curve = WIENER_GAINS[wiener_key]
            meta = WIENER_META.get(wiener_key, {})
            stored_sr = meta.get('sample_rate', 22050)
            stored_freqs = np.linspace(0, stored_sr / 2, len(stored_curve))

            # Interpolate to current frequency resolution
            gain_curve = np.interp(freqs, stored_freqs, stored_curve)

            # Apply user gain modulation
            shaped = 1.0 + (gain_curve - 1.0) * user_gain
            equalized_spectrum *= shaped.astype(np.complex64)
        else:
            # Flat gain with smooth edges
            current_ranges = band.get("ranges") if band.get("ranges") else [band]
            for r in current_ranges:
                f_min = float(r.get("min_hz", 0.0))
                f_max = float(r.get("max_hz", sample_rate / 2.0))

                smooth_mask = _make_smooth_mask(freqs, f_min, f_max)
                equalized_spectrum *= (1.0 + smooth_mask * (user_gain - 1.0))

    # IFFT
    equalized_signal = np.fft.irfft(equalized_spectrum, n=n_fft)[:N_original]

    # Window compensation
    window_compensation = np.where(window > 1e-6, 1.0 / window, 1.0)
    equalized_signal *= window_compensation

    # Soft clip
    equalized_signal = _soft_clip(equalized_signal)

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
    DWT-based equalization using wavelet decomposition.
    """
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(wavelet).dec_len)
    levels = min(levels, max_level)
    if levels < 1:
        levels = 1

    coeffs = pywt.wavedec(signal, wavelet, level=levels)
    scaled_coeffs = []

    for i, arr in enumerate(coeffs):
        if i == 0:
            weight = float(wavelet_weights.get("approx", 1.0))
            scaled_coeffs.append(arr * weight)
        else:
            level_id = f"level_{levels - i + 1}"
            weight = float(wavelet_weights.get(level_id, 1.0))
            scaled_coeffs.append(arr * weight)

    eq_signal = pywt.waverec(scaled_coeffs, wavelet)
    eq_signal = eq_signal[:len(signal)]
    eq_signal = np.clip(eq_signal, -1.0, 1.0)
    return eq_signal.astype(np.float32)
