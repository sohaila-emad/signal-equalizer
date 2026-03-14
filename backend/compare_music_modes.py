"""
compare_music_modes.py
-----------------------
Compares your frequency-domain equalizer vs HTDemucs+band-mapping
using the same band sliders (sub, bass, low_mid, high_mid, presence, brilliance).

Run from backend/:
    python compare_music_modes.py --input path/to/song.wav

Tests three scenarios:
  1. Mute bass    : bass=0.0, sub=0.0, everything else=1.0
  2. Boost vocals : high_mid=1.8, presence=1.6, everything else=1.0
  3. Drums only   : low_mid=0.1, high_mid=0.0, presence=0.0, brilliance=1.5

Saves WAV files for each so you can listen to the difference.
"""

import argparse
import numpy as np
import librosa
import soundfile as sf
from pathlib import Path

BAND_RANGES = {
    "sub":        (20,    60),
    "bass":       (60,    250),
    "low_mid":    (250,   1000),
    "high_mid":   (1000,  4000),
    "presence":   (4000,  6000),
    "brilliance": (6000,  20000),
}

TEST_SCENARIOS = {
    "mute_bass":    {"sub": 0.0, "bass": 0.0, "low_mid": 1.0,
                     "high_mid": 1.0, "presence": 1.0, "brilliance": 1.0},
    "boost_vocals": {"sub": 1.0, "bass": 1.0, "low_mid": 1.0,
                     "high_mid": 1.8, "presence": 1.6, "brilliance": 1.0},
    "drums_only":   {"sub": 0.2, "bass": 0.3, "low_mid": 0.1,
                     "high_mid": 0.0, "presence": 0.0, "brilliance": 1.5},
}


def apply_eq(signal: np.ndarray, sr: int, weights: dict) -> np.ndarray:
    fft   = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), d=1.0 / sr)
    for band_id, (lo, hi) in BAND_RANGES.items():
        w    = float(weights.get(band_id, 1.0))
        mask = (freqs >= lo) & (freqs < hi)
        fft[mask] *= w
    return np.fft.irfft(fft, n=len(signal)).astype(np.float32)


def sdr(ref: np.ndarray, est: np.ndarray) -> float:
    min_len = min(len(ref), len(est))
    ref, est = ref[:min_len], est[:min_len]
    dot     = np.dot(ref, est)
    rn      = np.dot(ref, ref)
    if rn < 1e-8: return float('-inf')
    target  = (dot / rn) * ref
    noise   = est - target
    return 10 * np.log10(np.dot(target, target) / (np.dot(noise, noise) + 1e-8))


def run(input_path: str):
    print(f"\n{'='*64}")
    print("  Equalizer (FFT bands) vs HTDemucs+Band-Mapping")
    print(f"{'='*64}")

    mixture, sr = librosa.load(input_path, sr=None, mono=True)
    print(f"\n  File: {input_path}")
    print(f"  Duration: {len(mixture)/sr:.1f}s  SR: {sr}Hz\n")

    out_dir = Path("comparison_output")
    out_dir.mkdir(exist_ok=True)

    # Load AI model once
    try:
        from music_model import process_from_array, compute_stem_gain
        ai_available = True
        print("  HTDemucs loaded ✓\n")
    except Exception as e:
        ai_available = False
        print(f"  HTDemucs not available ({e})\n  Only EQ results will be shown.\n")

    for scenario_name, weights in TEST_SCENARIOS.items():
        print(f"{'─'*64}")
        print(f"  Scenario: {scenario_name}")
        print(f"  Weights : { {k:v for k,v in weights.items() if v != 1.0} }")
        print(f"{'─'*64}")

        # EQ output
        eq_out = apply_eq(mixture, sr, weights)
        eq_path = out_dir / f"eq_{scenario_name}.wav"
        sf.write(str(eq_path), eq_out, sr)

        eq_sdr = sdr(mixture, eq_out)
        print(f"  Equalizer  SDR vs original: {eq_sdr:+.2f} dB  → {eq_path.name}")

        # AI output
        if ai_available:
            try:
                ai_out  = process_from_array(mixture, sr, weights)
                ai_path = out_dir / f"ai_{scenario_name}.wav"
                sf.write(str(ai_path), ai_out, sr)
                ai_sdr  = sdr(mixture, ai_out)
                print(f"  HTDemucs   SDR vs original: {ai_sdr:+.2f} dB  → {ai_path.name}")

                # Show what gain each stem received
                print(f"\n  Stem gains computed from band weights:")
                for stem in ["bass", "drums", "vocals", "guitar", "piano", "other"]:
                    g = compute_stem_gain(stem, weights)
                    bar = "█" * int(g * 10)
                    print(f"    {stem:<12} {g:.2f}  {bar}")

            except Exception as e:
                print(f"  HTDemucs failed: {e}")

        print()

    print(f"{'='*64}")
    print(f"  Output files saved to: {out_dir}/")
    print(f"  Listen to eq_mute_bass.wav vs ai_mute_bass.wav —")
    print(f"  the EQ version will still have kick drum in the bass range,")
    print(f"  the AI version removes the whole bass stem cleanly.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    run(args.input)