"""
Synthetic Test Signal Generator

Generates a WAV file as a sum of pure sine waves at specific frequencies
with equal amplitudes. Used to validate equalizer correctness - when you
zero out a band containing one of these frequencies, that frequency should
disappear from the output FFT.

Frequencies: 100Hz, 500Hz, 1kHz, 3kHz, 8kHz, 15kHz
"""

import numpy as np
import soundfile as sf
from pathlib import Path


def generate_synthetic_signal(
    output_path: str,
    duration: float = 3.0,
    sample_rate: int = 44100,
    frequencies: list = None,
    amplitude: float = 0.1,
):
    """
    Generate a synthetic test signal as a sum of sine waves.

    Parameters
    ----------
    output_path : str
        Path to save the WAV file.
    duration : float
        Duration in seconds.
    sample_rate : int
        Sample rate in Hz.
    frequencies : list
        List of frequencies to include. Default: [100, 500, 1000, 3000, 8000, 15000]
    amplitude : float
        Amplitude of each sine wave (they are summed, so keep this low).
    """
    if frequencies is None:
        frequencies = [100, 500, 1000, 3000, 8000, 15000]

    # Generate time array
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)

    # Sum of sine waves
    signal = np.zeros_like(t)
    for freq in frequencies:
        signal += amplitude * np.sin(2 * np.pi * freq * t)

    # Normalize to prevent clipping
    signal = signal / np.max(np.abs(signal)) * 0.9

    # Save to file
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, signal, sample_rate)
    
    print(f"Generated synthetic signal: {output_path}")
    print(f"Duration: {duration}s, Sample rate: {sample_rate}Hz")
    print(f"Frequencies: {frequencies}")


if __name__ == "__main__":
    # Generate the test signal
    script_dir = Path(__file__).parent
    output_file = script_dir / "synthetic_test.wav"
    
    generate_synthetic_signal(
        output_path=str(output_file),
        duration=3.0,
        sample_rate=44100,
        frequencies=[100, 500, 1000, 3000, 8000, 15000],
        amplitude=0.1,
    )
