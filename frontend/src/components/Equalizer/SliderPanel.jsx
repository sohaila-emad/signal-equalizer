import { useState, useEffect, useRef } from 'react';
import BandControls from './BandControls';

// Format frequency number for display
const fmtFreq = (f) => {
  if (f >= 1000) return `${(f / 1000).toFixed(1)}k`;
  if (f >= 100) return Math.round(f);
  if (f >= 10) return f.toFixed(1);
  return f.toFixed(2);
};

// Get display range for a band (handles multiple ranges)
const getBandRangeDisplay = (band) => {
  if (band.ranges?.length > 1) {
    // Multiple ranges: show count, full details in tooltip
    return {
      display: `${band.ranges.length} ranges`,
      full: band.ranges.map((r) => `${r.min_hz}-${r.max_hz}`).join(', ')
    };
  }
  if (band.ranges?.length === 1) {
    // Single range in ranges array
    const r = band.ranges[0];
    return {
      display: `${fmtFreq(r.min_hz)}-${fmtFreq(r.max_hz)}`,
      full: `${r.min_hz}-${r.max_hz}`
    };
  }
  return {
    display: `${fmtFreq(band.min_hz)}-${fmtFreq(band.max_hz)}`,
    full: `${band.min_hz}-${band.max_hz}`
  };
};

export default function SliderPanel({
  mode,
  bands,
  onBandsChange,
  weights,
  onWeightsChange,
  isAiMode,
  onApply,
  pendingChanges,
  setPendingChanges
}) {
  const [saveStatus, setSaveStatus] = useState('');
  const [editingBandIndex, setEditingBandIndex] = useState(null);
  const fileInputRef = useRef(null);
  const isGeneric = mode === 'generic';

  const flash = (msg) => { setSaveStatus(msg); setTimeout(() => setSaveStatus(''), 2000); };

  const handleAddBand = () => {
    onBandsChange([...bands, { id: `band_${Date.now()}`, label: `Band ${bands.length + 1}`, min_hz: 0, max_hz: 1000, scale: 1 }]);
    if (setPendingChanges) setPendingChanges(true);
  };

  const handleRemoveBand = (index) => {
    onBandsChange(bands.filter((_, i) => i !== index));
    if (setPendingChanges) setPendingChanges(true);
  };

  const handleBandChange = (index, updated) => {
    const next = [...bands]; next[index] = updated; onBandsChange(next);
    if (setPendingChanges) setPendingChanges(true);
  };

  const handleSaveToFile = async () => {
    const config = { bands };
    const jsonString = JSON.stringify(config, null, 2);

    // Try to use File System Access API for native save dialog
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'equalizer_config.json',
          types: [{
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        flash('Saved!');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled
        // Fall through to fallback
      }
    }

    // Fallback for browsers without File System Access API
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equalizer_config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash('Saved!');
  };

  const handleLoadFromFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config = JSON.parse(e.target.result);
        if (config.bands && Array.isArray(config.bands)) {
          onBandsChange(config.bands);
          window.dispatchEvent(new CustomEvent('bandsLoadedFromConfig', { detail: config.bands }));
          flash('Loaded!');
          if (setPendingChanges) setPendingChanges(true);
        } else {
          flash('Invalid config file');
        }
      } catch {
        flash('Failed to parse file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleWeightChange = (bandId, value) => {
    onWeightsChange({ ...weights, [bandId]: value === '' ? 0 : parseFloat(value) });
    if (setPendingChanges) setPendingChanges(true);
  };

  const handleResetSliders = () => {
    if (isGeneric) {
      const resetBands = bands.map(b => ({ ...b, scale: 1 }));
      onBandsChange(resetBands);
    } else {
      const resetWeights = {};
      bands.forEach(b => { resetWeights[b.id] = 1; });
      onWeightsChange(resetWeights);
    }
    if (setPendingChanges) setPendingChanges(true);
  };

  if (isGeneric) {
    return (
      <div className="slider-panel">
        {bands.length === 0 && (
          <div className="no-bands">No bands defined - click Add Band to start</div>
        )}

        {/* Vertical sliders for generic mode */}
        {bands.length > 0 && (
          <div className="sliders-vertical">
            {bands.map((band, index) => {
              const rangeInfo = getBandRangeDisplay(band);
              return (
                <div key={band.id || index} className="slider-col" style={{ minWidth: editingBandIndex === index ? 200 : undefined }}>
                  <div className="slider-col-label">
                    <strong title={band.label}>{band.label}</strong>
                    <span title={`${rangeInfo.full} Hz`}>
                      {rangeInfo.display}{band.ranges?.length > 1 ? '' : ' Hz'}
                    </span>
                  </div>
                  <div className="slider-vertical-track">
                    <input
                      type="range"
                      className="vertical-slider"
                      min="0"
                      max="2"
                      step="0.01"
                      value={band.scale ?? 1}
                      onChange={(e) => handleBandChange(index, { ...band, scale: parseFloat(e.target.value) })}
                    />
                  </div>
                  <span className="slider-col-value">{(band.scale ?? 1).toFixed(2)}x</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditingBandIndex(editingBandIndex === index ? null : index)}
                    style={{ fontSize: 10, padding: '3px 8px', marginTop: 4 }}
                  >
                    {editingBandIndex === index ? 'Close' : 'Edit'}
                  </button>
                  {editingBandIndex === index && (
                    <div style={{ marginTop: 8, width: '100%' }}>
                      <BandControls
                        band={band}
                        onChange={(u) => handleBandChange(index, u)}
                        onRemove={() => { handleRemoveBand(index); setEditingBandIndex(null); }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Actions */}
        <div className="band-actions">
          <button type="button" className="btn btn-primary" onClick={handleAddBand}>+ Add Band</button>

          {bands.length > 0 && (
            <button type="button" className="btn" onClick={handleResetSliders}>Reset</button>
          )}

          <button type="button" className="btn" onClick={handleSaveToFile}>Save As...</button>

          {/* Load from file */}
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleLoadFromFile}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Load File...
          </button>

          {saveStatus && <span className="status-msg">{saveStatus}</span>}
        </div>

        {/* Apply button */}
        {onApply && (
          <div className="apply-btn-row">
            <button
              type="button"
              className={`btn btn-primary apply-btn ${pendingChanges ? '' : 'disabled'}`}
              onClick={onApply}
              disabled={!pendingChanges}
            >
              Apply Changes
            </button>
            {pendingChanges && <span style={{ fontSize: 11, color: 'var(--amber)' }}>Unsaved changes</span>}
          </div>
        )}
      </div>
    );
  }

  // Non-generic mode: vertical sliders
  return (
    <div className="slider-panel">
      {bands.length === 0 && <div className="no-bands">No bands defined for this mode</div>}
      <div className="sliders-vertical">
        {bands.map((band) => {
          const value = weights[band.id] ?? 1;

          const effectiveMin = (isAiMode && band.ai_min !== undefined) ? band.ai_min : band.min_hz;
          const effectiveMax = (isAiMode && band.ai_max !== undefined) ? band.ai_max : band.max_hz;

          let rangeLabel, rangeLabelFull;
          if (band.ranges?.length > 1) {
            rangeLabel = `${band.ranges.length} ranges`;
            rangeLabelFull = band.ranges.map((r) => `${r.min_hz}-${r.max_hz}`).join(', ');
          } else if (band.ranges?.length === 1) {
            const r = band.ranges[0];
            rangeLabel = `${fmtFreq(r.min_hz)}-${fmtFreq(r.max_hz)}`;
            rangeLabelFull = `${r.min_hz}-${r.max_hz}`;
          } else {
            rangeLabel = `${fmtFreq(effectiveMin)}-${fmtFreq(effectiveMax)}`;
            rangeLabelFull = `${effectiveMin}-${effectiveMax}`;
          }

          return (
            <div key={band.id} className="slider-col">
              <div className="slider-col-label">
                <strong
                  style={{ color: isAiMode && band.ai_min !== undefined ? 'var(--accent)' : 'inherit' }}
                  title={band.label}
                >
                  {band.label} {isAiMode && band.ai_min !== undefined ? '(AI)' : ''}
                </strong>
                <span title={`${rangeLabelFull} Hz`}>
                  {rangeLabel}{band.ranges?.length > 1 ? '' : ' Hz'}
                </span>
              </div>
              <div className="slider-vertical-track">
                <input
                  type="range"
                  className="vertical-slider"
                  min="0"
                  max="2"
                  step="0.01"
                  value={value}
                  onChange={(e) => handleWeightChange(band.id, e.target.value)}
                />
              </div>
              <span className="slider-col-value">{value.toFixed(2)}x</span>
            </div>
          );
        })}
      </div>

      {/* Reset and Apply buttons */}
      <div className="apply-btn-row">
        {bands.length > 0 && (
          <button type="button" className="btn" onClick={handleResetSliders} style={{ marginRight: 8 }}>
            Reset
          </button>
        )}
        {onApply && (
          <>
            <button
              type="button"
              className={`btn btn-primary apply-btn ${pendingChanges ? '' : 'disabled'}`}
              onClick={onApply}
              disabled={!pendingChanges}
            >
              Apply Changes
            </button>
            {pendingChanges && <span style={{ fontSize: 11, color: 'var(--amber)', marginLeft: 8 }}>Unsaved changes</span>}
          </>
        )}
      </div>
    </div>
  );
}