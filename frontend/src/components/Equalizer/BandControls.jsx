/**
 * BandControls - Manages one frequency subdivision for generic mode
 *
 * Supports both single-range (min_hz/max_hz) and multi-range (ranges[]) bands.
 * Every field change fires parent callback immediately.
 */
export default function BandControls({ band, onChange, onRemove }) {
  // Normalise: always work with a ranges array internally
  const getRanges = () => {
    if (band.ranges && band.ranges.length > 0) return band.ranges;
    return [{ min_hz: band.min_hz ?? 0, max_hz: band.max_hz ?? 1000 }];
  };

  const handleFieldChange = (field, value) => {
    onChange({ ...band, [field]: value });
  };

  const handleRangeChange = (index, field, value) => {
    const ranges = getRanges();
    const newRanges = ranges.map((r, i) =>
      i === index ? { ...r, [field]: value === '' ? 0 : parseFloat(value) } : r
    );
    const updated = { ...band, ranges: newRanges };
    // Keep top-level min_hz/max_hz in sync when there is only one range
    if (newRanges.length === 1) {
      updated.min_hz = newRanges[0].min_hz;
      updated.max_hz = newRanges[0].max_hz;
    }
    onChange(updated);
  };

  const handleAddRange = () => {
    const ranges = getRanges();
    onChange({ ...band, ranges: [...ranges, { min_hz: 0, max_hz: 1000 }] });
  };

  const handleRemoveRange = (index) => {
    const ranges = getRanges();
    if (ranges.length <= 1) return;
    const newRanges = ranges.filter((_, i) => i !== index);
    const updated = { ...band, ranges: newRanges };
    if (newRanges.length === 1) {
      updated.min_hz = newRanges[0].min_hz;
      updated.max_hz = newRanges[0].max_hz;
    }
    onChange(updated);
  };

  const ranges = getRanges();

  return (
    <div className="band-controls">
      <div className="band-fields">
        <input
          type="text"
          placeholder="Label"
          value={band.label || ''}
          onChange={(e) => handleFieldChange('label', e.target.value)}
        />
        {ranges.map((range, index) => (
          <div key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              placeholder="Min Hz"
              value={range.min_hz ?? 0}
              onChange={(e) => handleRangeChange(index, 'min_hz', e.target.value)}
              style={{ width: 80 }}
            />
            <span>– </span>
            <input
              type="number"
              placeholder="Max Hz"
              value={range.max_hz ?? 0}
              onChange={(e) => handleRangeChange(index, 'max_hz', e.target.value)}
              style={{ width: 80 }}
            />
            <span>Hz</span>
            {ranges.length > 1 && (
              <button
                type="button"
                onClick={() => handleRemoveRange(index)}
                className="remove-range-btn"
                title="Remove this range"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={handleAddRange} className="add-range-btn">
          + Add Range
        </button>
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
