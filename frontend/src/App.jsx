import { useMemo, useState } from 'react'
import './App.css'
import { modesConfig } from './modesConfig'

const API_BASE = 'http://127.0.0.1:5000'

function App() {
  const [mode, setMode] = useState('musical')
  const [file, setFile] = useState(null)
  const [weights, setWeights] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const currentBands = useMemo(() => {
    return modesConfig[mode]?.bands ?? []
  }, [mode])

  const handleSliderChange = (bandId, value) => {
    const gain = Number(value)
    setWeights((prev) => ({
      ...prev,
      [bandId]: gain
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (!file) {
      setError('Please choose a WAV file first.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)
    formData.append('weights', JSON.stringify(weights))

    try {
      setLoading(true)
      const resp = await fetch(`${API_BASE}/transform`, {
        method: 'POST',
        body: formData
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Backend error ${resp.status}: ${text}`)
      }
      const json = await resp.json()
      setResult(json)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <h1>Audio Equalizer Lab (Frontend)</h1>

      <form className="panel" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="file">Audio file (.wav):</label>
          <input
            id="file"
            type="file"
            accept=".wav,audio/wav"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="field">
          <label htmlFor="mode">Mode:</label>
          <select
            id="mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value)
              setWeights({})
            }}
          >
            {Object.entries(modesConfig).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label ?? key}
              </option>
            ))}
          </select>
        </div>

        <div className="sliders">
          {currentBands.map((band) => {
            const value = weights[band.id] ?? 1
            return (
              <div key={band.id} className="slider-row">
                <div className="slider-label">
                  <strong>{band.label}</strong>
                  <span>
                    {band.min_hz}–{band.max_hz} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={value}
                  onChange={(e) => handleSliderChange(band.id, e.target.value)}
                />
                <span className="slider-value">{value.toFixed(1)}x</span>
              </div>
            )
          })}
          {currentBands.length === 0 && (
            <p>No bands defined for this mode.</p>
          )}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Processing…' : 'Send to backend'}
        </button>
      </form>

      {error && <div className="error">Error: {error}</div>}

      {result && (
        <div className="panel">
          <h2>Backend response</h2>
          <p>
            <strong>File:</strong> {result.filename} |{' '}
            <strong>Sample rate:</strong> {result.sample_rate} Hz |{' '}
            <strong>Samples used:</strong> {result.used_samples}
          </p>
          <p>
            <strong>Mode:</strong> {result.mode} |{' '}
            <strong>Bands:</strong>{' '}
            {Object.entries(result.weights || {})
              .map(([k, v]) => `${k}=${v}`)
              .join(', ') || 'default (1.0x)'}
          </p>
          <p>
            <strong>Spectrogram shape:</strong>{' '}
            {result.spectrogram.freq_bins} freq bins ×{' '}
            {result.spectrogram.time_frames} time frames
          </p>

          <pre className="json-view">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export default App
