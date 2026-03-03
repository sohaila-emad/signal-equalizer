import numpy as np


def dft(signal: np.ndarray) -> np.ndarray:
    """
    Manual Discrete Fourier Transform (DFT) implementation without np.fft.

    X[k] = sum_{n=0}^{N-1} x[n] * exp(-j * 2π * k * n / N)

    Parameters
    ----------
    signal : np.ndarray
        1D real or complex input signal.

    Returns
    -------
    np.ndarray
        Complex DFT of shape (N,).
    """
    x = np.asarray(signal, dtype=np.complex128)
    N = x.shape[0]

    # Vectorized DFT using an outer product for k * n
    n = np.arange(N)
    k = n.reshape((N, 1))
    exponent = -2j * np.pi * k * n / N  # shape (N, N)
    W = np.exp(exponent)
    X = W @ x
    return X


def idft(spectrum: np.ndarray) -> np.ndarray:
    """
    Manual Inverse Discrete Fourier Transform (IDFT) implementation without np.fft.

    x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+j * 2π * k * n / N)

    Parameters
    ----------
    spectrum : np.ndarray
        1D complex spectrum (DFT coefficients).

    Returns
    -------
    np.ndarray
        Complex time‑domain signal of shape (N,).
    """
    X = np.asarray(spectrum, dtype=np.complex128)
    N = X.shape[0]

    n = np.arange(N)
    k = n.reshape((N, 1))
    exponent = 2j * np.pi * k * n / N  # shape (N, N)
    W_inv = np.exp(exponent)
    x = (W_inv @ X) / N
    return x


def magnitude_spectrum(signal: np.ndarray) -> np.ndarray:
    """
    Convenience helper: compute magnitude spectrum |DFT(x)|.
    """
    return np.abs(dft(signal))


def sliding_window_spectrogram(
    signal: np.ndarray,
    sample_rate: float,
    window_size: int,
    hop_size: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute a basic spectrogram using a sliding Hanning window and the manual DFT.

    Parameters
    ----------
    signal : np.ndarray
        1D time‑domain signal.
    sample_rate : float
        Sampling frequency in Hz.
    window_size : int
        Number of samples per window.
    hop_size : int
        Number of samples to advance between windows.

    Returns
    -------
    freqs : np.ndarray
        Frequency axis (Hz) for the rows of the spectrogram.
    times : np.ndarray
        Time centers (seconds) for the columns of the spectrogram.
    S : np.ndarray
        Magnitude spectrogram array of shape (window_size, num_frames).
    """
    x = np.asarray(signal, dtype=np.float64)
    N = x.shape[0]
    if N < window_size:
        raise ValueError("Signal length must be at least 'window_size'.")

    window = np.hanning(window_size)

    frames = []
    times = []
    for start in range(0, N - window_size + 1, hop_size):
        end = start + window_size
        segment = x[start:end] * window
        X = dft(segment)
        frames.append(np.abs(X))
        center_time = (start + window_size / 2) / sample_rate
        times.append(center_time)

    if not frames:
        raise ValueError("No frames generated; check window_size and hop_size.")

    S = np.stack(frames, axis=1)  # shape: (window_size, num_frames)
    freqs = np.linspace(0, sample_rate, window_size, endpoint=False)
    times = np.asarray(times)
    return freqs, times, S


__all__ = ["dft", "idft", "magnitude_spectrum", "sliding_window_spectrogram"]

