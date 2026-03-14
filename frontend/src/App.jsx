import { useState, useEffect, useRef } from 'react';
import './App.css';
import SliderPanel from './components/Equalizer/SliderPanel';
import LinkedViewers from './components/Viewers/LinkedViewers';
import TripleViewers from './components/Viewers/TripleViewers';
// Wavelet dropdown options
const WAVELET_OPTIONS = [
  { value: 'db4',  label: 'db4 (ECG)' },
  { value: 'db6',  label: 'db6 (Animal)' },
  { value: 'db8',  label: 'db8 (Musical)' },
  { value: 'sym4', label: 'sym4 (Human Voice)' },
  { value: 'haar', label: 'haar (Generic/Simple)' },
];
import FftGraph from './components/Graphs/FftGraph';
import Spectrogram from './components/Graphs/Spectrogram';
import FileUploader from './components/Layout/FileUploader';
import { uploadAndTransform, getModes } from './services/api';
import { calculateBPM, downloadWav } from './utils'; // Ensure downloadWav is exported from utils.js

/* ── SVG helpers ── */
function Icon({ d, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
function PolyIcon({ points, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points} />
    </svg>
  );
}

/* ── Mode definitions (icon + label) ── */
const MODE_META = {
  generic: {
    label: 'Generic',
    icon: <Icon d="M4 6h16M8 12h8M6 18h12" />,
    badge: 'Custom',
  },
  musical: {
    label: 'Musical',
    icon: <Icon d="M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  },
  animal: {
    label: 'Animal',
    icon: <Icon d="M12 8c-1.7-2-5-2.5-6.5.5C4 11.5 5 15 8 16c1.5.5 3 .5 4 0 1 .5 2.5.5 4 0 3-1 4-4.5 2.5-7.5C17 5.5 13.7 6 12 8z" />,
  },
  human: {
    label: 'Human Voice',
    icon: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  },
  ecg: {
    label: 'ECG',
    icon: <PolyIcon points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  },
};
const DEFAULT_META = { label: null, icon: <Icon d="M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 12h3M18 12h3M12 3v3M12 18v3" /> };

/* ── ZoomPanBar ── */
function ZoomPanBar({ freqMin, freqMax, visMin, visMax, onVisChange, isAudiogram, onToggleAudiogram, disableAudiogram }) {
  const fullSpan = freqMax - freqMin;
  const visSpan  = visMax  - visMin;

  const zoom = (factor) => {
    const center  = visMin + visSpan * 0.5;
    const newSpan = Math.min(fullSpan, Math.max(fullSpan * 0.01, visSpan * factor));
    let lo = center - newSpan * 0.5;
    let hi = lo + newSpan;
    if (lo < freqMin) { lo = freqMin; hi = lo + newSpan; }
    if (hi > freqMax) { hi = freqMax; lo = hi - newSpan; }
    onVisChange(Math.max(freqMin, lo), Math.min(freqMax, hi));
  };

  const pan = (dir) => {
    const step = visSpan * 0.25;
    const lo   = Math.max(freqMin, Math.min(freqMax - visSpan, visMin + dir * step));
    onVisChange(lo, lo + visSpan);
  };

  const fmt = (f) => f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`;

  return (
    <div className="zoom-pan-bar">
      <button className="btn" onClick={() => zoom(1 / 1.5)}>＋ In</button>
      <button className="btn" onClick={() => zoom(1.5)}>－ Out</button>
      <div className="zoom-pan-sep" />
      <button className="btn" onClick={() => pan(-1)}>◀ Left</button>
      <button className="btn" onClick={() => pan(1)}>Right ▶</button>
      <div className="zoom-pan-sep" />
      <button className="btn" onClick={() => onVisChange(freqMin, freqMin + fullSpan * 0.05)}>Low Focus</button>
      <button className="btn" onClick={() => onVisChange(freqMin, freqMax)}>Reset</button>
      <div className="zoom-pan-sep" />
      <button
        className={`toggle-pill ${isAudiogram ? 'on' : ''} ${disableAudiogram ? 'disabled' : ''}`}
        onClick={!disableAudiogram ? onToggleAudiogram : undefined}
        disabled={disableAudiogram}
      >
        {isAudiogram ? 'Audiogram ✓' : 'Audiogram'}
      </button>
      <div className="zoom-pan-info">
        {fmt(visMin)} – {fmt(visMax)} Hz
        &nbsp;·&nbsp;{Math.round((visSpan / fullSpan) * 100)}%
        {disableAudiogram && <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>ECG: linear only</span>}
      </div>
    </div>
  );
}

export default function App() {

  const [file,              setFile]              = useState(null);
  const [currentMode,       setCurrentMode]       = useState('generic');
  const [allModes,          setAllModes]          = useState({});
  const [bands,             setBands]             = useState([]);
  const [weights,           setWeights]           = useState({});

  // Wavelet pipeline state
  const [waveletWeights,     setWaveletWeights]     = useState({});
  const [waveletLevelBands,  setWaveletLevelBands]  = useState([]);
  const [waveletConfigUsed,  setWaveletConfigUsed]  = useState(null);
  const [outputWavelet,      setOutputWavelet]      = useState(null);
  const [waveletType,        setWaveletType]        = useState('db4');
  const [waveletLevels,      setWaveletLevels]      = useState(4);
  const [fftBandsOpen,       setFftBandsOpen]       = useState(true);
  const [waveletBandsOpen,   setWaveletBandsOpen]   = useState(true);

  const [inputSignal,        setInputSignal]        = useState(null);
  const [outputSignal,       setOutputSignal]       = useState(null);
  const [inputSpectrogram,   setInputSpectrogram]   = useState(null);
  const [outputSpectrogram,  setOutputSpectrogram]  = useState(null);
  const [fftData,            setFftData]            = useState(null);
  const [sampleRate,         setSampleRate]         = useState(11025);

  const [loading,            setLoading]            = useState(false);
  const [error,              setError]              = useState(null);
  const [showSpectrograms,   setShowSpectrograms]   = useState(true);
  const [isAudiogram,        setIsAudiogram]        = useState(false);
  const [ecgAnalysis,        setEcgAnalysis]        = useState({ bpm: null, type: null });

  const [freqRange, setFreqRange] = useState({ min: 0, max: 5000 });
  const [visFreq,   setVisFreq]   = useState({ min: 0, max: 5000 });

  // Shared view state for TripleViewers
  const [viewState, setViewState] = useState({});

  const prevFftIdRef  = useRef(null);
  const debounceTimer = useRef(null);

  /* ── Load modes ── */
  useEffect(() => {
    getModes().then(setAllModes).catch(() => setError('Failed to load modes from server.'));
  }, []);

  /* ── Set freq range when new FFT data arrives ── */
  useEffect(() => {
    if (!fftData?.freqs?.length) return;
    const id = fftData.freqs.length + '_' + fftData.freqs[fftData.freqs.length - 1];
    if (id === prevFftIdRef.current) return;
    prevFftIdRef.current = id;
    const max = Math.max(...fftData.freqs);
    setFreqRange({ min: 0, max });
    setVisFreq({ min: 0, max });
  }, [fftData]);

  /* ── Clamp visFreq.min when audiogram toggled ── */
  useEffect(() => {
    if (isAudiogram && visFreq.min < 20) {
      setVisFreq((v) => ({ ...v, min: 20 }));
      setFreqRange((r) => ({ ...r, min: 20 }));
    } else if (!isAudiogram) {
      setFreqRange((r) => ({ ...r, min: 0 }));
    }
  }, [isAudiogram]);

  /* ── bandsLoadedFromConfig event ── */
  useEffect(() => {
    const handler = (e) => { if (file) processSignalWithBands(e.detail); };
    window.addEventListener('bandsLoadedFromConfig', handler);
    return () => window.removeEventListener('bandsLoadedFromConfig', handler);
  }, [file, currentMode, weights]);

  const applyResult = (result) => {
    setInputSignal(new Float32Array(result.input_audio));
    setOutputSignal(new Float32Array(result.output_audio));
    setSampleRate(result.sample_rate);

    if (currentMode === 'ecg') {
      const analysis = calculateBPM(new Float32Array(result.output_audio), result.sample_rate);
      setEcgAnalysis(analysis || { bpm: null, type: 'Unknown' });
    } else {
      setEcgAnalysis({ bpm: null, type: null });
    }

    setInputSpectrogram({
      freqs: result.spectrogram_input.freqs,
      times: result.spectrogram_input.times,
      values: result.spectrogram_input.values,
    });
    setOutputSpectrogram({
      freqs: result.spectrogram_output.freqs,
      times: result.spectrogram_output.times,
      values: result.spectrogram_output.values,
    });
    setFftData({
      freqs:    result.fft_freqs,
      inputMag: result.input_fft,
      outputMag: result.output_fft,
    });

    // --- Wavelet pipeline fields ---
    setOutputWavelet(result.output_wavelet_audio ? new Float32Array(result.output_wavelet_audio) : null);
    setWaveletLevelBands(result.wavelet_level_bands || []);
    setWaveletConfigUsed(result.wavelet_config_used || null);

    setLoading(false);
  };

  const processSignalWithBands = async (bandsArg) => {
    try {
      setLoading(true); setError(null);
      const fw = { ...weights };
      if (currentMode === 'generic') bandsArg.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
      const result = await uploadAndTransform(
        file,
        currentMode,
        fw,
        bandsArg,
        waveletWeights,
        waveletType,
        waveletLevels
      );
      applyResult(result);
    } catch (err) {
      setError(err.message); setLoading(false);
    }
  };

  /* ── Debounced processing ── */
  useEffect(() => {
    if (!file) return;
    const run = async () => {
      try {
        setLoading(true); setError(null);
        const fw = { ...weights };
        if (currentMode === 'generic') bands.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
        const result = await uploadAndTransform(
          file,
          currentMode,
          fw,
          bands,
          waveletWeights,
          waveletType,
          waveletLevels
        );
        applyResult(result);
      } catch (err) { setError(err.message); setLoading(false); }
    };
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(run, 350);
    return () => clearTimeout(debounceTimer.current);
  }, [file, currentMode, bands, weights, waveletWeights, waveletType, waveletLevels]);

  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    setWeights({});
    setEcgAnalysis({ bpm: null, type: null });
    setWaveletWeights({});
    if (newMode === 'ecg') setIsAudiogram(false);
    if (newMode !== 'generic') setBands(allModes[newMode]?.bands ?? []);
    else setBands([]);
    // Set wavelet type/levels from mode config
    const wcfg = allModes[newMode]?.wavelet_config;
    if (wcfg) {
      setWaveletType(wcfg.wavelet || 'db4');
      setWaveletLevels(wcfg.levels || 4);
    } else {
      setWaveletType('db4');
      setWaveletLevels(4);
    }
  };

  const handleExport = () => {
    if (!outputSignal || !sampleRate) return;
    const newName = file ? file.name.replace('.wav', '_eq.wav') : 'equalized_output.wav';
    downloadWav(outputSignal, sampleRate, newName);
  };

  const isEcg     = currentMode === 'ecg';
  const hasResults = inputSignal && outputSignal && !loading;

  /* ── Mode tab list ── */
  // Only include 'generic' if not present in allModes
  const modeEntries = Object.entries({
    ...(allModes.generic ? {} : { generic: { label: 'Generic' } }),
    ...allModes,
  });

  const statusClass = loading ? 'processing' : error ? 'error' : file ? 'ready' : '';
  const statusText  = loading ? 'Processing…'  : error ? 'Error'   : file ? 'Ready'  : 'No file loaded';

  return (
    <div className="app-layout">

      {/* ═══ SIDEBAR ═══ */}
      <aside className="sidebar">

        <div className="sidebar-brand">
          <div className="brand-row">
            <div className="brand-pulse" />
            <span className="brand-name">Equalizer</span>
          </div>
          <div className="brand-sub">Signal Processing Studio</div>
        </div>

        <div className="sidebar-upload">
          <span className="sidebar-section-label">Audio Source</span>
          <FileUploader onFileSelect={setFile} file={file} />
        </div>

        <nav className="sidebar-modes">
          <span className="sidebar-section-label" style={{ padding: '0 16px', display: 'block', marginBottom: 6 }}>
            Mode
          </span>
          {modeEntries.map(([key, cfg]) => {
            const meta  = MODE_META[key] || { ...DEFAULT_META, label: cfg.label || key };
            const label = meta.label || cfg.label || key;
            return (
              <button
                key={key}
                type="button"
                className={`mode-tab ${currentMode === key ? 'active' : ''}`}
                onClick={() => handleModeChange(key)}
              >
                <span className="mode-tab-icon">{meta.icon}</span>
                <span>{label}</span>
                {meta.badge && <span className="mode-tab-badge">{meta.badge}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <div className="status-row">
            <div className={`status-dot ${statusClass}`} />
            {statusText}
            {file && !loading && !error && (
              <span className="status-size">{(file.size / 1024).toFixed(0)} KB</span>
            )}
          </div>
          {/* Integrated Export Button here in the sidebar */}
          {hasResults && (
            <button 
              className="btn btn-primary" 
              onClick={handleExport} 
              style={{ width: '100%', marginTop: 12, justifyContent: 'center' }}
            >
              <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              Export WAV
            </button>
          )}
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <main className="main-content">

        {error && (
          <div className="error-card">
            <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
            {error}
            <button className="error-dismiss" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* No file */}
        {!file && (
          <div className="section-card">
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p>Upload a <strong style={{ color: 'var(--text-mid)' }}>WAV file</strong> from the sidebar<br />then adjust the equalizer bands</p>
            </div>
          </div>
        )}

        {/* Equalizer bands: Wavelet and FFT panels, improved order and button placement */}
        {file && (
          <div className="section-card">
            <div className="section-head">
              <div className="section-head-left">
                <span className="section-icon">
                  <Icon d="M4 6h16M8 12h8M6 18h12" />
                </span>
                <span className="section-title">
                  {currentMode === 'generic'
                    ? 'Custom Frequency Bands'
                    : `${allModes[currentMode]?.label || currentMode} — Equalizer`}
                </span>
              </div>
            </div>
            <div className="section-body">
              {/* 1. Wavelet controls row */}
              <div className="wavelet-controls-row" style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                <label style={{ fontWeight: 500 }}>
                  Wavelet:
                  <select
                    value={waveletConfigUsed?.wavelet || waveletType}
                    onChange={e => setWaveletType(e.target.value)}
                    disabled={currentMode !== 'generic'}
                    style={{ marginLeft: 8 }}
                  >
                    {WAVELET_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontWeight: 500 }}>
                  Levels:
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={waveletConfigUsed?.levels || waveletLevels}
                    onChange={e => setWaveletLevels(Number(e.target.value))}
                    disabled={currentMode !== 'generic'}
                    style={{ width: 48, marginLeft: 8 }}
                  />
                </label>
                <span style={{ color: '#888', fontSize: 13 }}>
                  {currentMode !== 'generic'
                    ? 'Preset for this mode'
                    : 'Choose wavelet and levels'}
                </span>
              </div>

              {/* 2. Collapsible Wavelet Bands */}
              <div className="collapsible-panel">
                <button type="button" onClick={() => setWaveletBandsOpen(p => !p)} style={{ fontWeight: 600, marginBottom: 4 }}>
                  Wavelet Bands ({waveletConfigUsed?.wavelet || waveletType}) {waveletBandsOpen ? '▲' : '▼'}
                </button>
                {waveletBandsOpen && (
                  <SliderPanel
                    mode="wavelet"
                    bands={waveletLevelBands}
                    onBandsChange={() => {}}
                    weights={waveletWeights}
                    onWeightsChange={setWaveletWeights}
                  />
                )}
              </div>

              {/* 3. Collapsible FFT Bands and Add/Save/Load buttons (side by side) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 12 }}>
                <div className="collapsible-panel" style={{ flex: 1 }}>
                  <button type="button" onClick={() => setFftBandsOpen(p => !p)} style={{ fontWeight: 600, marginBottom: 4 }}>
                    FFT Bands {fftBandsOpen ? '▲' : '▼'}
                  </button>
                  {fftBandsOpen && (
                    <SliderPanel
                      mode={currentMode}
                      bands={bands}
                      onBandsChange={setBands}
                      weights={weights}
                      onWeightsChange={setWeights}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="loading-card">
            <div className="eq-bars">
              {[...Array(7)].map((_, i) => <div key={i} className="eq-bar" />)}
            </div>
            <div className="loading-text">Analyzing signal…</div>
          </div>
        )}

        {/* Results */}
        {hasResults && (
          <>
            {/* Waveforms */}
            <div className="section-card">
              <div className="section-head">
                <div className="section-head-left">
                  <span className="section-icon">
                    <Icon d="M2 12h3l3-8 4 16 3-8h3" />
                  </span>
                  <span className="section-title">Waveform Comparison</span>
                </div>
              </div>
              <div className="section-body">
                <TripleViewers
                  inputSignal={inputSignal}
                  fftOutput={outputSignal}
                  waveletOutput={outputWavelet}
                  sampleRate={sampleRate}
                  viewState={viewState}
                  setViewState={setViewState}
                />
                {isEcg && ecgAnalysis.bpm !== null && (
                  <div className="ecg-diagnosis-panel">
                    <h3>ECG Analysis</h3>
                    <p>Heart Rate: <strong>{ecgAnalysis.bpm} BPM</strong></p>
                    <span className={`status-tag ${ecgAnalysis.type === 'Normal' ? 'normal' : 'warning'}`}>
                      {ecgAnalysis.type}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* FFT */}
            <div className="section-card">
              <div className="section-head">
                <div className="section-head-left">
                  <span className="section-icon">
                    <Icon d="M3 3v18h18M7 16l4-8 4 8" />
                  </span>
                  <span className="section-title">Frequency Analysis</span>
                </div>
              </div>
              <div className="section-body">
                <ZoomPanBar
                  freqMin={freqRange.min}
                  freqMax={freqRange.max}
                  visMin={visFreq.min}
                  visMax={visFreq.max}
                  onVisChange={(lo, hi) => setVisFreq({ min: lo, max: hi })}
                  isAudiogram={isAudiogram}
                  onToggleAudiogram={() => setIsAudiogram((p) => !p)}
                  disableAudiogram={isEcg}
                />
                {fftData && (
                  <FftGraph
                    freqs={fftData.freqs}
                    inputMag={fftData.inputMag}
                    outputMag={fftData.outputMag}
                    isAudiogram={isAudiogram}
                    bands={bands}
                    minFreq={visFreq.min}
                    maxFreq={visFreq.max}
                    label="FFT Equalization"
                  />
                )}
              </div>
            </div>

            {/* Spectrograms */}
            <div className="section-card">
              <div className="section-head">
                <div className="section-head-left">
                  <span className="section-icon">
                    <Icon d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
                  </span>
                  <span className="section-title">Spectrograms</span>
                </div>
                <div className="graph-controls">
                  <button
                    type="button"
                    className="toggle-pill"
                    onClick={() => setShowSpectrograms((p) => !p)}
                  >
                    {showSpectrograms ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {showSpectrograms && (
                <div className="section-body">
                  <div className="spectrogram-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                    {inputSpectrogram && (
                      <Spectrogram
                        freqs={inputSpectrogram.freqs}
                        times={inputSpectrogram.times}
                        data={inputSpectrogram.values}
                        minFreq={visFreq.min}
                        maxFreq={visFreq.max}
                        label="Input"
                      />
                    )}
                    {outputSpectrogram && (
                      <Spectrogram
                        freqs={outputSpectrogram.freqs}
                        times={outputSpectrogram.times}
                        data={outputSpectrogram.values}
                        minFreq={visFreq.min}
                        maxFreq={visFreq.max}
                        label="FFT Output"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}