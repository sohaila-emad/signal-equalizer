import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { modesConfig } from './modesConfig'

const API_BASE = 'http://127.0.0.1:5000'

function WaveformCanvas({
  samples,
  offset = 0,
  windowSize = 6000,
  height = 120,
  width = 600
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !samples || samples.length === 0) return
    const ctx = canvas.getContext('2d')
    canvas.width = width
    canvas.height = height

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, width, height)

    const start = Math.max(0, Math.min(offset, Math.max(0, samples.length - 1)))
    const end = Math.min(samples.length, start + windowSize)
    const view = samples.slice(start, end)

    const midY = height / 2
    const step = Math.max(1, Math.floor(view.length / width))
    const amp = midY * 0.9

    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x < width; x++) {
      const i = x * step
      const v = view[i] ?? 0
      const y = midY - v * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [samples, offset, windowSize, height, width])

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      width={width}
      height={height}
    />
  )
}

function SpectrogramCanvas({ freqs, times, values, height = 200, width = 600 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !freqs || !times || !values || values.length === 0) return

    const rows = values.length
    const cols = values[0].length
    if (rows === 0 || cols === 0) return

    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    const imgData = ctx.createImageData(cols, rows)

    // Find min/max for normalization
    let min = Infinity
    let max = -Infinity
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = values[r][c]
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    const range = max - min || 1

    // Simple colormap: blue -> green -> yellow
    const colorFor = (v) => {
      const t = (v - min) / range
      const r = 255 * t
      const g = 255 * Math.min(1, t * 1.5)
      const b = 255 * (1 - t)
      return [r, g, b]
    }

    for (let r = 0; r < rows; r++) {
      const srcRow = rows - 1 - r // flip vertically: low freqs at bottom
      for (let c = 0; c < cols; c++) {
        const [R, G, B] = colorFor(values[srcRow][c])
        const idx = (r * cols + c) * 4
        imgData.data[idx] = R
        imgData.data[idx + 1] = G
        imgData.data[idx + 2] = B
        imgData.data[idx + 3] = 255
      }
    }

    // Draw pixel data then scale to canvas size
    const offscreen = document.createElement('canvas')
    offscreen.width = cols
    offscreen.height = rows
    const offCtx = offscreen.getContext('2d')
    offCtx.putImageData(imgData, 0, 0)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(offscreen, 0, 0, width, height)
  }, [freqs, times, values, height, width])

  return (
    <canvas
      ref={canvasRef}
      className="spectrogram-canvas"
      width={width}
      height={height}
    />
  )
}

function App() {
  const [mode, setMode] = useState('musical')
  const [file, setFile] = useState(null)
  const [weights, setWeights] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const audioCtxRef = useRef(null)
  const [playbackPos, setPlaybackPos] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playingWhich, setPlayingWhich] = useState(null) // 'input' | 'output' | null
  const playbackRef = useRef(null) // AudioBufferSourceNode
  const startTimeRef = useRef(0)
  const startOffsetRef = useRef(0)
  const rafRef = useRef(0)
  const [scrollOffset, setScrollOffset] = useState(0)

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
      setPlaybackPos(0)
      setScrollOffset(0)
      setIsPlaying(false)
      setPlayingWhich(null)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const stopPlayback = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (playbackRef.current) {
      try {
        playbackRef.current.stop()
      } catch {
        // ignore
      }
      playbackRef.current = null
    }
    setIsPlaying(false)
    setPlayingWhich(null)
  }

  // Keep waveform window linked to playback position (cine effect).
  useEffect(() => {
    const windowSize = 6000
    const start = Math.max(0, playbackPos - Math.floor(windowSize / 2))
    setScrollOffset(start)
  }, [playbackPos])

  const playBuffer = async (which, offsetSamples = playbackPos) => {
    if (!result) return
    const samples =
      which === 'output' ? result.output_audio || [] : result.input_audio || []
    if (!samples || samples.length === 0) return

    const baseRate = Number(result.sample_rate || 11025)
    const step = Number(result.audio_step || 1)
    const effectiveRate = baseRate / step

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = audioCtxRef.current

    // Stop existing playback if any.
    stopPlayback()

    // Create buffer for the preview samples.
    const buffer = ctx.createBuffer(1, samples.length, effectiveRate)
    buffer.getChannelData(0).set(Float32Array.from(samples))

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)

    const clampedOffset = Math.max(0, Math.min(offsetSamples, samples.length - 1))
    const offsetSec = clampedOffset / effectiveRate

    src.start(0, offsetSec)
    playbackRef.current = src
    startTimeRef.current = ctx.currentTime
    startOffsetRef.current = clampedOffset
    setIsPlaying(true)
    setPlayingWhich(which)

    src.onended = () => {
      setIsPlaying(false)
      setPlayingWhich(null)
    }

    const updateProgress = () => {
      if (!playbackRef.current) return
      const elapsed = ctx.currentTime - startTimeRef.current
      const currentSample = Math.floor(startOffsetRef.current + elapsed * effectiveRate)
      if (currentSample < samples.length) {
        setPlaybackPos(currentSample)
        rafRef.current = requestAnimationFrame(updateProgress)
      } else {
        setIsPlaying(false)
        setPlayingWhich(null)
        setPlaybackPos(0)
      }
    }
    rafRef.current = requestAnimationFrame(updateProgress)
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
        <>
          <div className="panel">
            <h2>Waveforms (input vs output)</h2>
            <p>
              <strong>File:</strong> {result.filename} |{' '}
              <strong>Sample rate:</strong> {result.sample_rate} Hz |{' '}
              <strong>Samples:</strong> {result.num_samples}
            </p>
            <div className="sync-row">
              <label htmlFor="timeline">
                <strong>Timeline</strong> (linked cine viewers)
              </label>
              <input
                id="timeline"
                type="range"
                min="0"
                max={Math.max(0, (result.input_audio?.length || 0) - 1)}
                value={playbackPos}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setPlaybackPos(next)
                  if (isPlaying && playingWhich) {
                    playBuffer(playingWhich, next)
                  }
                }}
                className="timeline-slider"
              />
              <span className="sync-value">{playbackPos}</span>
            </div>
            <div className="playback-row">
              <button type="button" onClick={() => playBuffer('input', playbackPos)}>
                Play input
              </button>
              <button type="button" onClick={() => playBuffer('output', playbackPos)}>
                Play output
              </button>
              <button type="button" onClick={stopPlayback} disabled={!isPlaying}>
                Stop
              </button>
            </div>
            <div className="waveform-grid">
              <div>
                <h3>Input</h3>
                <WaveformCanvas
                  samples={result.input_audio || []}
                  offset={scrollOffset}
                  windowSize={6000}
                />
              </div>
              <div>
                <h3>Output (equalized)</h3>
                <WaveformCanvas
                  samples={result.output_audio || []}
                  offset={scrollOffset}
                  windowSize={6000}
                />
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Spectrograms (input vs output)</h2>
            <div className="spectrogram-grid">
              <div>
                <h3>Input</h3>
                <SpectrogramCanvas
                  freqs={result.spectrogram_input?.freqs || []}
                  times={result.spectrogram_input?.times || []}
                  values={result.spectrogram_input?.values || []}
                />
              </div>
              <div>
                <h3>Output</h3>
                <SpectrogramCanvas
                  freqs={result.spectrogram_output?.freqs || []}
                  times={result.spectrogram_output?.times || []}
                  values={result.spectrogram_output?.values || []}
                />
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Raw backend JSON</h2>
            <pre className="json-view">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}

export default App
