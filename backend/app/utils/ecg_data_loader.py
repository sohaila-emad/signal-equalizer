import os
import librosa
import numpy as np
from tensorflow.keras.utils import to_categorical

def load_ecg_dataset(data_path, target_sr=500, duration=5):
    X = []
    y = []
    # Mapping our folder names to numbers
    classes = {"normal": 0, "pvc": 1, "tachycardia": 2, "bradycardia": 3}
    
    expected_length = target_sr * duration # 2500 samples

    for label, class_idx in classes.items():
        folder_path = os.path.join(data_path, label)
        if not os.path.exists(folder_path): continue
        
        for file in os.listdir(folder_path):
            if file.endswith(".wav"):
                # Load and force the sample rate to match our AI's training
                file_path = os.path.join(folder_path, file)
                signal, _ = librosa.load(file_path, sr=target_sr)
                
                # Ensure the signal is exactly the right length (padding/clipping)
                if len(signal) > expected_length:
                    signal = signal[:expected_length]
                else:
                    signal = np.pad(signal, (0, expected_length - len(signal)))
                
                # Standardize the signal (Z-score normalization)
                signal = (signal - np.mean(signal)) / (np.std(signal) + 1e-8)
                
                X.append(signal)
                y.append(class_idx)
    
    # Convert to NumPy and reshape for 1D-CNN (samples, length, channels)
    X = np.array(X).reshape(-1, expected_length, 1)
    # Convert labels to "One-Hot" (e.g., 2 becomes [0, 0, 1, 0])
    y = to_categorical(np.array(y), num_classes=len(classes))
    
    return X, y, list(classes.keys())

# Usage: 
# X_train, y_train, labels = load_ecg_dataset("backend/data/training")