import { useState } from 'react';
import BandControls from './BandControls';
import { loadConfig, saveConfig } from '../../services/api';

// Added isAiMode to the destructured props
export default function SliderPanel({ mode, bands, onBandsChange, weights, onWeightsChange, isAiMode }) {
  const [saveStatus, setSaveStatus] = useState('');
  const isGeneric = mode === 'generic';

  const flash = (msg) => { setSaveStatus(msg); setTimeout(() => setSaveStatus(''), 2000); };

  const handleAddBand = () =>
    onBandsChange([...bands, { id: `band_${Date.now()}`, label: `Band ${bands.length + 1}`, min_hz: 0, max_hz: 1000, scale: 1 }]);

  const handleRemoveBand = (index) => onBandsChange(bands.filter((_, i) => i !== index));

  const handleBandChange = (index, updated) => {
    const next = [...bands]; next[index] = updated; onBandsChange(next);
  };

  const handleSave = async () => {
    try { flash('Saving…'); await saveConfig(bands); flash('Saved ✓'); }
    catch { flash('Save failed'); }
  };

  const handleLoad = async () => {
    try {
      flash('Loading…');
      const config = await loadConfig();
      if (config.bands && Array.isArray(config.bands)) {
        onBandsChange(config.bands);
        window.dispatchEvent(new CustomEvent('bandsLoadedFromConfig', { detail: config.bands }));
        flash('Loaded ✓');
      } else flash('No saved config');
    } catch { flash('Load failed'); }
  };

  const handleWeightChange = (bandId, value) =>
    onWeightsChange({ ...weights, [bandId]: value === '' ? 0 : parseFloat(value) });

  if (isGeneric) {
    return (
      <div className="slider-panel">
        {bands.length === 0 && (
          <div className="no-bands">No bands defined — click Add Band to start</div>
        )}
        {bands.map((band, index) => (
          <BandControls
            key={band.id || index}
            band={band}
            onChange={(u) => handleBandChange(index, u)}
            onRemove={() => handleRemoveBand(index)}
          />
        ))}
        <div className="band-actions">
          <button type="button" className="btn btn-primary" onClick={handleAddBand}>+ Add Band</button>
          <button type="button" className="btn" onClick={handleSave}>Save</button>
          <button type="button" className="btn" onClick={handleLoad}>Load</button>
          {saveStatus && <span className="status-msg">{saveStatus}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="slider-panel">
      {bands.length === 0 && <div className="no-bands">No bands defined for this mode</div>}
      <div className="sliders">
        {bands.map((band) => {
          const value = weights[band.id] ?? 1;

          // DYNAMIC RANGE LOGIC:
          // If AI mode is on and the band has ai_min/max, use those. Otherwise fallback to standard min/max.
          const effectiveMin = (isAiMode && band.ai_min !== undefined) ? band.ai_min : band.min_hz;
          const effectiveMax = (isAiMode && band.ai_max !== undefined) ? band.ai_max : band.max_hz;

          const rangeLabel = band.ranges?.length > 0
            ? band.ranges.map((r) => `${r.min_hz}–${r.max_hz} Hz`).join(', ')
            : `${effectiveMin}–${effectiveMax} Hz`;

          return (
            <div key={band.id} className="slider-row">
              <div className="slider-label">
                <strong style={{ color: isAiMode && band.ai_min !== undefined ? 'var(--accent)' : 'inherit' }}>
                  {band.label} {isAiMode && band.ai_min !== undefined ? '(AI)' : ''}
                </strong>
                <span>{rangeLabel}</span>
              </div>
              <input
                type="range" min="0" max="2" step="0.01" value={value}
                onChange={(e) => handleWeightChange(band.id, e.target.value)}
              />
              <span className="slider-value">{value.toFixed(2)}×</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}