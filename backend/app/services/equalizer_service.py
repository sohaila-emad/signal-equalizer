import numpy as np
from typing import Dict, Any, List
import os

import pywt

try:
    import librosa
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False

ANIMAL_ID_MAP = {
    'dog':  'Animal 1',
    'cow':  'Animal 2',
    'bird': 'Animal 3',
    'cat':  'Animal 4',
}

HUMAN_ID_MAP = {
    'man': 'Man',
    'woman': 'Woman',
    'child': 'Child',
    'elderly': 'Elderly',
}

# ── ECG band definitions ──────────────────────────────────────────────────────
ECG_CLASS_ORDER = ['norm', 'mi', 'sttc', 'cd']

ECG_BANDS = {
    'norm': (0.05,  2.0),
    'mi':   (0.5,   4.0),
    'sttc': (20.0, 50.0),
    'cd':   (8.0,  22.0),
}
ECG_BAND_IDS = set(ECG_CLASS_ORDER)


def _build_ecg_masks(freqs: np.ndarray, sigma_hz: float = 1.5):
    from scipy.ndimage import gaussian_filter1d
    nyquist    = freqs[-1]
    df         = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0
    sigma_bins = max(1.0, sigma_hz / df)
    K   = len(freqs)
    raw = np.zeros((4, K), dtype=np.float64)
    for i, cls in enumerate(ECG_CLASS_ORDER):
        f_lo, f_hi = ECG_BANDS[cls]
        f_hi = min(f_hi, nyquist)
        raw[i] = ((freqs >= f_lo) & (freqs < f_hi)).astype(np.float64)
        raw[i] = gaussian_filter1d(raw[i], sigma=sigma_bins, mode='constant', cval=0.0)
    dead = np.sum(raw, axis=0) < 1e-10
    return raw.astype(np.float32), dead


def get_ecg_band_signals(signal: np.ndarray, sample_rate: float) -> dict:
    N = len(signal)
    if N < 4:
        return {}
    n_fft    = int(2 ** np.ceil(np.log2(max(N, 1024))))
    spectrum = np.fft.rfft(signal.astype(np.float64), n=n_fft)
    freqs    = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    masks, _ = _build_ecg_masks(freqs)
    result   = {}
    for i, cls in enumerate(ECG_CLASS_ORDER):
        isolated    = np.fft.irfft(spectrum * masks[i].astype(np.float64), n=n_fft)[:N]
        result[cls] = isolated.astype(np.float32).tolist()
    return result


def _find_r_peaks(signal: np.ndarray, sr: float = 100.0) -> np.ndarray:
    if len(signal) < 10:
        return np.array([], dtype=int)
    mean_v   = float(signal.mean())
    max_v    = float(signal.max())
    thr      = mean_v + 0.4 * (max_v - mean_v)
    min_dist = max(int(sr * 0.25), 10)
    peaks    = []
    for i in range(1, len(signal) - 1):
        if signal[i] > thr and signal[i] > signal[i-1] and signal[i] > signal[i+1]:
            if not peaks or i - peaks[-1] > min_dist:
                peaks.append(i)
    return np.array(peaks, dtype=int)


def _apply_ecg_morphological_eq(
    signal:      np.ndarray,
    sample_rate: float,
    weights:     dict,
) -> np.ndarray:
    from scipy.ndimage import gaussian_filter1d

    sr  = float(sample_rate)
    sig = signal.astype(np.float64)
    N   = len(sig)
    out = sig.copy()

    g_norm = float(weights.get('norm', weights.get('NORM', 1.0)))
    g_mi   = float(weights.get('mi',   weights.get('MI',   1.0)))
    g_sttc = float(weights.get('sttc', weights.get('STTC', 1.0)))
    g_cd   = float(weights.get('cd',   weights.get('CD',   1.0)))

    peaks = _find_r_peaks(sig, sr)
    if len(peaks) == 0:
        return sig.astype(np.float32)

    # --- NEW ADAPTIVE LOGIC START ---
    # Calculate average RR interval to adjust windows for fast/slow heart rates
    if len(peaks) > 1:
        avg_rr_samples = np.mean(np.diff(peaks))
        # We use a 1.0s (60bpm) baseline for your original constants
        # This ratio shrinks or expands the windows based on real speed
        ratio = min(1.5, max(0.5, avg_rr_samples / sr)) 
    else:
        ratio = 1.0 # Fallback if only one peak is found
    
    # We multiply your original constants by the 'ratio' so they stay proportional
    iso_pre_s = int(sr * 0.25 * ratio)
    iso_pre_e = int(sr * 0.15 * ratio)
    qrs_pre   = int(sr * 0.04 * ratio)
    qrs_post  = int(sr * 0.05 * ratio)
    # MI Targets the early "shelf" (The J-point and immediate ST)
    j_off     = int(sr * 0.02 * ratio) # Start earlier
    st_end    = int(sr * 0.08 * ratio) # End earlier to avoid the T-wave

    # STTC Targets the "Slope" into the T-wave
    t_start   = int(sr * 0.09 * ratio) # Move this closer to the ST-segment
    t_end     = int(sr * 0.25 * ratio) # Shorten this so it doesn't grab the whole tail
    # --- NEW ADAPTIVE LOGIC END ---

    cd_sigma  = max(1.0, sr / 50.0)

    for p in peaks:
        # 1. Find the Baseline (Isoelectric Line)
        i_s = max(0, p - iso_pre_s)
        i_e = max(0, p - iso_pre_e)
        iso = float(sig[i_s:i_e].mean()) if i_e > i_s else float(sig[max(0,p-5):p].mean())

        # 2. QRS / Norm Adjustment
        if abs(g_norm - 1.0) > 1e-4:
            q_s = max(0, p - qrs_pre)
            q_e = min(N, p + qrs_post + 1)
            out[q_s:q_e] = iso + (sig[q_s:q_e] ) * g_norm

        # 3. Conduction Disturbance (The Blur Math)
        if abs(g_cd - 1.0) > 1e-4:
            q_s  = max(0, p - qrs_pre)
            q_e  = min(N, p + qrs_post + 1)
            seg  = sig[q_s:q_e].copy()
            smth = gaussian_filter1d(seg, sigma=cd_sigma)
            # Boosts high-freq "jitters" while keeping the "hill"
            out[q_s:q_e] = smth + (seg - smth) * g_cd

        # 4. MI / ST-Segment Adjustment
        if abs(g_mi - 1.0) > 1e-4:
            st_s = min(N, p + j_off)
            st_e = min(N, p + st_end)
            if st_s < st_e:
                out[st_s:st_e] = iso + (sig[st_s:st_e] ) * g_mi

        # 5. STTC / T-Wave Adjustment
        if abs(g_sttc - 1.0) > 1e-4:
            t_s = min(N, p + t_start)
            t_e = min(N, p + t_end)
            if t_s < t_e:
                out[t_s:t_e] = iso + (sig[t_s:t_e] ) * g_sttc

    return _soft_clip(out.astype(np.float32))


# ── Shared helpers ────────────────────────────────────────────────────────────

def _make_smooth_mask(freqs: np.ndarray, f_min: float, f_max: float) -> np.ndarray:
    center = (f_min + f_max) / 2.0
    sigma  = max((f_max - f_min) / 2.3548, 1e-6)
    return np.exp(-0.5 * ((freqs - center) / sigma) ** 2).astype(np.float32)


def _soft_clip(signal: np.ndarray, threshold: float = 0.95) -> np.ndarray:
    scale = float(np.abs(signal).max())
    if scale < 1e-9:
        return signal.astype(np.float32)
    norm    = signal / scale
    clipped = np.where(
        np.abs(norm) <= threshold,
        norm,
        np.sign(norm) * (threshold + (1.0 - threshold) * np.tanh(
            (np.abs(norm) - threshold) / (1.0 - threshold)
        ))
    )
    return (clipped * scale).astype(np.float32)


# ── Wiener data ───────────────────────────────────────────────────────────────
_DATA_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'data')

# Animal data containers
ANIMAL_MASKS = None
ANIMAL_NAMES = []
ANIMAL_GAINS = {}
ANIMAL_META = {}
ANIMAL_STFT_PARAMS = {}

# Human data containers
HUMAN_MASKS = None
HUMAN_NAMES = []
HUMAN_GAINS = {}
HUMAN_META = {}
HUMAN_STFT_PARAMS = {}

# Load animal Wiener data
_animal_path = os.path.join(_DATA_DIR, 'wiener_gains_animals.npz')
if os.path.exists(_animal_path):
    try:
        _data = np.load(_animal_path, allow_pickle=True)
        if 'masks' in _data:
            ANIMAL_MASKS = _data['masks']
            ANIMAL_NAMES = list(_data['animal_names'])
            ANIMAL_STFT_PARAMS = {
                'n_fft': int(_data['n_fft']),
                'hop_length': int(_data['hop_length']),
                'sample_rate': int(_data['sample_rate']),
            }
            print(f"[INFO] Loaded animal Wiener masks: {ANIMAL_MASKS.shape}")
        if 'gains' in _data:
            ANIMAL_GAINS = _data['gains'].item()
        if 'meta' in _data:
            ANIMAL_META = _data['meta'].item()
    except Exception as e:
        print(f"[WARNING] Failed to load animal Wiener data: {e}")

# Load human Wiener data
_human_path = os.path.join(_DATA_DIR, 'wiener_gains_Humans.npz')
if os.path.exists(_human_path):
    try:
        _data = np.load(_human_path, allow_pickle=True)
        if 'masks' in _data:
            HUMAN_MASKS = _data['masks']
            HUMAN_NAMES = list(_data['Human_names'])
            HUMAN_STFT_PARAMS = {
                'n_fft': int(_data['n_fft']),
                'hop_length': int(_data['hop_length']),
                'sample_rate': int(_data['sample_rate']),
            }
            print(f"[INFO] Loaded human Wiener masks: {HUMAN_MASKS.shape}")
        if 'gains' in _data:
            HUMAN_GAINS = _data['gains'].item()
        if 'meta' in _data:
            HUMAN_META = _data['meta'].item()
    except Exception as e:
        print(f"[WARNING] Failed to load human Wiener data: {e}")

# Human wavelet data containers
HUMAN_WAVELET_MASKS = {}      # Dict[source_name, Dict[level_idx, mask_array]]
HUMAN_WAVELET_NAMES = []
HUMAN_WAVELET_FINGERPRINTS = {}
HUMAN_WAVELET_PARAMS = {}

# Load human wavelet Wiener data
_human_wavelet_path = os.path.join(_DATA_DIR, 'wiener_wavelet_human.npz')
if os.path.exists(_human_wavelet_path):
    try:
        _data = np.load(_human_wavelet_path, allow_pickle=True)
        HUMAN_WAVELET_NAMES = list(_data['source_names'])
        HUMAN_WAVELET_PARAMS = {
            'wavelet': str(_data['wavelet'][0]),
            'levels': int(_data['levels'][0]),
            'alpha': float(_data['alpha'][0]),
            'sample_rate': int(_data['sample_rate'][0]),
            'signal_length': int(_data['signal_length'][0]),
            'level_labels': list(_data['level_labels']),
        }
        # Load masks for each source and level
        for name in HUMAN_WAVELET_NAMES:
            HUMAN_WAVELET_MASKS[name] = {}
            for lvl in range(6):  # 6 levels: approx + 5 details
                key = f'mask_{name}_{lvl}'
                if key in _data:
                    HUMAN_WAVELET_MASKS[name][lvl] = _data[key]
            fp_key = f'fingerprint_{name}'
            if fp_key in _data:
                HUMAN_WAVELET_FINGERPRINTS[name] = _data[fp_key]
        print(f"[INFO] Loaded human wavelet masks: {HUMAN_WAVELET_NAMES}")
    except Exception as e:
        print(f"[WARNING] Failed to load human wavelet data: {e}")

# Animal wavelet data containers
ANIMAL_WAVELET_MASKS = {}      # Dict[source_name, Dict[level_idx, mask_array]]
ANIMAL_WAVELET_NAMES = []
ANIMAL_WAVELET_FINGERPRINTS = {}
ANIMAL_WAVELET_PARAMS = {}

# Load animal wavelet Wiener data
_animal_wavelet_path = os.path.join(_DATA_DIR, 'wiener_wavelet_animal.npz')
if os.path.exists(_animal_wavelet_path):
    try:
        _data = np.load(_animal_wavelet_path, allow_pickle=True)
        ANIMAL_WAVELET_NAMES = list(_data['source_names'])
        ANIMAL_WAVELET_PARAMS = {
            'wavelet': str(_data['wavelet'][0]),
            'levels': int(_data['levels'][0]),
            'alpha': float(_data['alpha'][0]),
            'sample_rate': int(_data['sample_rate'][0]),
            'signal_length': int(_data['signal_length'][0]),
            'level_labels': list(_data['level_labels']),
        }
        # Load masks for each source and level
        for name in ANIMAL_WAVELET_NAMES:
            ANIMAL_WAVELET_MASKS[name] = {}
            for lvl in range(6):  # 6 levels: approx + 5 details
                key = f'mask_{name}_{lvl}'
                if key in _data:
                    ANIMAL_WAVELET_MASKS[name][lvl] = _data[key]
            fp_key = f'fingerprint_{name}'
            if fp_key in _data:
                ANIMAL_WAVELET_FINGERPRINTS[name] = _data[fp_key]
        print(f"[INFO] Loaded animal wavelet masks: {ANIMAL_WAVELET_NAMES}")
    except Exception as e:
        print(f"[WARNING] Failed to load animal wavelet data: {e}")


# ── Public API ────────────────────────────────────────────────────────────────

def apply_equalizer(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
    mode:        str = "generic",
    mask_mode:   str = "stft",
) -> np.ndarray:
    if not bands:
        return signal

    # ECG mode
    has_ecg_bands = any(str(b.get('id', '')).lower() in ECG_BAND_IDS for b in bands)
    if mode == 'ecg' and has_ecg_bands:
        peaks = _find_r_peaks(signal.astype(np.float64), sample_rate)
        if len(peaks) >= 2:
            return _apply_ecg_morphological_eq(signal, sample_rate, weights)
        else:
            return _apply_ecg_mask_eq(signal, sample_rate, bands, weights)

    # Animal/Human soft-mask mode
    has_animal_bands = any(b.get('id') in ANIMAL_ID_MAP for b in bands)
    has_human_bands = any(b.get('id') in HUMAN_ID_MAP for b in bands)

    use_animal_softmask = (
        ANIMAL_MASKS is not None and HAS_LIBROSA and has_animal_bands and
        any(ANIMAL_ID_MAP.get(b.get('id')) in ANIMAL_NAMES for b in bands)
    )

    use_human_softmask = (
        HUMAN_MASKS is not None and HAS_LIBROSA and has_human_bands and
        any(HUMAN_ID_MAP.get(b.get('id')) in HUMAN_NAMES for b in bands)
    )

    if use_animal_softmask:
        if str(mask_mode).lower() == "fft":
            return _apply_frequency_mask_eq(
                signal, sample_rate, bands, weights,
                ANIMAL_MASKS, ANIMAL_NAMES, ANIMAL_STFT_PARAMS, ANIMAL_ID_MAP
            )
        return _apply_softmask_eq(
            signal, sample_rate, bands, weights,
            ANIMAL_MASKS, ANIMAL_NAMES, ANIMAL_STFT_PARAMS, ANIMAL_ID_MAP
        )
    elif use_human_softmask:
        if str(mask_mode).lower() == "fft":
            return _apply_frequency_mask_eq(
                signal, sample_rate, bands, weights,
                HUMAN_MASKS, HUMAN_NAMES, HUMAN_STFT_PARAMS, HUMAN_ID_MAP
            )
        return _apply_softmask_eq(
            signal, sample_rate, bands, weights,
            HUMAN_MASKS, HUMAN_NAMES, HUMAN_STFT_PARAMS, HUMAN_ID_MAP
        )
    else:
        return _apply_fft_eq(signal, sample_rate, bands, weights, mode)


def _apply_ecg_mask_eq(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
) -> np.ndarray:
    """FFT-based fallback when R-peak detection fails."""
    N = len(signal)
    if N < 4:
        return signal.copy().astype(np.float32)
    n_fft       = int(2 ** np.ceil(np.log2(max(N, 1024))))
    spectrum    = np.fft.rfft(signal.astype(np.float64), n=n_fft)
    freqs       = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate)
    masks, dead = _build_ecg_masks(freqs)
    id_to_idx   = {cls: i for i, cls in enumerate(ECG_CLASS_ORDER)}
    gain_curve  = np.zeros(len(freqs), dtype=np.float64)
    n_matched   = 0
    for band in bands:
        raw_id  = str(band.get('id', '')).lower()
        cls_idx = id_to_idx.get(raw_id)
        if cls_idx is None:
            continue
        # Inside the 'for band in bands:' loop:
        orig_id = band.get('id', raw_id)
        slider_value = float(weights.get(orig_id, weights.get(raw_id, 0.0))) # Default to 0.0 (no change)

        # REMAP: Convert -1.0 -> 1.0 range into 0.0 -> 2.0 multiplier
        user_gain = 1.0 + slider_value # 0.0 means 1.0x, -1.0 means 0.0x, +1.0 means 2.0x

        # Now apply it to the gain curve
        gain_curve += masks[cls_idx].astype(np.float64) * user_gain
        n_matched  += 1
        if n_matched == 0:
            return signal.copy().astype(np.float32)
        gain_curve[dead] = 1.0
    output = np.fft.irfft(spectrum * gain_curve, n=n_fft)[:N]
    return _soft_clip(output.astype(np.float32))


def _apply_softmask_eq(
    signal:       np.ndarray,
    sample_rate:  float,
    bands:        List[Dict[str, Any]],
    weights:      Dict[str, float],
    masks_data:   np.ndarray,
    source_names: List[str],
    stft_params:  Dict[str, int],
    id_map:       Dict[str, str],
) -> np.ndarray:
    """Per-frame soft-mask equalization using STFT."""
    n_fft = stft_params['n_fft']
    hop_length = stft_params['hop_length']
    stored_sr = stft_params['sample_rate']

    original_sr = int(sample_rate)
    original_len = len(signal)

    if original_sr != stored_sr:
        signal = librosa.resample(signal, orig_sr=original_sr, target_sr=stored_sr)

    D = librosa.stft(signal, n_fft=n_fft, hop_length=hop_length)
    n_freq_bins, n_time_frames = D.shape

    masks = masks_data.copy()
    stored_time_frames = masks.shape[2]

    if n_time_frames != stored_time_frames:
        from scipy.ndimage import zoom
        masks_interp = np.zeros((masks.shape[0], n_freq_bins, n_time_frames))
        for i in range(masks.shape[0]):
            masks_interp[i] = zoom(masks[i], (1.0, n_time_frames / stored_time_frames), order=1)
        masks = masks_interp

    n_sources = len(source_names)
    gains_lin = np.ones(n_sources)

    for band in bands:
        band_id = band.get("id")
        mapped_name = id_map.get(band_id, band_id)
        if mapped_name in source_names:
            idx = source_names.index(mapped_name)
            user_gain = float(weights.get(band_id, 1.0))
            gains_lin[idx] = user_gain

    eq_gain = np.einsum('i,ift->ft', gains_lin, masks)
    D_out = D * eq_gain

    y_out = librosa.istft(D_out, hop_length=hop_length, n_fft=n_fft, length=len(signal))

    if original_sr != stored_sr:
        y_out = librosa.resample(y_out, orig_sr=stored_sr, target_sr=original_sr)
        if len(y_out) > original_len:
            y_out = y_out[:original_len]
        elif len(y_out) < original_len:
            y_out = np.pad(y_out, (0, original_len - len(y_out)))

    return _soft_clip(y_out).astype(np.float32)


def _apply_frequency_mask_eq(
    signal:       np.ndarray,
    sample_rate:  float,
    bands:        List[Dict[str, Any]],
    weights:      Dict[str, float],
    masks_data:   np.ndarray,
    source_names: List[str],
    stft_params:  Dict[str, int],
    id_map:       Dict[str, str],
) -> np.ndarray:
    """Frequency-only masking by collapsing source STFT masks over time."""
    n_fft = stft_params['n_fft']
    hop_length = stft_params['hop_length']
    stored_sr = stft_params['sample_rate']

    original_sr = int(sample_rate)
    original_len = len(signal)

    if original_sr != stored_sr:
        signal = librosa.resample(signal, orig_sr=original_sr, target_sr=stored_sr)

    # Step 1: STFT using the same parameters as soft-mask mode.
    D = librosa.stft(signal, n_fft=n_fft, hop_length=hop_length)
    n_freq_bins, n_time_frames = D.shape

    # Match mask time resolution to current STFT frame count.
    masks = masks_data.copy()
    if masks.shape[2] != n_time_frames:
        from scipy.ndimage import zoom
        masks_interp = np.zeros((masks.shape[0], masks.shape[1], n_time_frames), dtype=np.float64)
        for i in range(masks.shape[0]):
            masks_interp[i] = zoom(masks[i], (1.0, n_time_frames / masks.shape[2]), order=1)
        masks = masks_interp

    if masks.shape[1] != n_freq_bins:
        from scipy.ndimage import zoom
        resized = np.zeros((masks.shape[0], n_freq_bins, masks.shape[2]), dtype=np.float64)
        for i in range(masks.shape[0]):
            resized[i] = zoom(masks[i], (n_freq_bins / masks.shape[1], 1.0), order=1)
        masks = resized

    # Step 2: Collapse to frequency-only masks using energy weighting.
    power = np.abs(D) ** 2  # (f, t)
    denom = np.sum(power, axis=1) + 1e-10

    n_sources = len(source_names)
    M_i_f = np.zeros((n_sources, n_freq_bins), dtype=np.float64)

    for src_idx in range(min(n_sources, masks.shape[0])):
        M_i_f[src_idx] = np.sum(masks[src_idx] * power, axis=1) / denom

    # Step 3: Normalize across sources so each frequency bin sums to ~1.
    M_sum = np.sum(M_i_f, axis=0, keepdims=True)
    M_norm = M_i_f / (M_sum + 1e-10)

    # Step 4: Build per-source gains from UI band weights.
    gains_lin = np.ones(n_sources, dtype=np.float64)
    for band in bands:
        band_id = band.get("id")
        mapped_name = id_map.get(band_id, band_id)
        if mapped_name in source_names:
            idx = source_names.index(mapped_name)
            gains_lin[idx] = float(weights.get(band_id, 1.0))

    # Step 5: Final frequency gain from weighted source competition.
    gain_f = np.sum(gains_lin[:, None] * M_norm, axis=0)

    # Step 6: Apply in FFT domain.
    N = len(signal)
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(N, d=1 / stored_sr)

    gain_interp = np.interp(freqs, np.linspace(0, stored_sr / 2, len(gain_f)), gain_f)

    eq_spectrum = spectrum * gain_interp
    output = np.fft.irfft(eq_spectrum, n=N)

    if original_sr != stored_sr:
        output = librosa.resample(output, orig_sr=stored_sr, target_sr=original_sr)
        if len(output) > original_len:
            output = output[:original_len]
        elif len(output) < original_len:
            output = np.pad(output, (0, original_len - len(output)))

    return _soft_clip(output.astype(np.float32))


def _apply_fft_eq(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
    mode:        str,
) -> np.ndarray:
    N = len(signal)
    window = np.hanning(N)
    spectrum = np.fft.rfft(signal * window, n=N)
    freqs = np.fft.rfftfreq(N, d=1.0 / sample_rate)
    eq_spectrum = spectrum.copy()

    for band in bands:
        band_id = band.get('id')
        user_gain = float(weights.get(band_id, 1.0))

        # Check for Wiener gains in both animal and human data
        wiener_key = None
        wiener_gains = None
        wiener_meta = None

        animal_name = ANIMAL_ID_MAP.get(band_id, band_id)
        if animal_name in ANIMAL_GAINS:
            wiener_key = animal_name
            wiener_gains = ANIMAL_GAINS
            wiener_meta = ANIMAL_META

        human_name = HUMAN_ID_MAP.get(band_id, band_id)
        if human_name in HUMAN_GAINS:
            wiener_key = human_name
            wiener_gains = HUMAN_GAINS
            wiener_meta = HUMAN_META

        if wiener_key and wiener_gains:
            meta = wiener_meta.get(wiener_key, {})
            stored_sr = meta.get('sample_rate', 22050)
            gc = np.interp(freqs, np.linspace(0, stored_sr / 2, len(wiener_gains[wiener_key])), wiener_gains[wiener_key])
            eq_spectrum *= (1.0 + (gc - 1.0) * user_gain).astype(np.complex64)
        else:
            for r in (band.get('ranges') or [band]):
                sm = _make_smooth_mask(freqs, float(r.get('min_hz', 0)), float(r.get('max_hz', sample_rate / 2)))
                eq_spectrum *= (1.0 + sm * (user_gain - 1.0))

    out = np.fft.irfft(eq_spectrum, n=N)[:N]
    out *= np.where(window > 1e-6, 1.0 / window, 1.0)
    return _soft_clip(out).astype(np.float32)


# ── Wavelet equalizer ─────────────────────────────────────────────────────────

# Human wavelet ID map (matching FFT ID map)
HUMAN_WAVELET_ID_MAP = {
    'man': 'Man',
    'woman': 'Woman',
    'child': 'Child',
    'elderly': 'Elderly',
}

# Animal wavelet ID map (matching FFT ID map)
ANIMAL_WAVELET_ID_MAP = {
    'dog': 'Dog',
    'cow': 'Cow',
    'bird': 'Bird',
    'cat': 'Cat',
}


def apply_wavelet_equalizer(
    signal:          np.ndarray,
    sample_rate:     float,
    wavelet:         str,
    levels:          int,
    wavelet_weights: Dict[str, float],
    mode:            str = "generic",
    mask_mode:       str = "stft",
) -> np.ndarray:
    # Human mode with Wiener wavelet masks
    if mode == 'human' and HUMAN_WAVELET_MASKS:
        return _apply_wavelet_wiener(
            signal, sample_rate, wavelet_weights,
            HUMAN_WAVELET_MASKS, HUMAN_WAVELET_NAMES, HUMAN_WAVELET_PARAMS, HUMAN_WAVELET_ID_MAP,
            mask_mode=mask_mode
        )

    # Animal mode with Wiener wavelet masks
    if mode == 'animal' and ANIMAL_WAVELET_MASKS:
        return _apply_wavelet_wiener(
            signal, sample_rate, wavelet_weights,
            ANIMAL_WAVELET_MASKS, ANIMAL_WAVELET_NAMES, ANIMAL_WAVELET_PARAMS, ANIMAL_WAVELET_ID_MAP,
            mask_mode=mask_mode
        )

    # Generic wavelet equalization
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(wavelet).dec_len)
    levels    = max(1, min(levels, max_level))
    coeffs    = pywt.wavedec(signal, wavelet, level=levels)
    scaled    = []
    for i, arr in enumerate(coeffs):
        key    = 'approx' if i == 0 else f'level_{levels - i + 1}'
        scaled.append(arr * float(wavelet_weights.get(key, 1.0)))
    return pywt.waverec(scaled, wavelet)[:len(signal)].astype(np.float32)


def _apply_wavelet_wiener(
    signal:          np.ndarray,
    sample_rate:     float,
    wavelet_weights: Dict[str, float],
    masks_data:      Dict[str, Dict[int, np.ndarray]],
    source_names:    List[str],
    params:          Dict[str, Any],
    id_map:          Dict[str, str],
    mask_mode:       str = "stft",
) -> np.ndarray:
    """Apply Wiener soft-mask equalization in wavelet domain.
    
    Args:
        mask_mode: "stft" for time-frequency masking (existing), "fft" for frequency-only masking (new)
    """
    if mask_mode == "fft":
        return _apply_frequency_mask_eq_wavelet(
            signal, sample_rate, wavelet_weights, masks_data, source_names, params, id_map
        )
    
    # Default STFT-based wavelet Wiener masking
    try:
        import librosa
    except ImportError:
        return signal.astype(np.float32)

    stored_wavelet = params.get('wavelet', 'sym4')
    stored_levels = params.get('levels', 5)
    stored_sr = params.get('sample_rate', 11025)

    original_sr = int(sample_rate)
    original_len = len(signal)

    # Resample to stored sample rate if needed
    if original_sr != stored_sr:
        signal = librosa.resample(signal.astype(np.float32), orig_sr=original_sr, target_sr=stored_sr)

    # Decompose signal using stored wavelet config
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(stored_wavelet).dec_len)
    actual_levels = min(stored_levels, max_level)
    coeffs = pywt.wavedec(signal.astype(np.float64), stored_wavelet, level=actual_levels)

    # Build gain multiplier for each level using Wiener soft-masks
    n_sources = len(source_names)
    gains_lin = np.ones(n_sources)

    # Map user band IDs to source indices
    for band_id, weight in wavelet_weights.items():
        mapped_name = id_map.get(band_id, band_id)
        if mapped_name in source_names:
            idx = source_names.index(mapped_name)
            gains_lin[idx] = float(weight)

    # Apply soft-mask equalization to each wavelet level
    scaled_coeffs = []
    for lvl_idx, coeff in enumerate(coeffs):
        coeff_len = len(coeff)
        # Build combined gain for this level from all source masks
        combined_gain = np.zeros(coeff_len, dtype=np.float64)

        for src_idx, src_name in enumerate(source_names):
            if src_name in masks_data and lvl_idx in masks_data[src_name]:
                mask = masks_data[src_name][lvl_idx]
                # Interpolate mask to match coefficient length
                if len(mask) != coeff_len:
                    mask = np.interp(
                        np.linspace(0, 1, coeff_len),
                        np.linspace(0, 1, len(mask)),
                        mask
                    )
                combined_gain += mask * gains_lin[src_idx]

        # Apply gain (default to 1.0 if no masks matched)
        if combined_gain.max() < 1e-9:
            combined_gain = np.ones(coeff_len)

        scaled_coeffs.append(coeff * combined_gain)

    # Reconstruct signal
    y_out = pywt.waverec(scaled_coeffs, stored_wavelet)

    # Resample back to original sample rate if needed
    if original_sr != stored_sr:
        y_out = librosa.resample(y_out.astype(np.float32), orig_sr=stored_sr, target_sr=original_sr)

    # Match original length
    if len(y_out) > original_len:
        y_out = y_out[:original_len]
    elif len(y_out) < original_len:
        y_out = np.pad(y_out, (0, original_len - len(y_out)))

    return _soft_clip(y_out).astype(np.float32)


def _apply_frequency_mask_eq_wavelet(
    signal:          np.ndarray,
    sample_rate:     float,
    wavelet_weights: Dict[str, float],
    masks_data:      Dict[str, Dict[int, np.ndarray]],
    source_names:    List[str],
    params:          Dict[str, Any],
    id_map:          Dict[str, str],
) -> np.ndarray:
    """Apply frequency-only masking by collapsing STFT masks over time.
    
    This approximates Wiener masking behavior using only FFT magnitude spectrum,
    providing a less accurate but computationally simpler alternative to STFT masking.
    
    Steps:
    1. Compute STFT (reuse existing params)
    2. Collapse masks over time using energy-weighted averaging
    3. Normalize across sources (competition)
    4. Apply user gains
    5. Apply in FFT domain via interpolation
    6. Return soft-clipped result
    """
    try:
        import librosa
    except ImportError:
        return signal.astype(np.float32)

    stored_sr = params.get('sample_rate', 11025)
    n_fft = params.get('n_fft', 2048)
    hop_length = params.get('hop_length', 512)

    original_sr = int(sample_rate)
    original_len = len(signal)

    # Resample to stored sample rate if needed
    if original_sr != stored_sr:
        signal = librosa.resample(signal.astype(np.float32), orig_sr=original_sr, target_sr=stored_sr)

    # Step 1: Compute STFT
    D = librosa.stft(signal.astype(np.float32), n_fft=n_fft, hop_length=hop_length)
    n_freq_bins, n_time_frames = D.shape

    # Step 2: Collapse masks over time using energy-weighted averaging
    n_sources = len(source_names)
    power = np.abs(D) ** 2  # shape: (n_freq, n_time)
    power_sum = np.sum(power, axis=1, keepdims=True) + 1e-10  # (n_freq, 1)

    # M_i_f will have shape (n_sources, n_freq)
    M_i_f = np.zeros((n_sources, n_freq_bins), dtype=np.float64)

    for src_idx, src_name in enumerate(source_names):
        if src_name not in masks_data:
            continue

        # Iterate through frequency levels (keys in masks_data[src_name])
        for lvl_idx, mask_level in masks_data[src_name].items():
            # Interpolate mask to match n_freq_bins if needed
            if len(mask_level) != n_freq_bins:
                mask_interp = np.interp(
                    np.linspace(0, 1, n_freq_bins),
                    np.linspace(0, 1, len(mask_level)),
                    mask_level
                )
            else:
                mask_interp = mask_level.copy()

            # Energy-weighted average: sum over time, weighted by power at each frequency
            # M_i(f) = sum_t(mask(f,t) * power(f,t)) / sum_t(power(f,t))
            if n_time_frames > 0:
                # Interpolate or tile mask to match n_time_frames if needed
                if hasattr(masks_data[src_name], '__len__'):
                    # If masks have time dimension, use it
                    if len(mask_level.shape) == 2:
                        # mask_level is (freq, time)
                        if mask_level.shape[1] != n_time_frames:
                            from scipy.ndimage import zoom
                            mask_interp_t = zoom(
                                mask_level,
                                (n_freq_bins / len(mask_level), n_time_frames / mask_level.shape[1]),
                                order=1
                            )
                        else:
                            mask_interp_t = mask_level
                    else:
                        # mask_level is 1D (freq only), tile across time
                        mask_interp_t = np.tile(mask_interp[:, np.newaxis], (1, n_time_frames))
                else:
                    mask_interp_t = np.tile(mask_interp[:, np.newaxis], (1, n_time_frames))

                # Ensure correct shape
                if mask_interp_t.shape != power.shape:
                    mask_interp_t = np.tile(mask_interp[:, np.newaxis], (1, n_time_frames))

                # Energy-weighted sum
                weighted_sum = np.sum(mask_interp_t * power, axis=1)
                M_i_f[src_idx] = weighted_sum / power_sum.ravel()

    # Step 3: Normalize across sources (competition)
    M_sum = np.sum(M_i_f, axis=0, keepdims=True)
    M_sum[M_sum < 1e-10] = 1.0  # Avoid division by zero
    M_norm = M_i_f / M_sum  # shape: (n_sources, n_freq)

    # Step 4: Apply user gains
    gains_lin = np.ones(n_sources, dtype=np.float64)
    for band_id, weight in wavelet_weights.items():
        mapped_name = id_map.get(band_id, band_id)
        if mapped_name in source_names:
            idx = source_names.index(mapped_name)
            gains_lin[idx] = float(weight)

    # Step 5: Build final frequency gain curve
    gain_f = np.sum(gains_lin[:, np.newaxis] * M_norm, axis=0)  # shape: (n_freq,)

    # Step 6: Apply in FFT domain
    N = len(signal)
    spectrum = np.fft.rfft(signal.astype(np.float64))
    freqs = np.fft.rfftfreq(N, d=1.0 / stored_sr)

    # Interpolate gain_f to match FFT bins
    gain_interp = np.interp(freqs, np.linspace(0, stored_sr / 2, n_freq_bins), gain_f)
    
    eq_spectrum = spectrum * gain_interp
    output = np.fft.irfft(eq_spectrum, n=N)[:N]

    # Resample back to original sample rate if needed
    if original_sr != stored_sr:
        output = librosa.resample(output.astype(np.float32), orig_sr=stored_sr, target_sr=original_sr)

    # Match original length
    if len(output) > original_len:
        output = output[:original_len]
    elif len(output) < original_len:
        output = np.pad(output, (0, original_len - len(output)))

    return _soft_clip(output.astype(np.float32))

