// General helpers used across the frontend

/**
 * BPM calculation logic for ECG signals.  The algorithm looks for R-peaks
 * (high-amplitude spikes) and estimates the heart rate based on the average
 * interval between consecutive peaks.  It is rudimentary but works well for
 * demonstration purposes.
 *
 * @param {Float32Array|number[]} signal - sampled ECG waveform values
 * @param {number} sampleRate - number of samples per second in the signal
 * @returns {number|null} rounded beats‑per‑minute or null if not enough data
 */
export function calculateBPM(signal, sampleRate) {
  // 1. Initial Safety Check (Is there even data?)
  if (!signal || signal.length === 0) return { bpm: null, type: "No Signal" };

  // 2. Center the signal to remove DC offset
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const centered = Array.from(signal, (v) => v - mean);

  // 3. Define maxVal FIRST, then do the safety check
  const maxVal = Math.max(...centered);
  
  // Safety check: if signal is flat (all zeros), stop here to prevent crash
  if (maxVal === 0 || !isFinite(maxVal)) {
    return { bpm: null, type: "Flatline/No Signal" };
  }

  // 4. Dynamic Thresholding
  const threshold = maxVal * 0.7; 
  const peaks = [];
  const minDistance = sampleRate * 0.25; // 0.25s refractory period

  for (let i = 1; i < centered.length - 1; i++) {
    if (
      centered[i] > threshold &&
      centered[i] > centered[i - 1] &&
      centered[i] > centered[i + 1]
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] > minDistance) {
        peaks.push(i);
      }
    }
  }

  if (peaks.length < 2) return { bpm: null, type: "Unknown/Searching..." };

  // 5. Calculate Intervals & Detect Abnormalities
  const intervals = [];
  let isIrregular = false;
  
  for (let i = 1; i < peaks.length; i++) {
    const currentInterval = peaks[i] - peaks[i - 1];
    intervals.push(currentInterval);
    
    if (i > 1) {
      const prevInterval = intervals[i - 2];
      // Check for 20% variance (signs of PVC)
      if (Math.abs(currentInterval - prevInterval) > (prevInterval * 0.2)) {
        isIrregular = true;
      }
    }
  }

  const avgIntervalInSamples = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpmValue = Math.round((60 * sampleRate) / avgIntervalInSamples);

  // 6. Final Diagnosis
  let type = "Normal";
  if (isIrregular) type = "Arrhythmia/PVC Detected";
  else if (bpmValue > 100) type = "Tachycardia";
  else if (bpmValue < 60) type = "Bradycardia";

  return { bpm: bpmValue, type: type };
}