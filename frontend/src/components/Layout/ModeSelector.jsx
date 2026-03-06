import { useEffect, useState } from 'react';
import { getModes } from '../../services/api';

export default function ModeSelector({ value, onChange }) {
  const [modes, setModes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchModes = async () => {
      try {
        const modesData = await getModes();
        setModes(modesData);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load modes:', err);
        setError(err.message);
        setLoading(false);
      }
    };
    fetchModes();
  }, []);

  if (loading) {
    return <div>Loading modes...</div>;
  }

  if (error) {
    return <div>Error loading modes: {error}</div>;
  }

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
