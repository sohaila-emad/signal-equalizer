"""
ecg_service.py
ECGNet inference + Grad-CAM for WFDB format ECG files.
"""

import os
import sys
import tempfile
import shutil
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent.parent / 'models'))
from ecgnet_arch import ECGNet

# ── Global model cache ────────────────────────────────────────────────────────
_model = None

LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
CLASS_NAMES = {0: 'NORM', 1: 'MI', 2: 'STTC', 3: 'CD'}


def load_ecg_model():
    global _model
    if _model is None:
        model_path = Path(__file__).parent.parent / 'models' / 'ecgnet_model.pth'
        _model = ECGNet(num_classes=4)
        _model.load_state_dict(torch.load(str(model_path), map_location='cpu'))
        _model.eval()
    return _model


def preprocess_wfdb(hea_bytes: bytes, dat_bytes: bytes) -> np.ndarray:
    """
    Saves .hea and .dat bytes to temp files, reads with wfdb.rdsamp().
    Returns signal as (12, 1000) float32 numpy array.
    Handles:
    - signals longer than 1000: take middle 1000 samples
    - signals shorter than 1000: zero pad to 1000
    - signals with fewer than 12 leads: zero pad leads to 12
    - signals with more than 12 leads: take first 12
    """
    import wfdb

    tmpdir = tempfile.mkdtemp()
    try:
        # Parse header to find the record name and dat file reference
        hea_text = hea_bytes.decode('latin-1')
        lines = [l.strip() for l in hea_text.split('\n') if l.strip() and not l.strip().startswith('#')]

        # First line: "<record_name> <n_sig> <fs> [<n_samp>] ..."
        record_name = lines[0].split()[0] if lines else 'record'
        # Use only the basename (strip any embedded path)
        record_name = os.path.basename(record_name)

        # Find the .dat file reference from signal lines
        dat_filename = record_name + '.dat'
        for line in lines[1:]:
            parts = line.split()
            if parts:
                ref = parts[0]
                if not ref.endswith('.dat'):
                    ref = ref + '.dat'
                dat_filename = os.path.basename(ref)
                break

        hea_path = os.path.join(tmpdir, record_name + '.hea')
        dat_path = os.path.join(tmpdir, dat_filename)

        with open(hea_path, 'wb') as f:
            f.write(hea_bytes)
        with open(dat_path, 'wb') as f:
            f.write(dat_bytes)

        signal, fields = wfdb.rdsamp(os.path.join(tmpdir, record_name))
        # signal shape: (num_samples, num_leads)
        raw_signal = signal  # keep original orientation for debugging
        meta = fields
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    # Transpose to (num_leads, num_samples)
    signal = signal.T.astype(np.float32)  # (num_leads, num_samples)
    num_leads, num_samples = signal.shape

    # Handle leads
    if num_leads > 12:
        signal = signal[:12, :]
    elif num_leads < 12:
        pad = np.zeros((12 - num_leads, signal.shape[1]), dtype=np.float32)
        signal = np.concatenate([signal, pad], axis=0)

    # Handle samples
    target = 1000
    if num_samples > target:
        # Take middle 1000 samples
        start = (num_samples - target) // 2
        signal = signal[:, start:start + target]
    elif num_samples < target:
        # Zero pad to 1000
        pad = np.zeros((12, target - num_samples), dtype=np.float32)
        signal = np.concatenate([signal, pad], axis=1)

    return signal  # (12, 1000)


def run_gradcam(model: torch.nn.Module, signal_tensor: torch.Tensor) -> np.ndarray:
    """
    signal_tensor: (1, 12, 1000)
    Returns: heatmap as (1000,) float32 array, values 0-1 normalized.

    Steps:
    1. Register forward hook on model.conv3 to capture activations
    2. Register backward hook on model.conv3 to capture gradients
    3. Forward pass -> get predicted class
    4. Backward pass on predicted class score
    5. Global average pool gradients over time dimension -> weights (128,)
    6. Weighted sum of activations -> raw cam (time_steps,)
    7. ReLU -> upsample to 1000 using np.interp
    8. Normalize to 0-1
    9. Remove hooks
    """
    activations = {}
    gradients = {}

    def forward_hook(module, input, output):
        activations['conv3'] = output.detach()  # (1, 128, T)

    def backward_hook(module, grad_input, grad_output):
        gradients['conv3'] = grad_output[0].detach()  # (1, 128, T)

    fwd_handle = model.conv3.register_forward_hook(forward_hook)
    bwd_handle = model.conv3.register_full_backward_hook(backward_hook)

    try:
        signal_tensor = signal_tensor.requires_grad_(False)
        model.zero_grad()

        # Forward pass
        logits = model(signal_tensor)  # (1, 4)
        pred_class = logits.argmax(dim=1).item()

        # Backward pass on predicted class score
        score = logits[0, pred_class]
        score.backward()

        # Grad-CAM computation
        acts = activations['conv3']   # (1, 128, T)
        grads = gradients['conv3']    # (1, 128, T)

        # Global average pool gradients over time -> weights (128,)
        weights = grads[0].mean(dim=1)  # (128,)

        # Weighted sum of activations -> raw cam (T,)
        raw_cam = (weights[:, None] * acts[0]).sum(dim=0)  # (T,)
        raw_cam = raw_cam.numpy()

        # ReLU
        raw_cam = np.maximum(raw_cam, 0)

        # Upsample to 1000 via linear interpolation
        T = len(raw_cam)
        x_from = np.linspace(0, 999, T)
        x_to = np.arange(1000)
        cam_1000 = np.interp(x_to, x_from, raw_cam).astype(np.float32)

        # Normalize to 0-1
        cam_min, cam_max = cam_1000.min(), cam_1000.max()
        if cam_max - cam_min > 1e-8:
            cam_1000 = (cam_1000 - cam_min) / (cam_max - cam_min)
        else:
            cam_1000 = np.zeros_like(cam_1000)

        return cam_1000

    finally:
        fwd_handle.remove()
        bwd_handle.remove()


LITERATURE_BANDS = {
    'norm': {'id': 'norm', 'label': 'NORM', 'min_hz': 0.05, 'max_hz': 0.5},
    'mi':   {'id': 'mi',   'label': 'MI',   'min_hz': 0.5,  'max_hz': 20.0},
    'sttc': {'id': 'sttc', 'label': 'STTC', 'min_hz': 0.5,  'max_hz': 40.0},
    'cd':   {'id': 'cd',   'label': 'CD',   'min_hz': 5.0,  'max_hz': 40.0},
}

CLASS_KEYS = ['norm', 'mi', 'sttc', 'cd']


def compute_suggested_bands(signal, gradcam, predicted_class_idx, sample_rate=100.0, threshold=0.5):
    bands = [dict(LITERATURE_BANDS[k]) for k in CLASS_KEYS]

    try:
        roi_mask = gradcam >= threshold
    except Exception:
        roi_mask = np.array([False] * len(gradcam))

    roi_samples = signal[roi_mask] if roi_mask.sum() > 10 else signal

    if len(roi_samples) < 4:
        return bands

    fft_mag = np.abs(np.fft.rfft(roi_samples))
    fft_freqs = np.fft.rfftfreq(len(roi_samples), d=1.0 / sample_rate)

    cumulative_energy = np.cumsum(fft_mag ** 2)
    total_energy = cumulative_energy[-1]
    if total_energy > 1e-10:
        low_idx = np.searchsorted(cumulative_energy, total_energy * 0.1)
        high_idx = np.searchsorted(cumulative_energy, total_energy * 0.9)
        min_hz = float(np.clip(fft_freqs[low_idx], 0.05, sample_rate / 2))
        high_idx = min(high_idx, len(fft_freqs) - 1)
        max_hz = float(np.clip(fft_freqs[high_idx], min_hz + 0.5, sample_rate / 2))

        winning_key = CLASS_KEYS[predicted_class_idx]
        for band in bands:
            if band['id'] == winning_key:
                band['min_hz'] = round(min_hz, 2)
                band['max_hz'] = round(max_hz, 2)
                break

    return bands


def compute_suggested_wavelet_levels(
    signal: np.ndarray,
    gradcam: np.ndarray,
    wavelet: str = 'db4',
    levels: int = 4,
    threshold: float = 0.5,
) -> dict:
    """
    Maps Grad-CAM attention regions to wavelet decomposition levels.

    Finds which wavelet levels have the highest energy concentration
    inside the Grad-CAM highlighted region (values >= threshold).
    Returns suggested slider weights per level (0.5 to 2.0 range).

    This is more meaningful than FFT-based bands because:
    - Grad-CAM gives time-localized attention
    - Wavelets preserve time-frequency localization at each level
    - FFT would lose the time context Grad-CAM provides
    """
    import pywt

    signal = np.asarray(signal)
    gradcam = np.asarray(gradcam)

    # Clamp levels to valid range
    max_level = pywt.dwt_max_level(len(signal), pywt.Wavelet(wavelet).dec_len)
    levels = min(levels, max_level)
    if levels < 1:
        levels = 1

    # Get ROI mask from Grad-CAM
    roi_mask = gradcam >= threshold
    if roi_mask.sum() < 5:
        # Fallback: use top 20% of attention if threshold yields too few samples
        roi_mask = gradcam >= np.percentile(gradcam, 80)

    # Decompose signal into wavelet levels
    # coeffs[0] = cA_n (approx), coeffs[1] = cD_n, ..., coeffs[-1] = cD_1
    coeffs = pywt.wavedec(signal, wavelet, level=levels)

    level_energies = {}

    for i, coeff_arr in enumerate(coeffs):
        coeff_len = len(coeff_arr)
        if coeff_len == 0:
            continue

        # Downsample ROI mask to match this level's coefficient count
        # using linear interpolation of indices
        indices = np.linspace(0, len(roi_mask) - 1, coeff_len).astype(int)
        roi_at_level = roi_mask[indices]

        # Compute energy ratio: ROI energy / total energy at this level
        total_energy = float(np.sum(coeff_arr ** 2)) + 1e-10
        roi_energy = float(np.sum(coeff_arr[roi_at_level] ** 2))
        ratio = roi_energy / total_energy

        if i == 0:
            level_energies['approx'] = ratio
        else:
            # coeffs[1] = highest level detail (level_N), coeffs[-1] = level_1
            level_id = f'level_{levels - i + 1}'
            level_energies[level_id] = ratio

    if not level_energies:
        return {}

    # Normalize to slider range 0.5-2.0
    # Level with highest ROI energy concentration gets weight 2.0
    # Level with lowest gets weight 0.5
    max_energy = max(level_energies.values()) or 1.0
    min_energy = min(level_energies.values()) or 0.0
    energy_range = max_energy - min_energy or 1.0

    suggested_weights = {}
    for level_id, energy in level_energies.items():
        normalized = (energy - min_energy) / energy_range  # 0 to 1
        weight = round(0.5 + normalized * 1.5, 2)  # 0.5 to 2.0
        suggested_weights[level_id] = weight

    return suggested_weights


def analyze_ecg(hea_bytes: bytes, dat_bytes: bytes) -> dict:
    """
    Returns:
    {
        "predicted_class": "MI",
        "class_index": 1,
        "probabilities": {"NORM": 0.12, "MI": 0.71, "STTC": 0.10, "CD": 0.07},
        "gradcam": [0.1, 0.3, 0.8, ...],  # 1000 values 0-1
        "leads": {
            "I": [...],   # 1000 samples each, all 12 leads
            ...
            "V6": [...]
        },
        "sample_rate": 100
    }
    """
    # Preprocess
    signal = preprocess_wfdb(hea_bytes, dat_bytes)  # (12, 1000)

    # Prepare tensor
    signal_tensor = torch.tensor(signal[np.newaxis], dtype=torch.float32)  # (1, 12, 1000)

    # Load model
    model = load_ecg_model()

    # Run Grad-CAM (includes forward/backward pass)
    gradcam = run_gradcam(model, signal_tensor)  # (1000,)

    # Run inference (separate forward pass for clean probabilities)
    with torch.no_grad():
        logits = model(signal_tensor)  # (1, 4)
        probs = torch.softmax(logits, dim=1)[0].numpy()  # (4,)

    pred_class_idx = int(probs.argmax())
    pred_class_name = CLASS_NAMES[pred_class_idx]

    probabilities = {CLASS_NAMES[i]: float(round(probs[i], 4)) for i in range(4)}

    # Build leads dict in standard clinical order
    leads = {}
    for i, name in enumerate(LEAD_NAMES):
        leads[name] = signal[i].tolist()

    # Compute suggested bands from Grad-CAM ROI + FFT (uses Lead II at index 1)
    try:
        suggested_bands = compute_suggested_bands(
            signal=signal[1],
            gradcam=gradcam,
            predicted_class_idx=pred_class_idx,
            sample_rate=100.0,
        )
    except Exception as _e:
        print('Failed to compute suggested_bands:', _e)
        suggested_bands = [dict(x) for x in LITERATURE_BANDS.values()][:4]

    # Compute wavelet-based suggested weights using Grad-CAM ROI
    # Use the same wavelet config as the mode
    mode_cfg = {}
    try:
        # Try to get wavelet config from modes - use db4/4 as fallback
        from pathlib import Path as _Path
        import json as _json
        _modes_path = _Path(__file__).parent.parent.parent / 'config' / 'modes.json'
        if _modes_path.exists():
            with _modes_path.open() as _f:
                _modes = _json.load(_f)
            mode_cfg = _modes.get('ecg', {}).get('wavelet_config', {})
    except Exception:
        pass

    _wavelet = mode_cfg.get('wavelet', 'db4')
    _levels = int(mode_cfg.get('levels', 4))

    suggested_wavelet_weights = compute_suggested_wavelet_levels(
        signal=signal[1],  # Lead II, shape (1000,)
        gradcam=gradcam,
        wavelet=_wavelet,
        levels=_levels,
        threshold=0.5,
    )

    return {
        "predicted_class": pred_class_name,
        "class_index": pred_class_idx,
        "probabilities": probabilities,
        "gradcam": gradcam.tolist(),
        "leads": leads,
        "sample_rate": 100,
        "suggested_bands": suggested_bands,
        "suggested_wavelet_weights": suggested_wavelet_weights,
        "signal_100hz": signal[1].tolist(),
    }