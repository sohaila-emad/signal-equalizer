import numpy as np
from scipy.io import wavfile

def generate_ecg_signal(filename, bpm=72, duration=10, fs=44100, type="normal"):
    t = np.linspace(0, duration, int(fs * duration))
    signal = np.zeros_like(t)
    
    # Calculate intervals based on higher sample rate
    heart_period_samples = int(fs * (60 / bpm))
    
    for i in range(int(duration * bpm / 60)):
        pos = i * heart_period_samples
        
        if type == "pvc" and i % 4 == 0 and i > 0:
            pos -= int(0.2 * fs)
            # PVCs are wide, so we scale the width with fs
            width = int(0.05 * fs) 
            amp = 1.2
        else:
            width = int(0.02 * fs) # Standard R-peak width
            amp = 1.0

        if pos + width < len(signal):
            # Create R-peak using a Gaussian pulse
            x = np.arange(width * 2) - width
            spike = amp * np.exp(-0.5 * (x / (width / 5))**2)
            
            # Ensure we don't exceed array bounds
            end_pos = min(pos + len(spike), len(signal))
            signal[pos:end_pos] += spike[:end_pos-pos]

    # Adding 60Hz Noise (Higher fs makes this a very clean sine wave for filtering)
    noise = 0.2 * np.sin(2 * np.pi * 60 * t)
    final_signal = signal + noise
    
    # Normalize to 16-bit PCM
    final_signal = (final_signal / np.max(np.abs(final_signal)) * 32767).astype(np.int16)
    wavfile.write(filename, fs, final_signal)
    print(f"Generated: {filename} at {fs}Hz")
# Generate the 4 test cases
generate_ecg_signal("ecg_normal.wav", bpm=70, type="normal")
generate_ecg_signal("ecg_tachycardia.wav", bpm=120, type="normal")
generate_ecg_signal("ecg_bradycardia.wav", bpm=45, type="normal")
generate_ecg_signal("ecg_pvc.wav", bpm=70, type="pvc")