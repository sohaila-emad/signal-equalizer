import io
import importlib
import importlib.util
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Dict, Any

import librosa
import numpy as np
import requests as _requests
from flask import Flask, jsonify, request

from app.services.equalizer_service import apply_equalizer, apply_wavelet_equalizer
from app.services.transform_service import compute_spectrogram, compute_fft_magnitude, compute_wavelet_level_ranges
from app.services.abnormality_service import process_abnormality_mode


def load_modes_config() -> Dict[str, Any]:
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "modes.json"
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def load_generic_config() -> Dict[str, Any]:
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "generic_saved.json"
    if not config_path.exists():
        return {"bands": []}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def save_generic_config(bands: list) -> None:
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "generic_saved.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with config_path.open("w", encoding="utf-8") as f:
        json.dump({"bands": bands}, f, indent=2)


# ── DPRNN model cache (loaded once per process) ───────────────────────────────
_DPRNN_MODEL   = None
_DPRNN_SR      = 8000

# ── AudioSep model cache (loaded once per process) ────────────────────────────
_AUDIOSEP_MODEL = None
_AUDIOSEP_SR    = 32000
_AUDIOSEP_DIR   = str(Path(__file__).resolve().parent.parent.parent.parent / "AudioSep")
_AUDIOSEP_PASSES = 3
_MODEL_PY_URL  = (
    "https://raw.githubusercontent.com/asteroid-team/asteroid/"
    "master/egs/wsj0-mix-var/Multi-Decoder-DPRNN/model.py"
)
_MODEL_PY_PATH = Path(__file__).resolve().parent.parent.parent / "multidecoder_model.py"


def _get_dprnn_model():
    """Lazy-load MultiDecoderDPRNN; result cached for the lifetime of the process."""
    global _DPRNN_MODEL
    if _DPRNN_MODEL is not None:
        return _DPRNN_MODEL

    import torch

    # Patch torch.load for PyTorch >= 2.6
    _orig = torch.load
    def _patched(f, *a, **kw):
        kw.setdefault("weights_only", False)
        return _orig(f, *a, **kw)
    torch.load = _patched

    # Download model class from GitHub if not already cached locally
    if not _MODEL_PY_PATH.exists():
        print("[DPRNN] Downloading model class from GitHub…")
        r = _requests.get(_MODEL_PY_URL, timeout=30)
        r.raise_for_status()
        _MODEL_PY_PATH.write_text(r.text, encoding="utf-8")
        print(f"[DPRNN] Saved to: {_MODEL_PY_PATH}")

    spec = importlib.util.spec_from_file_location("multidecoder_model", str(_MODEL_PY_PATH))
    mod  = importlib.util.module_from_spec(spec)
    sys.modules["multidecoder_model"] = mod
    spec.loader.exec_module(mod)

    print("[DPRNN] Loading pretrained weights from HuggingFace…")
    _DPRNN_MODEL = mod.MultiDecoderDPRNN.from_pretrained("JunzheJosephZhu/MultiDecoderDPRNN")
    _DPRNN_MODEL.eval()
    print("[DPRNN] Model ready.")
    return _DPRNN_MODEL


_AUDIOSEP_REPO_URL = "https://github.com/Audio-AGI/AudioSep.git"
_AUDIOSEP_CHECKPOINTS = [
    (
        "https://huggingface.co/spaces/badayvedat/AudioSep/resolve/main/"
        "checkpoint/audiosep_base_4M_steps.ckpt",
        "checkpoint/audiosep_base_4M_steps.ckpt",
    ),
    (
        "https://huggingface.co/spaces/badayvedat/AudioSep/resolve/main/"
        "checkpoint/music_speech_audioset_epoch_15_esc_89.98.pt",
        "checkpoint/music_speech_audioset_epoch_15_esc_89.98.pt",
    ),
]


def _ensure_audiosep_repo():
    """Clone AudioSep repo + download checkpoints + patch factory.py if needed."""
    asep = Path(_AUDIOSEP_DIR)

    # 1) Clone repo if missing
    if not (asep / "pipeline.py").exists():
        print(f"[AudioSep] Cloning repo into {asep} …")
        subprocess.check_call(
            ["git", "clone", _AUDIOSEP_REPO_URL, str(asep)],
            stdout=sys.stdout, stderr=sys.stderr,
        )

    # 2) Download checkpoint files if missing
    ckpt_dir = asep / "checkpoint"
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    for url, rel_path in _AUDIOSEP_CHECKPOINTS:
        dest = asep / rel_path
        if dest.exists() and dest.stat().st_size > 1000:
            continue
        print(f"[AudioSep] Downloading {dest.name} …")
        # Use (connect_timeout, read_timeout) — large files need long read timeout
        r = _requests.get(url, stream=True, timeout=(30, 600))
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(65536):
                if chunk:
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        print(f"\r  {done / 1024 / 1024:.0f} / "
                              f"{total / 1024 / 1024:.0f} MB", end="")
        print(f"\n  {dest.name} done.")

    # 3) Patch factory.py for torch >= 2.6 (weights_only + strict)
    factory = asep / "models" / "CLAP" / "open_clip" / "factory.py"
    if factory.exists():
        src = factory.read_text(encoding="utf-8")
        patched = False
        old_load = "torch.load(checkpoint_path, map_location=map_location)"
        new_load = ("torch.load(checkpoint_path, map_location=map_location, "
                     "weights_only=False)")
        if old_load in src:
            src = src.replace(old_load, new_load)
            patched = True
        old_strict = "model.load_state_dict(ckpt)"
        new_strict = "model.load_state_dict(ckpt, strict=False)"
        if old_strict in src:
            src = src.replace(old_strict, new_strict)
            patched = True
        if patched:
            factory.write_text(src, encoding="utf-8")
            print("[AudioSep] Patched factory.py for torch >= 2.6")


def _get_audiosep_model():
    """Lazy-load AudioSep; auto-clones repo & downloads weights on first run."""
    global _AUDIOSEP_MODEL
    if _AUDIOSEP_MODEL is not None:
        return _AUDIOSEP_MODEL

    import torch

    _ensure_audiosep_repo()

    if _AUDIOSEP_DIR not in sys.path:
        sys.path.insert(0, _AUDIOSEP_DIR)

    saved_cwd = os.getcwd()
    os.chdir(_AUDIOSEP_DIR)
    try:
        from pipeline import build_audiosep

        device = torch.device("cpu")
        print("[AudioSep] Loading model …")
        _AUDIOSEP_MODEL = build_audiosep(
            config_yaml="config/audiosep_base.yaml",
            checkpoint_path="checkpoint/audiosep_base_4M_steps.ckpt",
            device=device,
        )
        print("[AudioSep] Model ready.")
    finally:
        os.chdir(saved_cwd)

    return _AUDIOSEP_MODEL


# ─────────────────────────────────────────────────────────────────────────────

def register_routes(app: Flask) -> None:
    modes_config = load_modes_config()

    @app.get("/")
    def index():
        return jsonify({"status": "ok", "message": "Signal Equalizer Backend"})

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "message": "Backend is up"})

    @app.get("/modes")
    def get_modes():
        return jsonify(modes_config)

    @app.get("/config/load")
    def load_config():
        return jsonify(load_generic_config())

    @app.post("/config/save")
    def save_config():
        data = request.get_json()
        if not data or "bands" not in data:
            return jsonify({"error": "Missing 'bands'"}), 400
        save_generic_config(data["bands"])
        return jsonify({"status": "ok", "message": "Configuration saved"})

    @app.post("/transform")
    def transform():
        try:
            if "file" not in request.files:
                return jsonify({"error": "No file uploaded"}), 400

            file = request.files["file"]
            file_bytes = io.BytesIO(file.read())

            # 1. Loading & Mode Setup
            mode = request.form.get("mode", "generic")
            target_sr = 500 if mode in ['ecg', 'ecg_abnormalities'] else 11025
            y, sr = librosa.load(file_bytes, sr=target_sr, mono=True)

            weights_raw = request.form.get("weights")
            weights = json.loads(weights_raw) if weights_raw else {}

            use_ai_raw = request.form.get("use_ai", "0")
            use_ai = str(use_ai_raw).lower() in ("1", "true", "t", "yes")

            # 2. Handle Bands & Main Signal Processing
            bands = []
            if mode == "generic":
                bands_raw = request.form.get("bands")
                if bands_raw:
                    bands = json.loads(bands_raw)
            else:
                mode_cfg = modes_config.get(mode, {})
                bands = mode_cfg.get("bands", [])

            y_ai = None
            ai_analysis = None  # <--- New variable to hold the Ground Truth data

            if mode == "ecg_abnormalities":
                y_eq = process_abnormality_mode(y, sr, weights)
            else:
                y_eq = apply_equalizer(y, float(sr), bands, weights)

                if mode == "musical" and use_ai:
                    try:
                        from app.services.music_model import process_from_array
                        # UPDATED: Now receives both the audio and the analysis dict
                        y_ai, ai_analysis = process_from_array(y.astype(np.float32), int(sr), weights)
                    except Exception as e:
                        print(f"[musical AI] failed: {e} — using equalizer output")
                        y_ai = None
                        ai_analysis = None

            # 3. Wavelet Pipeline
            wavelet_weights_raw = request.form.get("wavelet_weights")
            wavelet_weights = json.loads(wavelet_weights_raw) if wavelet_weights_raw else {}

            if mode == "generic":
                wavelet = request.form.get("wavelet", "db4")
                wavelet_levels = int(request.form.get("wavelet_levels", 4))
            else:
                mode_cfg = modes_config.get(mode, {})
                w_cfg = mode_cfg.get("wavelet_config", {"wavelet": "db4", "levels": 4})
                wavelet = w_cfg.get("wavelet", "db4")
                wavelet_levels = int(w_cfg.get("levels", 4))

            y_wavelet = apply_wavelet_equalizer(y, float(sr), wavelet, wavelet_levels, wavelet_weights)

            # 4. Math Transforms
            in_f, in_t, in_S = compute_spectrogram(y, float(sr))
            out_f, out_t, out_S = compute_spectrogram(y_eq, float(sr))
            freq_axis, input_mag = compute_fft_magnitude(y, float(sr))
            _, output_mag = compute_fft_magnitude(y_eq, float(sr))
            wavelet_level_bands = compute_wavelet_level_ranges(float(sr), wavelet, wavelet_levels)

            # 5. Build Response
            max_audio_samples = 100_000
            step = max(1, len(y) // max_audio_samples)

            return jsonify({
                "filename": file.filename,
                "sample_rate": int(sr),
                "audio_step": int(step),
                "preview_sample_rate": float(sr) / float(step),
                "mode": mode,
                "weights": weights,
                "num_samples": int(len(y)),
                "input_audio": y[::step].tolist(),
                "output_audio": y_eq[::step].tolist(),
                "output_wavelet_audio": y_wavelet[::step].tolist(),
                "output_ai": y_ai[::step].tolist() if y_ai is not None else None,
                "ai_analysis": ai_analysis,  # <--- INJECTED: Sends detected min/max to React
                "spectrogram_input": {"freqs": in_f, "times": in_t, "values": in_S},
                "spectrogram_output": {"freqs": out_f, "times": out_t, "values": out_S},
                "fft_freqs": freq_axis,
                "input_fft": input_mag,
                "output_fft": output_mag,
                "wavelet_level_bands": wavelet_level_bands,
                "wavelet_config_used": {"wavelet": wavelet, "levels": wavelet_levels},
            })
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": "Internal server error", "detail": str(e)}), 500
    @app.post("/separate")
    def separate():
        """
        Separate voices from a WAV file using Multi-Decoder DPRNN.

        Form fields:
            file   – WAV audio file (required)
            n_src  – int 2-5 (optional; omit for auto-detect)

        Returns JSON:
            {
              "sources": [{ "id": 1, "audio": [...], "sample_rate": 8000, "peak_db": -1.2 }, ...],
              "n_sources": <int>,
              "sample_rate": 8000,
              "audio_step": <int>
            }
        """
        try:
            import torch
            from scipy.signal import resample_poly
            from math import gcd

            if "file" not in request.files:
                return jsonify({"error": "No file uploaded"}), 400

            file      = request.files["file"]
            n_src_raw = request.form.get("n_src")
            n_src     = int(n_src_raw) if n_src_raw else None

            # Load & resample to 8 kHz (DPRNN requirement)
            file_bytes = io.BytesIO(file.read())
            y, sr = librosa.load(file_bytes, sr=None, mono=True)

            if int(sr) != _DPRNN_SR:
                g  = gcd(int(sr), _DPRNN_SR)
                y  = resample_poly(y, _DPRNN_SR // g, int(sr) // g).astype(np.float32)
                sr = _DPRNN_SR

            # Run separation
            model   = _get_dprnn_model()
            mixture = torch.tensor(y, dtype=torch.float32).unsqueeze(0)  # (1, T)

            with torch.no_grad():
                separated = (
                    model.separate(mixture)
                    if n_src is None
                    else model.separate(mixture, n_src=n_src)
                )

            if separated.dim() == 3:
                separated = separated.squeeze(0)   # → (n_src, T)

            n_separated = separated.shape[0]

            # Normalise & downsample for JSON payload (~10 s preview at 8 kHz)
            max_samples = 80_000
            step        = max(1, separated.shape[1] // max_samples)

            sources = []
            for i in range(n_separated):
                audio = separated[i].numpy()
                peak  = float(np.abs(audio).max())
                if peak > 1e-6:
                    audio = audio / peak * 0.95
                sources.append({
                    "id":          i + 1,
                    "audio":       audio[::step].tolist(),
                    "sample_rate": float(sr) / float(step),
                    "peak_db":     round(20 * np.log10(peak + 1e-9), 1),
                })

            return jsonify({
                "sources":     sources,
                "n_sources":   n_separated,
                "sample_rate": int(sr),
                "audio_step":  int(step),
            })

        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": "Separation failed", "detail": str(e)}), 500

    @app.post("/separate_animal")
    def separate_animal():
        """
        Separate animal sounds from a WAV file using AudioSep.

        Form fields:
            file    – WAV audio file (required)
            queries – JSON array of text descriptions, e.g. '["dog barking","cat meowing"]'

        Returns JSON:
            {
              "sources": [{ "id", "label", "audio", "sample_rate" }],
              "sample_rate": 32000
            }
        """
        try:
            import torch
            from scipy.signal import resample_poly
            from math import gcd

            if "file" not in request.files:
                return jsonify({"error": "No file uploaded"}), 400

            queries_raw = request.form.get("queries")
            if not queries_raw:
                return jsonify({"error": "Missing 'queries'"}), 400
            queries = json.loads(queries_raw)
            if not isinstance(queries, list) or len(queries) == 0:
                return jsonify({"error": "'queries' must be a non-empty JSON array"}), 400

            # Load & resample to 32 kHz (AudioSep requirement)
            file       = request.files["file"]
            file_bytes = io.BytesIO(file.read())
            y, sr = librosa.load(file_bytes, sr=None, mono=True)

            if int(sr) != _AUDIOSEP_SR:
                g  = gcd(int(sr), _AUDIOSEP_SR)
                y  = resample_poly(y, _AUDIOSEP_SR // g, int(sr) // g).astype(np.float32)
                sr = _AUDIOSEP_SR

            model  = _get_audiosep_model()
            device = torch.device("cpu")

            mixture = torch.tensor(y, dtype=torch.float32).unsqueeze(0).unsqueeze(0)  # (1,1,T)

            # At 32 kHz, 320_000 samples = 10 s  — keeps full duration for typical clips.
            # For very long files the step will be > 1 and the preview rate adjusts below.
            max_samples = 320_000
            sources = []

            for idx, query_text in enumerate(queries):
                # Encode the text query once (same for all passes)
                conditions = model.query_encoder.get_query_embed(
                    modality="text",
                    text=[query_text],
                    device=device,
                )

                # Iterative refinement: run AudioSep N passes,
                # feeding each output back as input for cleaner separation
                current = mixture
                for pass_num in range(_AUDIOSEP_PASSES):
                    input_dict = {"mixture": current, "condition": conditions}
                    with torch.no_grad():
                        sep_wav = model.ss_model(input_dict)["waveform"]
                    current = sep_wav   # feed output → next pass input

                # (1, 1, T) or (1, T) → 1-D numpy
                audio = current.squeeze().cpu().numpy().astype(np.float32)

                # Normalise to 0.95 peak
                peak = float(np.abs(audio).max())
                if peak > 1e-6:
                    audio = audio / peak * 0.95

                # Downsample for JSON only when the clip is very long
                step         = max(1, len(audio) // max_samples)
                preview_rate = float(sr) / float(step)   # effective playback rate

                sources.append({
                    "id":          idx + 1,
                    "label":       query_text,
                    "audio":       audio[::step].tolist(),
                    "sample_rate": preview_rate,          # used by CineViewer & WAV encoder
                })

            return jsonify({
                "sources":     sources,
                "sample_rate": int(sr),                  # original full rate (informational)
            })

        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": "Animal separation failed", "detail": str(e)}), 500
    @app.post("/ecg/analyze")
    def ecg_analyze():
        """
        Accepts multipart/form-data with two files:
        - 'hea_file': the .hea file
        - 'dat_file': the .dat file

        Returns JSON from analyze_ecg()
        """
        if 'hea_file' not in request.files or 'dat_file' not in request.files:
            return jsonify({"error": "Both .hea and .dat files required"}), 400

        hea_file = request.files['hea_file']
        dat_file = request.files['dat_file']

        if not hea_file.filename.endswith('.hea'):
            return jsonify({"error": "First file must be .hea"}), 400
        if not dat_file.filename.endswith('.dat'):
            return jsonify({"error": "Second file must be .dat"}), 400

        from app.services.ecg_service import analyze_ecg
        try:
            result = analyze_ecg(hea_file.read(), dat_file.read())
            return jsonify(result)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500