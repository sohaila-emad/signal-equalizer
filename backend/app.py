from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, Dict

import librosa
import numpy as np
import soundfile as sf
from flask import Flask, jsonify, redirect, request, url_for
from flask_cors import CORS

from manual_dft import dft, idft, sliding_window_spectrogram


def load_modes_config() -> Dict[str, Any]:
    """
    Load slider-band configuration for different modes (musical / animal / human).
    """
    config_path = Path(__file__).resolve().parent / "modes.json"
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def apply_equalizer(
    spectrum: np.ndarray,
    sample_rate: float,
    mode: str,
    weights: Dict[str, float],
    modes_config: Dict[str, Any],
) -> np.ndarray:
    """
    Apply simple band-gain equalization in the frequency domain.

    Parameters
    ----------
    spectrum : np.ndarray
        Complex spectrum from the DFT.
    sample_rate : float
        Sampling rate in Hz.
    mode : str
        Mode key (e.g. "musical", "animal", "human").
    weights : Dict[str, float]
        Mapping from band id -> gain multiplier.
    modes_config : Dict[str, Any]
        Configuration loaded from modes.json.
    """
    mode_cfg = modes_config.get(mode)
    if not mode_cfg:
        return spectrum

    bands = mode_cfg.get("bands", [])
    if not bands:
        return spectrum

    freqs = np.linspace(0.0, sample_rate, spectrum.shape[0], endpoint=False)
    equalized = spectrum.copy()

    for band in bands:
        band_id = band.get("id")
        if band_id is None:
            continue
        gain = float(weights.get(band_id, 1.0))
        f_min = float(band.get("min_hz", 0.0))
        f_max = float(band.get("max_hz", sample_rate / 2.0))
        mask = (freqs >= f_min) & (freqs < f_max)
        equalized[mask] *= gain

    return equalized


def create_app() -> Flask:
    app = Flask(__name__)
    # Allow calls from the React dev server (http://localhost:5173, etc.).
    CORS(app)
    modes_config = load_modes_config()

    @app.get("/")
    def index() -> Any:
        return redirect(url_for("health"))

    @app.get("/health")
    def health() -> Any:
        return jsonify({"status": "ok", "message": "Backend is up"})

    @app.post("/transform")
    def transform() -> Any:
        """
        Signal-processing pipeline entrypoint.

        Currently:
        - Accepts a .wav upload (field name: 'file') via multipart/form-data.
        - Optional form fields:
          - 'mode': one of the keys in modes.json (default: "musical")
          - 'weights': JSON object mapping band id -> gain (e.g. {"low": 1.2, "high": 0.8})
        - Loads audio with librosa (no FFT calls).
        - Runs the manual DFT on a short segment and applies simple equalization.
        - Runs the manual IDFT to reconstruct the equalized signal.
        - Computes a sliding-window spectrogram on the reconstructed segment.
        - Returns basic metadata and spectrogram shape.
        """
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded under field 'file'"}), 400

        file = request.files["file"]
        filename = file.filename or ""
        if not filename.lower().endswith(".wav"):
            return jsonify({"error": "Only .wav files are supported at this stage"}), 400

        file_bytes = io.BytesIO(file.read())

        # Use librosa only for loading audio samples (no FFT operations).
        y, sr = librosa.load(file_bytes, sr=None, mono=True)

        # Mode and slider weights (optional)
        mode = request.form.get("mode", "musical")
        weights_raw = request.form.get("weights")
        weights: Dict[str, float]
        if weights_raw:
            try:
                parsed = json.loads(weights_raw)
            except json.JSONDecodeError:
                return jsonify({"error": "Invalid JSON in 'weights' field"}), 400
            if not isinstance(parsed, dict):
                return jsonify({"error": "'weights' must be a JSON object"}), 400
            # Coerce all values to float
            weights = {str(k): float(v) for k, v in parsed.items()}
        else:
            weights = {}

        # Work on a short prefix of the signal for now.
        max_samples = min(len(y), 4096)
        segment = y[:max_samples]

        # Manual DFT + equalization + IDFT round-trip on this segment.
        spectrum = dft(segment)
        spectrum_eq = apply_equalizer(
            spectrum=spectrum,
            sample_rate=float(sr),
            mode=mode,
            weights=weights,
            modes_config=modes_config,
        )
        reconstructed = idft(spectrum_eq).real.astype(np.float32)

        # Simple sliding-window spectrogram (using the manual DFT under the hood)
        # on the reconstructed/equalized segment.
        window_size = 512
        hop_size = 256
        freqs, times, S = sliding_window_spectrogram(
            signal=reconstructed,
            sample_rate=float(sr),
            window_size=window_size,
            hop_size=hop_size,
        )

        # Only basic metadata is returned for now to keep the payload small.
        response: Dict[str, Any] = {
            "filename": filename,
            "sample_rate": int(sr),
            "num_samples": int(len(y)),
            "used_samples": int(max_samples),
            "mode": mode,
            "weights": weights,
            "dft_length": int(spectrum.shape[0]),
            "reconstructed_length": int(reconstructed.shape[0]),
            "spectrogram": {
                "freq_bins": int(S.shape[0]),
                "time_frames": int(S.shape[1]),
                "freq_min_hz": float(freqs[0]),
                "freq_max_hz": float(freqs[-1]),
            },
        }

        return jsonify(response)

    return app


app = create_app()


def _save_example_wav(path: str, duration: float = 1.0, sample_rate: int = 16000) -> None:
    """
    Dev helper: create a small sine wave file to test the pipeline.
    Not used by the API; can be called manually from a Python shell.
    """
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    freq = 440.0
    y = 0.2 * np.sin(2 * np.pi * freq * t)
    sf.write(path, y, sample_rate)


if __name__ == "__main__":
    app.run(debug=True)

