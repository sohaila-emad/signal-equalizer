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

from manual_dft import (
    get_dft_matrices,  # Added this
    dft_fast,          # Changed from dft
    idft_fast,         # Changed from idft
    sliding_window_spectrogram,
)


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
    N = spectrum.shape[0]

    for band in bands:
        band_id = band.get("id")
        if band_id is None:
            continue
        gain = float(weights.get(band_id, 1.0))
        f_min = float(band.get("min_hz", 0.0))
        f_max = float(band.get("max_hz", sample_rate / 2.0))

        # Positive frequencies
        mask = (freqs >= f_min) & (freqs < f_max)
        equalized[mask] *= gain

        # Negative-frequency counterparts (second half of the DFT bins)
        # Keep the spectrum Hermitian so the time-domain signal stays real.
        neg_mask = (freqs > sample_rate - f_max) & (freqs <= sample_rate - f_min)
        equalized[neg_mask] *= gain

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
        - Runs the manual DFT in blocks and applies simple equalization.
        - Runs the manual IDFT to reconstruct the equalized full-length signal.
        - Computes a sliding-window spectrogram on a prefix of the reconstructed signal.
        - Returns basic metadata, reconstructed audio samples, and a real-valued spectrogram
          suitable for JSON (no complex numbers).
        """
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded under field 'file'"}), 400

        file = request.files["file"]
        filename = file.filename or ""
        if not filename.lower().endswith(".wav"):
            return jsonify({"error": "Only .wav files are supported at this stage"}), 400

        file_bytes = io.BytesIO(file.read())

        # Use librosa only for loading audio samples (no FFT operations).
        # Downsample for speed; 11.025 kHz is enough for this demo.
        y, sr = librosa.load(file_bytes, sr=11025, mono=True)

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

        # Block-wise equalization to avoid O(N^2) memory/time on very long tracks.
        # Use smaller blocks and precomputed DFT matrices for speed.
        block_size = 1024
        n_samples = len(y)
        y_eq = np.zeros_like(y, dtype=np.float32)

        # Precompute DFT/IDFT matrices once for this block size.
        W, W_inv = get_dft_matrices(block_size)

        for start in range(0, n_samples, block_size):
            end = min(start + block_size, n_samples)
            block = y[start:end]

            # Pad if block is smaller than block_size (important for the DFT matrix size).
            actual_len = len(block)
            if actual_len < block_size:
                block = np.pad(block, (0, block_size - actual_len))

            spec_block = dft_fast(block, W)
            spec_block_eq = apply_equalizer(
                spectrum=spec_block,
                sample_rate=float(sr),
                mode=mode,
                weights=weights,
                modes_config=modes_config,
            )
            time_block_eq = idft_fast(spec_block_eq, W_inv).real.astype(np.float32)

            # Only write back the valid (un-padded) portion.
            y_eq[start:end] = time_block_eq[:actual_len]

        # Helper to generate spectrogram data (input and output) in dB.
        def get_spectro_data(sig: np.ndarray) -> tuple[list[float], list[float], list[list[float]]]:
            window_size = 512
            hop_size = 256
            max_samples = min(len(sig), 16384)
            freqs, times, S = sliding_window_spectrogram(
                signal=sig[:max_samples],
                sample_rate=float(sr),
                window_size=window_size,
                hop_size=hop_size,
            )
            # Convert to dB for better visibility and keep it real-valued.
            S_db = 20.0 * np.log10(np.abs(S) + 1e-6)
            # Downsample for payload size.
            f_ds = freqs[::2]
            t_ds = times[::2]
            S_ds = S_db[::2, ::2]
            return f_ds.tolist(), t_ds.tolist(), S_ds.tolist()

        in_f, in_t, in_S = get_spectro_data(y)
        out_f, out_t, out_S = get_spectro_data(y_eq)

        # Downsample audio for JSON payload if very long.
        max_audio_samples = 100_000
        audio_step = max(1, len(y) // max_audio_samples)

        # --- manual DFT block analysis for debugging / visualization ---
        # Take a fixed block of samples and compute magnitudes using our
        # precomputed DFT matrix.  This avoids np.fft entirely as requested.
        manual_block = 1024
        W_manual, _ = get_dft_matrices(manual_block)

        # ensure the blocks are the right length (pad if short)
        inp_block = y[:manual_block]
        if inp_block.shape[0] < manual_block:
            inp_block = np.pad(inp_block, (0, manual_block - inp_block.shape[0]))
        out_block = y_eq[:manual_block]
        if out_block.shape[0] < manual_block:
            out_block = np.pad(out_block, (0, manual_block - out_block.shape[0]))

        input_spectrum = dft_fast(inp_block, W_manual)
        output_spectrum = dft_fast(out_block, W_manual)

        input_mag = np.abs(input_spectrum[: manual_block // 2])
        output_mag = np.abs(output_spectrum[: manual_block // 2])
        freq_axis = np.linspace(0, float(sr) / 2, manual_block // 2)
        # -------------------------------------------------------------

        response: Dict[str, Any] = {
            "filename": filename,
            "sample_rate": int(sr),
            "audio_step": int(audio_step),
            "preview_sample_rate": float(sr) / float(audio_step),
            "mode": mode,
            "weights": weights,
            "block_size": int(block_size),
            "num_samples": int(len(y)),
            "input_audio": y[::audio_step].tolist(),
            "output_audio": y_eq[::audio_step].tolist(),
            "spectrogram_input": {
                "freqs": in_f,
                "times": in_t,
                "values": in_S,
            },
            "spectrogram_output": {
                "freqs": out_f,
                "times": out_t,
                "values": out_S,
            },
            # include manual DFT results (renamed to fft_*)
            "fft_freqs": freq_axis.tolist(),
            "input_fft": input_mag.tolist(),
            "output_fft": output_mag.tolist(),
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

