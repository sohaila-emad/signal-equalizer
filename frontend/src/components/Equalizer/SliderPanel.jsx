import { useState } from 'react';
import BandControls from './BandControls';
import { loadConfig, saveConfig } from '../../services/api';

/**
 * SliderPanel - Handles both generic mode and customized modes
 * 
 * Generic mode: renders BandControls + Add/Save/Load buttons
 * Customized modes: renders simple labeled sliders
 */
export default function SliderPanel({ mode, bands, onBandsChange, weights, onWeightsChange }) {
  const [saveStatus, setSaveStatus] = useState('');

  const isGeneric = mode === 'generic';

  const handleAddBand = () => {
    const newBand = {
      id: `band_${Date.now()}`,
      label: 'New Band',
      min_hz: 0,
      max_hz: 1000,
      scale: 1,
    };
    onBandsChange([...bands, newBand]);
  };

  const handleRemoveBand = (index) => {
    const newBands = bands.filter((_, i) => i !== index);
    onBandsChange(newBands);
  };

  const handleBandChange = (index, updatedBand) => {
    const newBands = [...bands];
    newBands[index] = updatedBand;
    onBandsChange(newBands);
  };

  const handleSaveConfig = async () => {
    try {
      setSaveStatus('Saving...');
      await saveConfig(bands);
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
      setSaveStatus('Save failed');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleLoadConfig = async () => {
    try {
      setSaveStatus('Loading...');
      const config = await loadConfig();
      if (config.bands && Array.isArray(config.bands)) {
        onBandsChange(config.bands);
        setSaveStatus('Loaded!');
        // Immediately trigger uploadAndTransform with loaded bands
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('bandsLoadedFromConfig', { detail: config.bands }));
        }
      } else {
        setSaveStatus('No saved config');
      }
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('Failed to load config:', err);
      setSaveStatus('Load failed');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleWeightChange = (bandId, value) => {
    onWeightsChange({
      ...weights,
      [bandId]: value === '' ? 0 : parseFloat(value),
    });
  }

  if (isGeneric) {
    // Generic mode: full band controls
    return (
      <div className="slider-panel">
        <h3>Custom Bands</h3>
        {bands.length === 0 && <p>No bands defined. Click "Add Band" to create one.</p>}
        {bands.map((band, index) => (
          <BandControls
            key={band.id || index}
            band={band}
            onChange={(updated) => handleBandChange(index, updated)}
            onRemove={() => handleRemoveBand(index)}
          />
        ))}
        <div className="band-actions">
          <button type="button" onClick={handleAddBand}>
            Add Band
          </button>
          <button type="button" onClick={handleSaveConfig}>
            Save Config
          </button>
          <button type="button" onClick={handleLoadConfig}>
            Load Config
          </button>
          {saveStatus && <span className="status-msg">{saveStatus}</span>}
        </div>
      </div>
    );
  } else {
    // Customized modes: simple sliders
    return (
      <div className="slider-panel">
        <h3>Equalizer Bands</h3>
        {bands.length === 0 && <p>No bands defined for this mode.</p>}
        {bands.map((band) => {
          const value = weights[band.id] === null || weights[band.id] === undefined ? 1 : weights[band.id];
          const rangeLabel = band.ranges && band.ranges.length > 0
            ? band.ranges.map((r) => `${r.min_hz}–${r.max_hz} Hz`).join(', ')
            : `${band.min_hz}–${band.max_hz} Hz`;
          return (
            <div key={band.id} className="slider-row">
              <div className="slider-label">
                <strong>{band.label}</strong>
                <span>{rangeLabel}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={value}
                onChange={(e) => handleWeightChange(band.id, e.target.value)}
              />
              <span className="slider-value">{value.toFixed(2)}x</span>
            </div>
          );
        })}
      </div>
    );
  }
}
