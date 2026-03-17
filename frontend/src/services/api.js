/**
 * API Service
 * 
 * The ONLY file in the codebase that calls fetch.
 * All backend communication goes through these functions.
 */

const API_BASE = 'http://127.0.0.1:5000';

export function encodeWavBlob(samples, sampleRate) {
  const len    = samples.length;
  const buffer = new ArrayBuffer(44 + len * 2);
  const view   = new DataView(buffer);
  const ws     = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  const clip   = (x) => Math.max(-1, Math.min(1, x));
  ws(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); ws(36, 'data');
  view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    view.setInt16(44 + i * 2, clip(samples[i]) * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Upload and transform a WAV file with equalizer and wavelet settings.
 * @param {File} file - The WAV file to process
 * @param {string} mode - The mode (e.g., "generic", "musical", etc.)
 * @param {Object} weights - Band ID to gain mapping (e.g., { "bass": 1.2 })
 * @param {Array} bands - Band configurations (only sent for generic mode)
 * @param {Object} waveletWeights - Wavelet level ID to gain mapping (e.g., { "level_1": 0.5 })
 * @param {string} wavelet - Wavelet name (for generic mode override)
 * @param {number} waveletLevels - Number of DWT levels (for generic mode override)
 * @returns {Promise<Object>} - Processed audio data from backend
 */
export async function uploadAndTransform(
  file,
  mode,
  weights,
  bands = null,
  waveletWeights = {},
  wavelet = null,
  waveletLevels = null,
  useAi = false,
  abortSignal = null
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', mode);
  formData.append('weights', JSON.stringify(weights));
  if (bands && bands.length > 0) {
    formData.append('bands', JSON.stringify(bands));
  }
  formData.append('use_ai', useAi ? '1' : '0');
  formData.append('wavelet_weights', JSON.stringify(waveletWeights || {}));
  if (mode === 'generic' && wavelet) {
    formData.append('wavelet', wavelet);
  }
  if (mode === 'generic' && waveletLevels) {
    formData.append('wavelet_levels', waveletLevels);
  }

  const response = await fetch(`${API_BASE}/transform`, {
    method: 'POST',
    body: formData,
    signal: abortSignal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Separate voices in a WAV file using Multi-Decoder DPRNN.
 *
 * @param {File}   file   - The WAV file to process (reused from sidebar)
 * @param {number} [nSrc] - Force source count 2-5; omit / pass null for auto-detect
 * @param {AbortSignal} [signal] - Optional AbortController signal
 * @returns {Promise<Object>} - { sources: [{ id, audio: Float32Array, sample_rate, peak_db }], n_sources, sample_rate }
 */
export async function separateVoices(file, nSrc = null, signal = undefined) {
  const formData = new FormData();
  formData.append('file', file);
  if (nSrc !== null) formData.append('n_src', String(nSrc));

  const response = await fetch(`${API_BASE}/separate`, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.detail ?? err.error ?? `HTTP ${response.status}`);
  }

  const data = await response.json();

  // Convert raw number arrays → Float32Arrays for the CineViewers
  return {
    ...data,
    sources: data.sources.map((s) => ({
      ...s,
      audio: new Float32Array(s.audio),
    })),
  };
}

/**
 * Separate animal sounds from a WAV file using AudioSep.
 *
 * @param {File}   file    - The WAV file to process
 * @param {string[]} queries - Text descriptions, e.g. ["dog barking", "cat meowing"]
 * @param {AbortSignal} [signal] - Optional AbortController signal
 * @returns {Promise<Object>} - { sources: [{ id, label, audio: Float32Array, sample_rate }], sample_rate }
 */
export async function separateAnimal(file, queries, signal = undefined) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('queries', JSON.stringify(queries));

  const response = await fetch(`${API_BASE}/separate_animal`, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.detail ?? err.error ?? `HTTP ${response.status}`);
  }

  const data = await response.json();

  return {
    ...data,
    sources: data.sources.map((s) => ({
      ...s,
      audio: new Float32Array(s.audio),
    })),
  };
}

/**
 * Load saved generic configuration.
 * @returns {Promise<Object>} - { bands: [...] }
 */
export async function loadConfig() {
  const response = await fetch(`${API_BASE}/config/load`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to load config: ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Save generic configuration.
 * @param {Array} bands - Array of band configurations
 * @returns {Promise<Object>} - Response from backend
 */
export async function saveConfig(bands) {
  const response = await fetch(`${API_BASE}/config/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bands }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save config: ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Analyze an ECG record using ECGNet + Grad-CAM.
 * @param {File} heaFile - The .hea WFDB header file
 * @param {File} datFile - The .dat WFDB data file
 * @returns {Promise<Object>} - { predicted_class, class_index, probabilities, gradcam, leads, sample_rate }
 */
export async function analyzeEcg(heaFile, datFile) {
  const formData = new FormData();
  formData.append('hea_file', heaFile);
  formData.append('dat_file', datFile);

  const response = await fetch(`${API_BASE}/ecg/analyze`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'ECG analysis failed' }));
    throw new Error(err.error || 'ECG analysis failed');
  }
  const data = await response.json();

  // Construct WAV blob from signal_100hz for use with /transform
  try {
    const wavBlob = encodeWavBlob(
      new Float32Array(data.signal_100hz),
      100
    );
    const wavFile = new File([wavBlob], 'ecg_signal.wav', { type: 'audio/wav' });
    return { ...data, wavFile };
  } catch (e) {
    return data;
  }
}

/**
 * Get all available modes from backend.
 * @returns {Promise<Object>} - Modes configuration from modes.json
 */
export async function getModes() {
  const response = await fetch(`${API_BASE}/modes`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get modes: ${response.status}: ${text}`);
  }

  return response.json();
}