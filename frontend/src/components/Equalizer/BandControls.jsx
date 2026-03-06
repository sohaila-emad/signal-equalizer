/**
 * BandControls - Manages one frequency subdivision for generic mode
 * 
 * Fields: min_hz, max_hz, label, scale
 * Every field change fires parent callback immediately
 */
export default function BandControls({ band, onChange, onRemove }) {
  const handleFieldChange = (field, value) => {
    onChange({
      ...band,
      [field]: value,
    });
  };

  return (
    <div className="band-controls">
      <div className="band-fields">
        <input
          type="text"
          placeholder="Label"
          value={band.label || ''}
          onChange={(e) => handleFieldChange('label', e.target.value)}
        />
        <div style={{ display: 'inline-flex', alignItems: 'center' }}>
          <input
            type="number"
            placeholder="Min Hz"
            value={band.min_hz ?? 0}
            onChange={(e) => handleFieldChange('min_hz', e.target.value === '' ? 0 : parseFloat(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ marginLeft: 4 }}>Hz</span>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center' }}>
          <input
            type="number"
            placeholder="Max Hz"
            value={band.max_hz ?? 0}
            onChange={(e) => handleFieldChange('max_hz', e.target.value === '' ? 0 : parseFloat(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ marginLeft: 4 }}>Hz</span>
        </div>
        <div className="scale-control">
          <label>
            Scale: {band.scale === null || band.scale === undefined ? '1.00' : band.scale.toFixed(2)}x
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={band.scale === null || band.scale === undefined ? 1 : band.scale}
            onChange={(e) => handleFieldChange('scale', parseFloat(e.target.value))}
          />
        </div>
        <button type="button" onClick={onRemove} className="remove-btn">
          Remove
        </button>
      </div>
    </div>
  );
}
