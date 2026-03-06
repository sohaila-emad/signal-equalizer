/**
 * API Service
 * 
 * The ONLY file in the codebase that calls fetch.
 * All backend communication goes through these functions.
 */

const API_BASE = 'http://127.0.0.1:5000';

/**
 * Upload and transform a WAV file with equalizer settings.
 * 
 * @param {File} file - The WAV file to process
 * @param {string} mode - The mode (e.g., "generic", "musical", etc.)
 * @param {Object} weights - Band ID to gain mapping (e.g., { "bass": 1.2 })
 * @param {Array} bands - Band configurations (only sent for generic mode)
 * @returns {Promise<Object>} - Processed audio data from backend
 */
export async function uploadAndTransform(file, mode, weights, bands = null) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', mode);
  formData.append('weights', JSON.stringify(weights));
  
  // Only send bands for generic mode
  if (mode === 'generic' && bands) {
    formData.append('bands', JSON.stringify(bands));
  }

  const response = await fetch(`${API_BASE}/transform`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Load saved generic configuration.
 * 
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
 * 
 * @param {Array} bands - Array of band configurations
 * @returns {Promise<Object>} - Response from backend
 */
export async function saveConfig(bands) {
  const response = await fetch(`${API_BASE}/config/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bands }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save config: ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Get all available modes from backend.
 * 
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
