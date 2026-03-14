import io
import json
from pathlib import Path
from typing import Dict, Any

import librosa
import numpy as np
from flask import Flask, jsonify, request

from app.services.equalizer_service import apply_equalizer
from app.services.transform_service import compute_spectrogram, compute_fft_magnitude
from app.services.abnormality_service import process_abnormality_mode



def load_modes_config() -> Dict[str, Any]:
    """Load slider-band configuration for different modes."""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "modes.json"
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def load_generic_config() -> Dict[str, Any]:
    """Load saved generic configuration."""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "generic_saved.json"
    if not config_path.exists():
        return {"bands": []}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)

def save_generic_config(bands: list) -> None:
    """Save generic configuration to file."""
    config_path = Path(__file__).resolve().parent.parent.parent / "config" / "generic_saved.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with config_path.open("w", encoding="utf-8") as f:
        json.dump({"bands": bands}, f, indent=2)

def register_routes(app: Flask) -> None:
    """Register all API routes."""
    
    modes_config = load_modes_config()

    @app.get("/")
    def index():
        return jsonify({"status": "ok", "message": "Signal Equalizer Backend"})

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "message": "Backend is up"})

    @app.get("/modes")
    def get_modes():
        """Return full contents of modes.json."""
        return jsonify(modes_config)

    @app.get("/config/load")
    def load_config():
        """Load saved generic configuration."""
        return jsonify(load_generic_config())

    @app.post("/config/save")
    def save_config():
        """Save generic configuration."""
        data = request.get_json()
        if not data or "bands" not in data:
            return jsonify({"error": "Missing 'bands' in request body"}), 400
        
        bands = data["bands"]
        if not isinstance(bands, list):
            return jsonify({"error": "'bands' must be a list"}), 400
        
        save_generic_config(bands)
        return jsonify({"status": "ok", "message": "Configuration saved"})

    @app.post("/transform")
    def transform():
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded under field 'file'"}), 400

        file = request.files["file"]
        filename = file.filename or ""
        if not filename.lower().endswith(".wav"):
            return jsonify({"error": "Only .wav files are supported"}), 400

        file_bytes = io.BytesIO(file.read())

        # 1. Load audio
        y, sr = librosa.load(file_bytes, sr=11025, mono=True)
        
        # 2. Get mode and weights
        mode = request.form.get("mode", "generic")
        weights_raw = request.form.get("weights")
        weights = json.loads(weights_raw) if weights_raw else {}

        # 3. Handle Bands Configuration
        bands = []
        if mode == "generic":
            bands_raw = request.form.get("bands")
            if bands_raw:
                try:
                    bands = json.loads(bands_raw)
                except json.JSONDecodeError:
                    return jsonify({"error": "Invalid JSON in 'bands' field"}), 400
        else:
            mode_cfg = modes_config.get(mode)
            if mode_cfg:
                bands = mode_cfg.get("bands", [])

        # 4. Apply Transformation Logic (Simulation vs Equalization)
        if mode == "ecg_abnormalities":
            # Use the "Mixer" for abnormality simulation
            y_eq = process_abnormality_mode(y, sr, weights)
        else:
            # Use standard equalizer for all other modes
            y_eq = apply_equalizer(y, float(sr), bands, weights, mode)

        # 5. AI Analysis (Run on the RESULTING signal y_eq)
        ai_results = None
        if mode in ["ecg", "ecg_abnormalities"]:

            # For simplicity, we'll just return a placeholder here.
            # In a real implementation, you'd call your AI service like:
            # ai_results = ecg_ai.analyze(y_eq)
            ai_results = {"placeholder": "ECG analysis results would go here"}
            
           

        # 6. Compute spectrograms and FFT for the UI
        try:
            in_f, in_t, in_S = compute_spectrogram(y, float(sr))
            out_f, out_t, out_S = compute_spectrogram(y_eq, float(sr))
            freq_axis, input_mag = compute_fft_magnitude(y, float(sr))
            _, output_mag = compute_fft_magnitude(y_eq, float(sr))
        except ValueError as e:
            return jsonify({"error": f"Computation failed: {str(e)}"}), 400

        # 7. Prepare Response
        max_audio_samples = 100_000
        audio_step = max(1, len(y) // max_audio_samples)

        response: Dict[str, Any] = {
            "filename": filename,
            "sample_rate": int(sr),
            "audio_step": int(audio_step),
            "preview_sample_rate": float(sr) / float(audio_step),
            "mode": mode,
            "weights": weights,
            "num_samples": int(len(y)),
            "input_audio": y[::audio_step].tolist(),
            "output_audio": y_eq[::audio_step].tolist(),
            "spectrogram_input": {"freqs": in_f, "times": in_t, "values": in_S},
            "spectrogram_output": {"freqs": out_f, "times": out_t, "values": out_S},
            "fft_freqs": freq_axis,
            "input_fft": input_mag,
            "output_fft": output_mag,
        }

        return jsonify(response)