export default function BandControls({ band, onChange, onRemove }) {
  const getRanges = () => {
    if (band.ranges?.length > 0) return band.ranges;
    return [{ min_hz: band.min_hz ?? 0, max_hz: band.max_hz ?? 1000 }];
  };

  const handleFieldChange = (field, value) => onChange({ ...band, [field]: value });

  const handleRangeChange = (index, field, value) => {
    const ranges = getRanges();
    const newRanges = ranges.map((r, i) =>
      i === index ? { ...r, [field]: value === '' ? 0 : parseFloat(value) } : r
    );
    const updated = { ...band, ranges: newRanges };
    if (newRanges.length === 1) { updated.min_hz = newRanges[0].min_hz; updated.max_hz = newRanges[0].max_hz; }
    onChange(updated);
  };

  const handleAddRange = () =>
    onChange({ ...band, ranges: [...getRanges(), { min_hz: 0, max_hz: 1000 }] });

  const handleRemoveRange = (index) => {
    const ranges = getRanges();
    if (ranges.length <= 1) return;
    const newRanges = ranges.filter((_, i) => i !== index);
    const updated = { ...band, ranges: newRanges };
    if (newRanges.length === 1) { updated.min_hz = newRanges[0].min_hz; updated.max_hz = newRanges[0].max_hz; }
    onChange(updated);
  };

  const ranges = getRanges();
  const scale  = band.scale ?? 1;

  return (
    <div className="band-controls">
      <div className="band-controls-top">
        <input
          type="text"
          className="band-label-input"
          placeholder="Band label…"
          value={band.label || ''}
          onChange={(e) => handleFieldChange('label', e.target.value)}
        />
        <button type="button" className="btn btn-danger" onClick={onRemove}>Remove</button>
      </div>

      <div className="band-ranges">
        {ranges.map((range, index) => (
          <div key={index} className="range-row">
            <input
              type="number" className="range-input" placeholder="Min"
              value={range.min_hz ?? 0}
              onChange={(e) => handleRangeChange(index, 'min_hz', e.target.value)}
            />
            <span className="range-sep">–</span>
            <input
              type="number" className="range-input" placeholder="Max"
              value={range.max_hz ?? 0}
              onChange={(e) => handleRangeChange(index, 'max_hz', e.target.value)}
            />
            <span className="range-unit">Hz</span>
            {ranges.length > 1 && (
              <button
                type="button" className="btn btn-danger"
                style={{ padding: '3px 7px', fontSize: 10 }}
                onClick={() => handleRemoveRange(index)}
              >✕</button>
            )}
          </div>
        ))}
        <button
          type="button" className="btn"
          style={{ fontSize: 11, padding: '4px 10px', marginTop: 4 }}
          onClick={handleAddRange}
        >+ Range</button>
      </div>

      <div className="band-scale-row">
        <span className="band-scale-label">Scale</span>
        <input
          type="range" min="0" max="2" step="0.01" value={scale}
          onChange={(e) => handleFieldChange('scale', parseFloat(e.target.value))}
        />
        <span className="slider-value">{scale.toFixed(2)}×</span>
      </div>
    </div>
  );
}