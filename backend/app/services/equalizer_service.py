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

# ── ECG band definitions ──────────────────────────────────────────────────────
ECG_CLASS_ORDER = ['norm', 'mi', 'sttc', 'cd']

# Bands are defined by what ACTUALLY DIFFERS between classes in the spectrum,
# not arbitrary clinical labels.
#
# Measured energy distribution at 100Hz sampling:
#   NORM:  baseline=18%  ST/T=13%  QRS_body=43%  QRS_detail=23%  highfreq=3%
#   MI:    baseline= 4%  ST/T=28%  QRS_body=37%  QRS_detail=26%  highfreq=4%
#   STTC:  baseline= 5%  ST/T= 1%  QRS_body=35%  QRS_detail=38%  highfreq=21%
#   CD:    baseline=15%  ST/T= 7%  QRS_body=26%  QRS_detail=45%  highfreq=7%
#
# NORM  slider → baseline + QRS body (what is normal/healthy)
# MI    slider → ST/T slow component (ST elevation lives here at 0.5-2Hz)
# STTC  slider → high-frequency repolarisation (21% in 20-50Hz — unique to STTC)
# CD    slider → QRS detail band (8-20Hz — 45% in CD, highest of all classes)
ECG_BANDS = {
    'norm': (0.05,  2.0),    # baseline wander + QRS body
    'mi':   (0.5,   4.0),    # ST/T slow morphology  (overlaps with norm intentionally)
    'sttc': (20.0, 50.0),    # high-freq repolarisation — unique STTC signature
    'cd':   (8.0,  22.0),    # QRS detail / conduction notching — unique CD signature
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
    total = raw.sum(axis=0)
    dead  = total < 1e-10
    norm_masks = raw / np.where(total > 1e-10, total, 1.0)
    norm_masks[:, dead] = 0.25
    return norm_masks.astype(np.float32), dead


def get_ecg_band_signals(signal: np.ndarray, sample_rate: float) -> dict:
    """
    Return each band's isolated time-domain signal for the EcgBandViewer.
    """
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


# ── ECG morphological equalizer ───────────────────────────────────────────────

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
    """
    Morphological ECG equalizer.  Each slider targets a specific clinical
    waveform feature rather than a frequency band.

    NORM (0-2): QRS spike amplitude.
                gain=2 → taller sharper R-peaks
                gain=0 → spikes flattened, only baseline/T-waves remain

    MI   (0-2): ST-segment deviation from isoelectric.
                gain=2 → ST elevation/depression doubled (more ischaemic)
                gain=0 → ST segment clamped to isoelectric (looks normal)

    STTC (0-2): T-wave amplitude from isoelectric.
                gain=2 → giant/hyperacute T-waves; inverted T more inverted
                gain=0 → T-waves removed entirely

    CD   (0-2): High-frequency notching inside the QRS complex.
                notch = QRS signal minus its Gaussian-smoothed version
                gain=2 → bundle branch notching exaggerated
                gain=0 → QRS becomes smooth round bump (notching removed)

    All sliders at 1.0 → output == input exactly.
    """
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

    # Timing constants (scale with sample rate)
    iso_pre_s = int(sr * 0.25)   # 250ms before R → isoelectric window start
    iso_pre_e = int(sr * 0.15)   # 150ms before R → isoelectric window end
    qrs_pre   = int(sr * 0.04)   # 40ms before R  → QRS onset
    qrs_post  = int(sr * 0.05)   # 50ms after R   → QRS end
    j_off     = int(sr * 0.04)   # 40ms after R   → J-point
    st_end    = int(sr * 0.13)   # 130ms after R  → end of ST
    t_start   = int(sr * 0.15)   # 150ms after R  → T-wave onset
    t_end     = int(sr * 0.38)   # 380ms after R  → T-wave end
    cd_sigma  = max(1.0, sr / 50.0)  # ~2 samples at 100Hz

    for p in peaks:
        # Isoelectric baseline
        i_s = max(0, p - iso_pre_s)
        i_e = max(0, p - iso_pre_e)
        iso = float(sig[i_s:i_e].mean()) if i_e > i_s else float(sig[max(0,p-5):p].mean())

        # NORM: QRS spike
        if abs(g_norm - 1.0) > 1e-4:
            q_s = max(0, p - qrs_pre)
            q_e = min(N, p + qrs_post + 1)
            out[q_s:q_e] = iso + (sig[q_s:q_e] - iso) * g_norm

        # CD: QRS notching (high-freq detail)
        if abs(g_cd - 1.0) > 1e-4:
            q_s  = max(0, p - qrs_pre)
            q_e  = min(N, p + qrs_post + 1)
            seg  = sig[q_s:q_e].copy()
            smth = gaussian_filter1d(seg, sigma=cd_sigma)
            out[q_s:q_e] = smth + (seg - smth) * g_cd

        # MI: ST segment deviation
        if abs(g_mi - 1.0) > 1e-4:
            st_s = min(N, p + j_off)
            st_e = min(N, p + st_end)
            if st_s < st_e:
                out[st_s:st_e] = iso + (sig[st_s:st_e] - iso) * g_mi

        # STTC: T-wave amplitude
        if abs(g_sttc - 1.0) > 1e-4:
            t_s = min(N, p + t_start)
            t_e = min(N, p + t_end)
            if t_s < t_e:
                out[t_s:t_e] = iso + (sig[t_s:t_e] - iso) * g_sttc

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

_WIENER_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'wiener_gains_animals.npz')

WIENER_MASKS        = None
WIENER_ANIMAL_NAMES = []
WIENER_GAINS        = {}
WIENER_META         = {}
WIENER_STFT_PARAMS  = {}

if os.path.exists(_WIENER_PATH):
    try:
        _data = np.load(_WIENER_PATH, allow_pickle=True)
        if 'masks' in _data:
            WIENER_MASKS        = _data['masks']
            WIENER_ANIMAL_NAMES = list(_data['animal_names'])
            WIENER_STFT_PARAMS  = {
                'n_fft':       int(_data['n_fft']),
                'hop_length':  int(_data['hop_length']),
                'sample_rate': int(_data['sample_rate']),
            }
            print(f"[INFO] Loaded full Wiener masks: {WIENER_MASKS.shape}")
        if 'gains' in _data:
            WIENER_GAINS = _data['gains'].item()
        if 'meta' in _data:
            WIENER_META = _data['meta'].item()
    except Exception as e:
        print(f"[WARNING] Failed to load Wiener data: {e}")
else:
    print(f"[WARNING] Wiener gains file not found: {_WIENER_PATH}")


# ── Public API ────────────────────────────────────────────────────────────────

def apply_equalizer(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
    mode:        str = "generic",
) -> np.ndarray:
    if not bands:
        return signal

    has_ecg_bands = any(str(b.get('id', '')).lower() in ECG_BAND_IDS for b in bands)

    if mode == 'ecg' and has_ecg_bands:
        print(f"[EQ DEBUG] mode=ecg -> morphological ECG path")
        peaks = _find_r_peaks(signal.astype(np.float64), sample_rate)
        if len(peaks) >= 2:
            return _apply_ecg_morphological_eq(signal, sample_rate, weights)
        else:
            print("[EQ DEBUG] Too few R-peaks, falling back to FFT mask")
            return _apply_ecg_mask_eq(signal, sample_rate, bands, weights)

    has_animal_bands = any(b.get('id') in ANIMAL_ID_MAP for b in bands)
    use_softmask     = (
        WIENER_MASKS is not None and HAS_LIBROSA and has_animal_bands and
        any(ANIMAL_ID_MAP.get(b.get('id')) in WIENER_ANIMAL_NAMES for b in bands)
    )

    print(f"[EQ DEBUG] mode={mode}, has_animal_bands={has_animal_bands}, use_full_softmask={use_softmask}")
    print(f"[EQ DEBUG] WIENER_MASKS loaded: {WIENER_MASKS is not None}")
    print(f"[EQ DEBUG] bands: {[b.get('id') for b in bands]}")
    print(f"[EQ DEBUG] weights: {weights}")

    if use_softmask:
        print("[EQ DEBUG] Using FULL SOFT-MASK path")
        return _apply_softmask_eq(signal, sample_rate, bands, weights)
    else:
        print("[EQ DEBUG] Using FFT fallback path")
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
        orig_id   = band.get('id', raw_id)
        user_gain = float(weights.get(orig_id, weights.get(raw_id, 1.0)))
        gain_curve += masks[cls_idx].astype(np.float64) * user_gain
        n_matched  += 1
    if n_matched == 0:
        return signal.copy().astype(np.float32)
    gain_curve[dead] = 1.0
    output = np.fft.irfft(spectrum * gain_curve, n=n_fft)[:N]
    return _soft_clip(output.astype(np.float32))


def _apply_softmask_eq(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
) -> np.ndarray:
    n_fft = WIENER_STFT_PARAMS['n_fft']; hop_length = WIENER_STFT_PARAMS['hop_length']
    stored_sr = WIENER_STFT_PARAMS['sample_rate']; orig_sr = int(sample_rate); orig_len = len(signal)
    if orig_sr != stored_sr:
        signal = librosa.resample(signal, orig_sr=orig_sr, target_sr=stored_sr)
    D = librosa.stft(signal, n_fft=n_fft, hop_length=hop_length)
    n_freq_bins, n_time_frames = D.shape
    masks = WIENER_MASKS; stored_time_frames = masks.shape[2]
    if n_time_frames != stored_time_frames:
        from scipy.ndimage import zoom
        masks_interp = np.zeros((masks.shape[0], n_freq_bins, n_time_frames))
        for i in range(masks.shape[0]):
            masks_interp[i] = zoom(masks[i], (1.0, n_time_frames/stored_time_frames), order=1)
        masks = masks_interp
    gains_lin = np.ones(len(WIENER_ANIMAL_NAMES))
    for band in bands:
        bid = band.get('id'); nb = ANIMAL_ID_MAP.get(bid, bid)
        if nb in WIENER_ANIMAL_NAMES:
            gains_lin[WIENER_ANIMAL_NAMES.index(nb)] = float(weights.get(bid, 1.0))
    y_out = librosa.istft(D * np.einsum('i,ift->ft', gains_lin, masks), hop_length=hop_length, n_fft=n_fft, length=len(signal))
    if orig_sr != stored_sr:
        y_out = librosa.resample(y_out, orig_sr=stored_sr, target_sr=orig_sr)
        y_out = y_out[:orig_len] if len(y_out) > orig_len else np.pad(y_out, (0, orig_len-len(y_out)))
    return _soft_clip(y_out).astype(np.float32)


def _apply_fft_eq(
    signal:      np.ndarray,
    sample_rate: float,
    bands:       List[Dict[str, Any]],
    weights:     Dict[str, float],
    mode:        str,
) -> np.ndarray:
    N = len(signal); window = np.hanning(N)
    spectrum    = np.fft.rfft(signal * window, n=N)
    freqs       = np.fft.rfftfreq(N, d=1.0 / sample_rate)
    eq_spectrum = spectrum.copy()
    for band in bands:
        bid = band.get('id'); user_gain = float(weights.get(bid, 1.0))
        nb = ANIMAL_ID_MAP.get(bid, bid)
        wk = nb if nb in WIENER_GAINS else (bid if bid in WIENER_GAINS else None)
        if wk:
            meta = WIENER_META.get(wk, {}); stored_sr = meta.get('sample_rate', 22050)
            gc   = np.interp(freqs, np.linspace(0, stored_sr/2, len(WIENER_GAINS[wk])), WIENER_GAINS[wk])
            eq_spectrum *= (1.0 + (gc - 1.0) * user_gain).astype(np.complex64)
        else:
            for r in (band.get('ranges') or [band]):
                sm = _make_smooth_mask(freqs, float(r.get('min_hz',0)), float(r.get('max_hz', sample_rate/2)))
                eq_spectrum *= (1.0 + sm * (user_gain - 1.0))
    out = np.fft.irfft(eq_spectrum, n=N)[:N]
    out *= np.where(window > 1e-6, 1.0/window, 1.0)
    return _soft_clip(out).astype(np.float32)


# ── Wavelet equalizer ─────────────────────────────────────────────────────────

def apply_wavelet_equalizer(
    signal:          np.ndarray,
    sample_rate:     float,
    wavelet:         str,
    levels:          int,
    wavelet_weights: Dict[str, float],
) -> np.ndarray:
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(wavelet).dec_len)
    levels    = max(1, min(levels, max_level))
    coeffs    = pywt.wavedec(signal, wavelet, level=levels)
    scaled    = []
    for i, arr in enumerate(coeffs):
        key    = 'approx' if i == 0 else f'level_{levels - i + 1}'
        scaled.append(arr * float(wavelet_weights.get(key, 1.0)))
    return pywt.waverec(scaled, wavelet)[:len(signal)].astype(np.float32)