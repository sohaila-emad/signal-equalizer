import numpy as np


def get_dft_matrices(N: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Create forward and inverse DFT matrices once for a given size N.
    This avoids recomputing the exponential grid for every block.
    """
    n = np.arange(N)
    k = n.reshape((N, 1))
    W = np.exp(-2j * np.pi * k * n / N)
    W_inv = np.conj(W) / N
    return W, W_inv


def dft_fast(signal: np.ndarray, W: np.ndarray) -> np.ndarray:
    x = np.asarray(signal, dtype=np.complex128)
    return W @ x


def idft_fast(spectrum: np.ndarray, W_inv: np.ndarray) -> np.ndarray:
    X = np.asarray(spectrum, dtype=np.complex128)
    return W_inv @ X


def dft(signal: np.ndarray) -> np.ndarray:
    """
    Manual Discrete Fourier Transform (DFT) implementation without np.fft.

    X[k] = sum_{n=0}^{N-1} x[n] * exp(-j * 2π * k * n / N)
    """
    x = np.asarray(signal, dtype=np.complex128)
    N = x.shape[0]

    n = np.arange(N)
    k = n.reshape((N, 1))
    exponent = -2j * np.pi * k * n / N  # shape (N, N)
    W = np.exp(exponent)
    return W @ x


def idft(spectrum: np.ndarray) -> np.ndarray:
    """
    Manual Inverse Discrete Fourier Transform (IDFT) implementation without np.fft.

    x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+j * 2π * k * n / N)
    """
    X = np.asarray(spectrum, dtype=np.complex128)
    N = X.shape[0]

    n = np.arange(N)
    k = n.reshape((N, 1))
    exponent = 2j * np.pi * k * n / N  # shape (N, N)
    W_inv = np.exp(exponent)
    return (W_inv @ X) / N


def magnitude_spectrum(signal: np.ndarray) -> np.ndarray:
    return np.abs(dft(signal))


def sliding_window_spectrogram(
    signal: np.ndarray,
    sample_rate: float,
    window_size: int,
    hop_size: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute a basic spectrogram using a sliding Hanning window and the manual DFT.
    """
    x = np.asarray(signal, dtype=np.float64)
    N = x.shape[0]
    if N < window_size:
        raise ValueError("Signal length must be at least 'window_size'.")

    window = np.hanning(window_size)

    # Precompute DFT matrix once for this window size for speed.
    W_spectro, _ = get_dft_matrices(window_size)

    frames = []
    times = []
    for start in range(0, N - window_size + 1, hop_size):
        end = start + window_size
        segment = x[start:end] * window
        X = dft_fast(segment, W_spectro)
        frames.append(np.abs(X))
        times.append((start + window_size / 2) / sample_rate)

    if not frames:
        raise ValueError("No frames generated; check window_size and hop_size.")

    S = np.stack(frames, axis=1)  # shape: (window_size, num_frames)
    freqs = np.linspace(0, sample_rate, window_size, endpoint=False)
    return freqs, np.asarray(times), S


__all__ = [
    "get_dft_matrices",
    "dft_fast",
    "idft_fast",
    "dft",
    "idft",
    "magnitude_spectrum",
    "sliding_window_spectrogram",
]
