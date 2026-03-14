import io
import json
import traceback
from pathlib import Path
from typing import Dict, Any

import librosa
import numpy as np
from flask import Flask, jsonify, request

# Merged Imports
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

            # Optional flag for enabling the AI backend output
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

            # Choose between Abnormality Processing or Standard Equalizer
            # Optionally compute an 'AI' output if requested by the frontend.
            y_ai = None

            if mode == "ecg_abnormalities":
                y_eq = process_abnormality_mode(y, sr, weights)

            else:
                # Always compute the standard equalizer result (FFT-based)
                y_eq = apply_equalizer(y, float(sr), bands, weights)

                # For musical mode, optionally compute the AI output when enabled by the client
                if mode == "musical" and use_ai:
                    try:
                        from app.services.music_model import process_from_array
                        y_ai = process_from_array(y.astype(np.float32), int(sr), weights)
                    except Exception as e:
                        print(f"[musical AI] failed: {e} — using equalizer output")
                        y_ai = None

            # 3. Wavelet Pipeline (Keeping all your wavelet logic)
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