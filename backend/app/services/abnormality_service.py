"""
abnormality_service.py
-----------------------
ECG morphology simulator with fully bidirectional sliders.

Slider semantics (all sliders):
  1.0  = neutral — signal is unchanged
  >1.0 = increase the abnormality
  <1.0 = correct/reduce the abnormality (move toward normal)
  0.0  = maximum correction

LVH  : >1.0 = high voltage QRS,  <1.0 = low voltage QRS
BBB  : >1.0 = wider QRS,          <1.0 = sharper/narrower QRS
ST-D : >1.0 = ST depression,     <1.0 = ST elevation (correction)
ST-E : >1.0 = ST elevation,      <1.0 = ST depression (correction)
"""

import numpy as np
import neurokit2 as nk
from pathlib import Path


# ── R-peak detection ──────────────────────────────────────────────────────────

def _detect_r_peaks(signal: np.ndarray, sr: int) -> np.ndarray:
    try:
        _, info = nk.ecg_peaks(signal, sampling_rate=sr)
        peaks = info["ECG_R_Peaks"]
        if len(peaks) >= 2:
            return peaks
    except Exception:
        pass

    # Fallback threshold-based detection
    threshold = np.max(signal) * 0.6
    min_dist  = int(sr * 0.3)
    peaks, i  = [], 0
    while i < len(signal):
        if signal[i] > threshold:
            end       = min(i + min_dist, len(signal))
            local_max = i + np.argmax(signal[i:end])
            peaks.append(local_max)
            i = local_max + min_dist
        else:
            i += 1
    return np.array(peaks) if peaks else np.array([len(signal) // 2])


# ── LVH ───────────────────────────────────────────────────────────────────────

def _apply_lvh(signal: np.ndarray, r_peaks: np.ndarray,
                sr: int, weight: float) -> np.ndarray:
    """
    Direct QRS amplitude scaling.
    weight=1.0 → no change
    """
    out      = signal.copy()
    qrs_half = int(0.06 * sr)

    for peak in r_peaks:
        lo = max(0, peak - qrs_half)
        hi = min(len(signal), peak + qrs_half)
        out[lo:hi] = signal[lo:hi] * weight

    return out


# ── BBB ───────────────────────────────────────────────────────────────────────

def _make_widening_kernel(width_samples: int) -> np.ndarray:
    """Hanning smoothing kernel for QRS widening."""
    if width_samples % 2 == 0:
        width_samples += 1
    k = np.hanning(width_samples).astype(np.float64)
    return k / k.sum()


def _apply_bbb(signal: np.ndarray, r_peaks: np.ndarray,
               sr: int, weight: float) -> np.ndarray:
    """
    BBB: bidirectional QRS width control.
    weight > 1.0 → widen QRS
    weight < 1.0 → sharpen QRS (Pinching logic)
    """
    print(f"  BBB  weight={weight:.4f}", end="")

    if abs(weight - 1.0) < 0.01:
        print(" → no change (within tolerance)")
        return signal

    print(f" → {'widening' if weight > 1.0 else 'sharpening'}")

    out      = signal.copy()
    qrs_half = int(0.07 * sr)

    if weight > 1.0:
        # ── Widening ─────────────────────────────────────────────────────
        effective  = weight - 1.0
        MAX_K_SEC  = 0.12
        k_secs     = min((effective ** 0.5) * MAX_K_SEC, MAX_K_SEC)
        k_width    = max(5, int(k_secs * sr))
        kernel     = _make_widening_kernel(k_width)
        print(f"    kernel_width={k_width} samples ({k_secs*1000:.1f}ms)")

        for peak in r_peaks:
            try:
                lo, hi   = max(0, peak - qrs_half), min(len(signal), peak + qrs_half)
                segment  = signal[lo:hi]
                if len(segment) < k_width:
                    continue
                widened  = np.convolve(segment, kernel, mode='same')
                op = np.max(np.abs(segment))
                wp = np.max(np.abs(widened))
                if wp > 0:
                    widened *= op / wp
                out[lo:hi] = widened
            except Exception:
                continue

    else:
        # ── Sharpening (Power-based Pinching) ─────────────────────────────
        strength = 1.0 - weight  # 0 at weight=1.0, 1 at weight=0.0
        
        for peak in r_peaks:
            try:
                lo, hi  = max(0, peak - qrs_half), min(len(signal), peak + qrs_half)
                segment = signal[lo:hi].copy()
                
                # 1. Non-linear power transformation to pull wide shoulders down
                seg_max = np.max(np.abs(segment))
                if seg_max > 0:
                    norm_seg = segment / seg_max
                    # Power factor p squashes values between 0 and 1
                    p = 1.0 + (strength * 1.5)
                    sharpened = np.sign(norm_seg) * (np.abs(norm_seg) ** p)
                    
                    # 2. Laplacian boost for sharp definition
                    laplace = np.array([-0.05, 1.1, -0.05]) * (1.0 + strength * 0.2)
                    sharpened = np.convolve(sharpened, laplace, mode='same')
                    
                    # 3. Restore amplitude with slight visible boost
                    out[lo:hi] = sharpened * seg_max * (1.0 + strength * 0.1)
                    
            except Exception as e:
                print(f"    WARNING: sharpening failed at peak {peak}: {e}")
                continue

    return out


# ── ST changes ────────────────────────────────────────────────────────────────

def _apply_st_change(signal: np.ndarray, r_peaks: np.ndarray,
                      sr: int, weight: float,
                      direction: float) -> np.ndarray:
    """
    Bidirectional ST segment shift.
    """
    out      = signal.copy()
    st_start = int(0.08 * sr)
    st_end   = int(0.30 * sr)
    st_len   = st_end - st_start

    effective = weight - 1.0
    signal_scale = np.std(signal) * 2
    deviation    = direction * effective * signal_scale * 0.35

    if abs(deviation) < 1e-8:
        return signal

    taper = 0.5 * (1 - np.cos(np.linspace(0, np.pi, st_len)))

    for peak in r_peaks:
        seg_start = peak + st_start
        seg_end   = peak + st_end
        if seg_end > len(signal):
            continue
        out[seg_start:seg_end] += deviation * taper

    return out


# ── Main entry point ──────────────────────────────────────────────────────────

def process_abnormality_mode(base_signal: np.ndarray,
                              sr: int,
                              weights: dict) -> np.ndarray:
    """
    Apply weighted ECG morphology changes to ALL peaks.
    """
    mixed   = base_signal.copy().astype(np.float64)
    r_peaks = _detect_r_peaks(mixed, sr)

    if len(r_peaks) == 0:
        print("WARNING: No R peaks detected")
        return base_signal

    print(f"  R peaks detected: {len(r_peaks)}")

    lvh_w    = float(weights.get("lvh",     1.0))
    bbb_w    = float(weights.get("bbb",     1.0))
    st_dep_w = float(weights.get("st_dep",  1.0))
    st_el_w  = float(weights.get("st_elev", 1.0))

    if lvh_w != 1.0:
        mixed = _apply_lvh(mixed, r_peaks, sr, lvh_w)

    if bbb_w != 1.0:
        mixed = _apply_bbb(mixed, r_peaks, sr, bbb_w)

    if st_dep_w != 1.0:
        mixed = _apply_st_change(mixed, r_peaks, sr, st_dep_w, direction=-1)

    if st_el_w != 1.0:
        mixed = _apply_st_change(mixed, r_peaks, sr, st_el_w, direction=+1)

    if lvh_w == 1.0:
        orig_max  = np.max(np.abs(base_signal))
        mixed_max = np.max(np.abs(mixed))
        if mixed_max > 0 and orig_max > 0:
            mixed = mixed / mixed_max * orig_max

    return mixed.astype(np.float32)