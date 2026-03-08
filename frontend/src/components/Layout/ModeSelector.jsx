export default function ModeSelector({ value, onChange, modes = {} }) {
  return (
    <div className="field">
      <label htmlFor="mode">Mode:</label>
      <select id="mode" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="generic">Generic (Custom Bands)</option>
        {Object.entries(modes).map(([key, cfg]) => (
          <option key={key} value={key}>
            {cfg.label || key}
          </option>
        ))}
      </select>
    </div>
  );
}
