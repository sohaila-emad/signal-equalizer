"""
abnormality_processor.py
------------------------
Applies clinical ECG morphology changes to a user's signal.

Key fixes vs original:
  - Beat-by-beat processing: detects R peaks, applies morphology per beat
    so alignment is always correct regardless of BPM or RR variability
  - LVH normalization fix: normalizes relative to original signal scale,
    not the mixed signal, so high voltage is actually preserved
  - Reliable path resolution using Path(__file__) not os.getcwd()
  - BBB applied as QRS widening via convolution, not delta subtraction
  - ST changes applied in the ST segment window after each QRS, not globally
"""

import numpy as np
import librosa
import neurokit2 as nk
from pathlib import Path


REF_DIR = Path(__file__).resolve().parent.parent / "data" / "synthetic" / "references"


def _detect_r_peaks(signal: np.ndarray, sr: int) -> np.ndarray:
    """Return R-peak sample indices. Falls back to estimated positions on failure."""
    try:
        _, info = nk.ecg_peaks(signal, sampling_rate=sr)
        peaks = info["ECG_R_Peaks"]
        if len(peaks) >= 2:
            return peaks
    except Exception:
        pass

    # Fallback: estimate from signal autocorrelation
    # Find dominant period between 0.3s (200 BPM) and 2.0s (30 BPM)
    min_dist = int(sr * 0.3)
    max_dist = int(sr * 2.0)
    threshold = np.max(signal) * 0.6
    peaks = []
    i = 0
    while i < len(signal):
        if signal[i] > threshold:
            window_end = min(i + min_dist, len(signal))
            local_max  = i + np.argmax(signal[i:window_end])
            peaks.append(local_max)
            i = local_max + min_dist
        else:
            i += 1
    return np.array(peaks) if peaks else np.array([len(signal) // 2])


def _apply_lvh(signal: np.ndarray, r_peaks: np.ndarray,
               sr: int, weight: float) -> np.ndarray:
    """
    LVH = increased R-peak voltage.
    For each beat, scale up the QRS amplitude by (1 + weight * gain).
    We scale the QRS window only, leaving P and T waves untouched.
    weight=1.0 → R peak is ~2.5x normal (clinically significant LVH).
    """
    out = signal.copy()
    qrs_half = int(0.06 * sr)   # ±60ms around R peak = QRS window

    for peak in r_peaks:
        lo = max(0, peak - qrs_half)
        hi = min(len(signal), peak + qrs_half)
        # Scale factor: weight=1.0 gives 2.5x, weight=0.5 gives 1.75x
        scale = 1.0 + weight * 1.5
        out[lo:hi] = signal[lo:hi] * scale

    return out


def _apply_bbb(signal: np.ndarray, r_peaks: np.ndarray,
               sr: int, weight: float) -> np.ndarray:
    """
    BBB = widened QRS complex (>=120ms).
    Achieved by convolving the QRS region with a smoothing kernel.
    weight=1.0 -> QRS width ~150ms (moderate BBB).
    weight=2.0 -> QRS width ~200ms (severe BBB).

    Kernel is capped at 120ms (0.12s) regardless of weight to prevent
    the kernel from growing larger than the QRS window itself,
    which caused memory/timeout crashes above weight=1.5.
    """
    out = signal.copy()
    qrs_half = int(0.07 * sr)   # ±70ms QRS extraction window

    # Cap kernel at 120ms — beyond that you get smearing not widening
    # weight=1.0 → 40ms kernel, weight=2.0 → 80ms kernel, hard cap 120ms
    MAX_KERNEL_MS = 0.12
    kernel_secs  = min(weight * 0.04, MAX_KERNEL_MS)
    kernel_width = max(3, int(kernel_secs * sr))
    if kernel_width % 2 == 0:
        kernel_width += 1   # must be odd for symmetric convolution

    kernel = np.hanning(kernel_width)
    kernel /= kernel.sum()

    for peak in r_peaks:
        try:
            lo = max(0, peak - qrs_half)
            hi = min(len(signal), peak + qrs_half)
            segment = signal[lo:hi]

            if len(segment) < kernel_width:
                # QRS window too small to convolve — skip this beat
                continue

            widened = np.convolve(segment, kernel, mode='same')

            # Restore peak amplitude — convolution reduces peak height
            orig_peak_val = np.max(np.abs(segment))
            wide_peak_val = np.max(np.abs(widened))
            if wide_peak_val > 0:
                widened *= orig_peak_val / wide_peak_val

            out[lo:hi] = widened

        except Exception as e:
            print(f"  WARNING: BBB failed on peak at {peak}: {e} — skipping beat")
            continue

    return out


def _apply_st_change(signal: np.ndarray, r_peaks: np.ndarray,
                     sr: int, weight: float, direction: float) -> np.ndarray:
    """
    ST change = elevation (direction=+1) or depression (direction=-1).
    Applied in the ST segment window: 80-300ms after each R peak.
    weight=1.0 → ~0.3mV equivalent deviation.
    direction=+1 → ST elevation (STEMI pattern)
    direction=-1 → ST depression (ischemia/subendocardial)
    """
    out = signal.copy()
    # ST segment: starts ~80ms after R peak, ends ~300ms after (before T wave)
    st_start = int(0.08 * sr)
    st_end   = int(0.30 * sr)
    st_len   = st_end - st_start

    # Deviation amplitude relative to signal scale
    signal_scale = np.std(signal) * 2
    deviation    = direction * weight * signal_scale * 0.35

    # Taper the deviation with a half-cosine so it blends smoothly
    taper = 0.5 * (1 - np.cos(np.linspace(0, np.pi, st_len)))

    for peak in r_peaks:
        seg_start = peak + st_start
        seg_end   = peak + st_end
        if seg_end > len(signal):
            continue
        out[seg_start:seg_end] += deviation * taper

    return out


def process_abnormality_mode(base_signal: np.ndarray,
                              sr: int,
                              weights: dict) -> np.ndarray:
    """
    Apply weighted ECG morphology abnormalities to a real signal.

    Args:
        base_signal : raw ECG signal array
        sr          : sample rate of base_signal
        weights     : dict with any of:
                        "lvh"        float 0-2  (voltage increase)
                        "bbb"        float 0-2  (QRS widening)
                        "st_dep"     float 0-2  (ST depression)
                        "st_elev"    float 0-2  (ST elevation)

    Returns:
        modified signal, same length as base_signal
    """
    mixed = base_signal.copy().astype(np.float64)

    # Detect R peaks once — reused by all processors
    r_peaks = _detect_r_peaks(mixed, sr)

    if len(r_peaks) == 0:
        print("WARNING: No R peaks detected — returning original signal")
        return base_signal

    print(f"  Detected {len(r_peaks)} R peaks, "
          f"estimated BPM: {60 / (np.mean(np.diff(r_peaks)) / sr):.0f}")

    # Apply each pathology in order
    lvh_w    = float(weights.get("lvh",     0.0))
    bbb_w    = float(weights.get("bbb",     0.0))
    st_dep_w = float(weights.get("st_dep",  0.0))
    st_el_w  = float(weights.get("st_elev", 0.0))

    if lvh_w > 0:
        mixed = _apply_lvh(mixed, r_peaks, sr, lvh_w)
        print(f"  Applied LVH  (weight={lvh_w:.2f})")

    if bbb_w > 0:
        mixed = _apply_bbb(mixed, r_peaks, sr, bbb_w)
        print(f"  Applied BBB  (weight={bbb_w:.2f})")

    if st_dep_w > 0:
        mixed = _apply_st_change(mixed, r_peaks, sr, st_dep_w, direction=-1)
        print(f"  Applied ST depression (weight={st_dep_w:.2f})")

    if st_el_w > 0:
        mixed = _apply_st_change(mixed, r_peaks, sr, st_el_w, direction=+1)
        print(f"  Applied ST elevation  (weight={st_el_w:.2f})")

    # Normalize relative to the ORIGINAL signal scale, not the mixed signal.
    # This preserves the LVH high-voltage effect — we scale so the original
    # baseline sits at its original level, not so the new peak sits at 1.0.
    orig_max = np.max(np.abs(base_signal))
    if orig_max > 0 and lvh_w == 0:
        # Only normalize if no LVH — LVH intentionally increases amplitude
        mixed_max = np.max(np.abs(mixed))
        if mixed_max > 0:
            mixed = mixed / mixed_max * orig_max

    return mixed.astype(np.float32)