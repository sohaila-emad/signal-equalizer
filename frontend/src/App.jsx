import { useState, useEffect, useRef } from 'react';
import './App.css';
import LandingPage from './components/LandingPage';
import SliderPanel from './components/Equalizer/SliderPanel';
// import LinkedViewers from './components/Viewers/LinkedViewers';
import TripleViewers from './components/Viewers/TripleViewers';
import EcgCineViewer from './components/Viewers/EcgCineViewer';
import VoiceSeparation from './components/Separation/VoiceSeparation';
import AnimalSeparation from './components/Separation/AnimalSeparation';
import EcgAnalysis from './components/ECG/EcgAnalysis';
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
import { calculateBPM, downloadWav } from './utils';

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

/* ── TimePanBar ── */
function TimePanBar({ timeMin, timeMax, visMin, visMax, onVisChange }) {
  const fullSpan = timeMax - timeMin;
  const visSpan  = visMax  - visMin;

  const zoom = (factor) => {
    const center  = visMin + visSpan * 0.5;
    const newSpan = Math.min(fullSpan, Math.max(fullSpan * 0.01, visSpan * factor));
    let lo = center - newSpan * 0.5;
    let hi = lo + newSpan;
    if (lo < timeMin) { lo = timeMin; hi = lo + newSpan; }
    if (hi > timeMax) { hi = timeMax; lo = hi - newSpan; }
    onVisChange(Math.max(timeMin, lo), Math.min(timeMax, hi));
  };

  const pan = (dir) => {
    const step = visSpan * 0.25;
    const lo   = Math.max(timeMin, Math.min(timeMax - visSpan, visMin + dir * step));
    onVisChange(lo, lo + visSpan);
  };

  const fmt = (t) => `${t.toFixed(1)}s`;

  return (
    <div className="zoom-pan-bar">
      <button className="btn" onClick={() => zoom(1 / 1.5)}>＋ In</button>
      <button className="btn" onClick={() => zoom(1.5)}>－ Out</button>
      <div className="zoom-pan-sep" />
      <button className="btn" onClick={() => pan(-1)}>◀ Left</button>
      <button className="btn" onClick={() => pan(1)}>Right ▶</button>
      <div className="zoom-pan-sep" />
      <button className="btn" onClick={() => onVisChange(timeMin, timeMin + fullSpan * 0.1)}>Start Focus</button>
      <button className="btn" onClick={() => onVisChange(timeMin, timeMax)}>Reset</button>
      <div className="zoom-pan-sep" />
      <div className="zoom-pan-info">
        {fmt(visMin)} – {fmt(visMax)}
        &nbsp;·&nbsp;{Math.round((visSpan / fullSpan) * 100)}%
      </div>
    </div>
  );
}

export default function App() {

  const [showLanding, setShowLanding] = useState(true);

  const cloneBands = (sourceBands = []) => sourceBands.map((band) => ({
    ...band,
    ranges: band.ranges?.map((range) => ({ ...range })),
  }));

  const getModeBands = (modeName, aiEnabled = false) => {
    const modeConfig = allModes[modeName] ?? {};
    if (modeName === 'musical' && aiEnabled) {
      return cloneBands(modeConfig.ai_bands ?? modeConfig.bands ?? []);
    }
    return cloneBands(modeConfig.bands ?? []);
  };

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
  const [outputAI,           setOutputAI]           = useState(null);
  const [waveletType,        setWaveletType]        = useState('db4');
  const [waveletLevels,      setWaveletLevels]      = useState(4);
  const [fftBandsOpen,       setFftBandsOpen]       = useState(true);
  const [waveletBandsOpen,   setWaveletBandsOpen]   = useState(true);

  const [inputSignal,        setInputSignal]        = useState(null);
  const [outputSignal,       setOutputSignal]       = useState(null);
  const [inputSpectrogram,   setInputSpectrogram]   = useState(null);
  const [outputSpectrogram,  setOutputSpectrogram]  = useState(null);
  const [aiSpectrogram,      setAiSpectrogram]      = useState(null);
  const [fftData,            setFftData]            = useState(null);
  const [sampleRate,         setSampleRate]         = useState(11025);

  const [loading,            setLoading]            = useState(false);
  const [error,              setError]              = useState(null);
  const [showSpectrograms,   setShowSpectrograms]   = useState(true);
  const [isAudiogram,        setIsAudiogram]        = useState(false);
  const [useAiModel,         setUseAiModel]         = useState(false);
  const [aiStatusMessage,    setAiStatusMessage]    = useState(null);
  const [ecgAnalysis,        setEcgAnalysis]        = useState({ bpm: null, type: null });

  const [freqRange, setFreqRange] = useState({ min: 0, max: 5000 });
  const [visFreq,   setVisFreq]   = useState({ min: 0, max: 5000 });

  // Shared view state for TripleViewers
  const [viewState, setViewState] = useState({ offsetSamples: 0, zoom: 1 });

  const [visTime, setVisTime] = useState({ min: 0, max: 10 }); // Default 10s view

  const prevFftIdRef  = useRef(null);
  const requestAbortController = useRef(null);
  const isInternalUpdate = useRef(false);
  const aiRetryAttemptedRef = useRef(false);
  const initialLoadDone = useRef(false);

  // Separate pending states for FFT and Wavelet
  const [fftPendingChanges, setFftPendingChanges] = useState(false);
  const [waveletPendingChanges, setWaveletPendingChanges] = useState(false);

  /* ── Load modes ── */
  useEffect(() => {
    getModes().then(setAllModes).catch(() => setError('Failed to load modes from server.'));
  }, []);

  /* ── Auto-load demo file on mount ── */
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      loadDemoFile();
    }
  }, []);

  /* ── Load demo file on demand ── */
  const loadDemoFile = async () => {
    try {
      const res = await fetch('http://127.0.0.1:5000/static/synthetic_test.wav');
      if (!res.ok) throw new Error('Demo file not found');
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        const demoFile = new File([blob], 'synthetic_test.wav', { type: 'audio/wav' });
        setFile(demoFile);
      }
    } catch (err) {
      setError('Could not load demo file: ' + err.message);
    }
  };

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

  /* ── Reset time range when new spectrogram arrives ── */
  useEffect(() => {
    if (outputSpectrogram) {
      const totalTime = outputSpectrogram.times[outputSpectrogram.times.length - 1];
      setVisTime({ min: 0, max: totalTime });
    }
  }, [outputSpectrogram]);

  /* ── Restore default musical ranges when AI is toggled off ── */
  useEffect(() => {
    if (currentMode !== 'musical') return;
    setBands(getModeBands('musical', useAiModel));
    if (!useAiModel) {
      setOutputAI(null);
      setAiSpectrogram(null);
      setAiStatusMessage(null);
      aiRetryAttemptedRef.current = false;
    }
  }, [currentMode, useAiModel, allModes]);

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
    // ECG BPM calculation is performed in EcgAnalysis; clear previous ECG analysis here
    setEcgAnalysis({ bpm: null, type: null });
    setAiStatusMessage(result.ai_error || null);

if (result.ai_analysis && currentMode === 'musical') {
    // 1. Mark this as an internal update so useEffect ignores it
    isInternalUpdate.current = true;
    
    setBands(prevBands => prevBands.map(band => {
      const aiData = result.ai_analysis[band.id];
      if (aiData) {
        return {
          ...band,
          ai_min: aiData.min_hz,
          ai_max: aiData.max_hz,
        };
      }
      return band;
    }));
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
    setAiSpectrogram(
      result.spectrogram_ai
        ? {
            freqs: result.spectrogram_ai.freqs,
            times: result.spectrogram_ai.times,
            values: result.spectrogram_ai.values,
          }
        : null
    );
    setFftData({
      freqs:    result.fft_freqs,
      inputMag: result.input_fft,
      outputMag: result.output_fft,
    });

    setOutputWavelet(result.output_wavelet_audio ? new Float32Array(result.output_wavelet_audio) : null);
    setOutputAI(result.output_ai ? new Float32Array(result.output_ai) : null);
    setWaveletLevelBands(result.wavelet_level_bands || []);
    setWaveletConfigUsed(result.wavelet_config_used || null);

    if (
      currentMode === 'musical' &&
      useAiModel &&
      !result.spectrogram_ai &&
      !result.ai_error
    ) {
      if (!result.ai_requested && !aiRetryAttemptedRef.current) {
        aiRetryAttemptedRef.current = true;
        setAiStatusMessage('AI request was not applied. Retrying once...');
        setTimeout(() => {
          processSignalWithBands(bands);
        }, 0);
      } else if (!result.ai_requested) {
        setAiStatusMessage('AI request is still not being applied. Please refresh the page once and retry in Musical mode.');
      }
    } else if (result.spectrogram_ai) {
      aiRetryAttemptedRef.current = false;
    }

    setLoading(false);
  };

  const processSignalWithBands = async (bandsArg) => {
    try {
      requestAbortController.current?.abort();
      requestAbortController.current = new AbortController();

      setLoading(true); setError(null);
      setOutputAI(null);
      setAiSpectrogram(null);
      setAiStatusMessage(null);
      const fw = Object.keys(weights).length > 0 ? weights :
           bands.reduce((acc, b) => ({ ...acc, [b.id]: b.scale || 1.0 }), {});
      if (currentMode === 'generic') bandsArg.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
      const result = await uploadAndTransform(
        file,
        currentMode,
        fw,
        bandsArg,
        waveletWeights,
        waveletType,
        waveletLevels,
        useAiModel,
        requestAbortController.current.signal
      );
      applyResult(result);
      setFftPendingChanges(false);
      setWaveletPendingChanges(false);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  /* ── Manual Apply function (replaces debounced processing) ── */
  const handleApply = async () => {
    if (!file) return;
    try {
      requestAbortController.current?.abort();
      requestAbortController.current = new AbortController();

      setLoading(true); setError(null);
      setOutputAI(null);
      setAiSpectrogram(null);
      setAiStatusMessage(null);
      const fw = { ...weights };
      if (currentMode === 'generic') bands.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
      const result = await uploadAndTransform(
        file,
        currentMode,
        fw,
        bands,
        waveletWeights,
        waveletType,
        waveletLevels,
        currentMode === 'musical' ? true : useAiModel,
        requestAbortController.current.signal
      );
      applyResult(result);
      setFftPendingChanges(false);
      setWaveletPendingChanges(false);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  /* ── Auto-process on file change only ── */
  useEffect(() => {
    if (!file) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    handleApply();
  }, [file]);

  /* ── Auto-apply when wavelet type or levels change ── */
  const handleWaveletTypeChange = async (newType) => {
    setWaveletType(newType);
    if (!file || currentMode !== 'generic') return;

    try {
      requestAbortController.current?.abort();
      requestAbortController.current = new AbortController();
      setLoading(true); setError(null);
      setOutputAI(null);
      setAiSpectrogram(null);
      setAiStatusMessage(null);
      const fw = { ...weights };
      bands.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
      const result = await uploadAndTransform(
        file, currentMode, fw, bands, waveletWeights,
        newType, waveletLevels,
        useAiModel, requestAbortController.current.signal
      );
      applyResult(result);
      setFftPendingChanges(false);
      setWaveletPendingChanges(false);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
      setLoading(false);
    }
  };

  const handleWaveletLevelsChange = async (newLevels) => {
    setWaveletLevels(newLevels);
    if (!file || currentMode !== 'generic') return;

    try {
      requestAbortController.current?.abort();
      requestAbortController.current = new AbortController();
      setLoading(true); setError(null);
      setOutputAI(null);
      setAiSpectrogram(null);
      setAiStatusMessage(null);
      const fw = { ...weights };
      bands.forEach((b) => { if (b.id) fw[b.id] = b.scale ?? 1; });
      const result = await uploadAndTransform(
        file, currentMode, fw, bands, waveletWeights,
        waveletType, newLevels,
        useAiModel, requestAbortController.current.signal
      );
      applyResult(result);
      setFftPendingChanges(false);
      setWaveletPendingChanges(false);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
      setLoading(false);
    }
  };

  const handleModeChange = async (newMode) => {
    const hadFile = !!file;
    setCurrentMode(newMode);
    setWeights({});
    setEcgAnalysis({ bpm: null, type: null });
    setWaveletWeights({});
    setOutputAI(null);
    setUseAiModel(newMode === 'musical');
    setAiStatusMessage(null);
    aiRetryAttemptedRef.current = false;
    setFftPendingChanges(false);
    setWaveletPendingChanges(false);

    // Don't clear file when switching modes - keep the current file
    setInputSignal(null);
    setOutputSignal(null);
    setOutputWavelet(null);
    setFftData(null);
    setInputSpectrogram(null);
    setOutputSpectrogram(null);
    setAiSpectrogram(null);

    if (newMode === 'ecg') setIsAudiogram(false);

    let newBands = [];
    if (newMode !== 'generic') {
      newBands = allModes[newMode]?.bands ?? [];
      setBands(newBands);
    } else {
      setBands([]);
    }

    if (newMode === 'musical') {
      setVisFreq({ min: 20, max: 20000 });
      setFreqRange({ min: 0, max: 22050 });
    }

    let newWaveletType = 'db4';
    let newWaveletLevels = 4;
    const wcfg = allModes[newMode]?.wavelet_config;
    if (wcfg) {
      newWaveletType = wcfg.wavelet || 'db4';
      newWaveletLevels = wcfg.levels || 4;
    }
    setWaveletType(newWaveletType);
    setWaveletLevels(newWaveletLevels);

    // Auto-apply when switching modes with file loaded (instant switch)
    if (hadFile && newMode !== 'ecg') {
      try {
        requestAbortController.current?.abort();
        requestAbortController.current = new AbortController();
        setLoading(true); setError(null);
        setOutputAI(null);
        setAiSpectrogram(null);
        setAiStatusMessage(null);
        const fw = newBands.reduce((acc, b) => ({ ...acc, [b.id]: b.scale || 1.0 }), {});
        const result = await uploadAndTransform(
          file,
          newMode,
          fw,
          newBands,
          {},
          newWaveletType,
          newWaveletLevels,
          newMode === 'musical',
          requestAbortController.current.signal
        );
        applyResult(result);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
        setLoading(false);
      }
    }
  };

  const handleEcgAnalysisComplete = (wavFile, suggestedBands, suggestedWaveletWeights) => {
    setFile(wavFile);
    if (Array.isArray(suggestedBands) && suggestedBands.length > 0) {
      setBands(suggestedBands);
    }
    if (suggestedWaveletWeights && typeof suggestedWaveletWeights === 'object') {
      setWaveletWeights(suggestedWaveletWeights);
    }
    setFftPendingChanges(true);
    setWaveletPendingChanges(true);
  };

  const handleExport = () => {
    if (!outputSignal || !sampleRate) return;
    const newName = file ? file.name.replace('.wav', '_eq.wav') : 'equalized_output.wav';
    downloadWav(outputSignal, sampleRate, newName);
  };

  const hasResults = inputSignal && outputSignal && !loading;
  const showAiSpectrogram = currentMode === 'musical' && useAiModel && !!aiSpectrogram;

  /* ── Mode entries for combo box ── */
  const modeEntries = Object.entries({
    ...(allModes.generic ? {} : { generic: { label: 'Generic' } }),
    ...allModes,
  });

  const statusClass = loading ? 'processing' : error ? 'error' : file ? 'ready' : '';
  const statusText  = loading ? 'Processing...'  : error ? 'Error'   : file ? 'Ready'  : 'No file loaded';

  if (showLanding) {
    return <LandingPage onEnter={() => setShowLanding(false)} />;
  }

  if (showLanding) {
    return <LandingPage onEnter={() => setShowLanding(false)} />;
  }

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
          <button className="brand-back-btn" onClick={() => setShowLanding(true)} title="Back to home">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Home
          </button>
        </div>

        <div className="sidebar-upload">
          <span className="sidebar-section-label">Audio Source</span>
          <FileUploader onFileSelect={setFile} file={file} mode={currentMode} />
        </div>

        {/* Mode tabs in sidebar */}
        <div className="sidebar-modes">
          <span className="sidebar-section-label" style={{ padding: '0 16px', display: 'block', marginBottom: 4 }}>Mode</span>
          {modeEntries.map(([key, cfg]) => {
            const meta = MODE_META[key] || DEFAULT_META;
            const label = meta.label || cfg.label || key;
            return (
              <button
                key={key}
                className={`mode-tab ${currentMode === key ? 'active' : ''}`}
                onClick={() => !loading && handleModeChange(key)}
                disabled={loading}
              >
                <span className="mode-tab-icon">{meta.icon}</span>
                {label}
                {meta.badge && <span className="mode-tab-badge">{meta.badge}</span>}
              </button>
            );
          })}
        </div>

        <div className="sidebar-status">
          <div className="status-row">
            <div className={`status-dot ${statusClass}`} />
            {statusText}
            {file && !loading && !error && (
              <span className="status-size">{(file.size / 1024).toFixed(0)} KB</span>
            )}
          </div>
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

        {/* Page title bar */}
        <div className="main-topbar">
          <div className="main-topbar-left">
            <span className="main-mode-label">
              {(() => { const meta = MODE_META[currentMode]; return meta ? <>{meta.icon} {meta.label || currentMode}</> : currentMode; })()}
            </span>
          </div>
        </div>

        {error && (
          <div className="error-card">
            <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
            {error}
            <button className="error-dismiss" onClick={() => setError(null)}>x</button>
          </div>
        )}

        {/* No file */}
        {!file && currentMode !== 'ecg' && (
          <div className="section-card">
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p>Upload a <strong style={{ color: 'var(--text-mid)' }}>WAV file</strong> from the sidebar<br />then adjust the equalizer bands</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={loadDemoFile}
                style={{ marginTop: 12 }}
              >
                Load Demo Audio
              </button>
            </div>
          </div>
        )}

        {/* Equalizer bands */}
        {(file || currentMode === 'ecg') && (
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
              {/* Wavelet controls row */}
              <div className="wavelet-controls-row" style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                <label style={{ fontWeight: 500 }}>
                  Wavelet:
                  <select
                    value={waveletConfigUsed?.wavelet || waveletType}
                    onChange={e => handleWaveletTypeChange(e.target.value)}
                    disabled={currentMode !== 'generic' || loading}
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
                    onChange={e => handleWaveletLevelsChange(Number(e.target.value))}
                    disabled={currentMode !== 'generic' || loading}
                    style={{ width: 48, marginLeft: 8 }}
                  />
                </label>
                <span style={{ color: '#888', fontSize: 13 }}>
                  {currentMode !== 'generic'
                    ? 'Preset for this mode'
                    : 'Choose wavelet and levels'}
                </span>
              </div>

              {/* Collapsible Wavelet Bands */}
              <div className="collapsible-panel">
                <button type="button" onClick={() => setWaveletBandsOpen(p => !p)} style={{ fontWeight: 600, marginBottom: 4 }}>
                  Wavelet Bands ({waveletConfigUsed?.wavelet || waveletType}) {waveletBandsOpen ? '^' : 'v'}
                </button>
                {waveletBandsOpen && (
                  <SliderPanel
                    mode="wavelet"
                    bands={waveletLevelBands}
                    onBandsChange={() => {}}
                    weights={waveletWeights}
                    onWeightsChange={(w) => { setWaveletWeights(w); setWaveletPendingChanges(true); }}
                    onApply={handleApply}
                    pendingChanges={waveletPendingChanges}
                    setPendingChanges={setWaveletPendingChanges}
                  />
                )}
              </div>

              {/* Collapsible FFT Bands */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 12 }}>
                <div className="collapsible-panel" style={{ flex: 1 }}>
                  <button type="button" onClick={() => setFftBandsOpen(p => !p)} style={{ fontWeight: 600, marginBottom: 4 }}>
                    FFT Bands {fftBandsOpen ? '^' : 'v'}
                  </button>
                  {fftBandsOpen && (
                    <SliderPanel
                      mode={currentMode}
                      bands={bands}
                      onBandsChange={setBands}
                      weights={weights}
                      onWeightsChange={setWeights}
                      isAiMode={useAiModel}
                      onApply={handleApply}
                      pendingChanges={fftPendingChanges}
                      setPendingChanges={setFftPendingChanges}
                    />
                  )}
                </div>
              </div>


            </div>
          </div>
        )}

        {/* ── Voice Separation panel (Human Voice mode only) ── */}
        {file && currentMode === 'human' && (
          <VoiceSeparation
            file={file}
            disabled={loading}
          />
        )}

        {/* ── Animal Sound Separation panel (Animal mode only) ── */}
        {file && currentMode === 'animal' && (
          <AnimalSeparation
            file={file}
            disabled={loading}
          />
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

        {/* ECG AI Analysis — self-contained when ECG mode active */}
        {currentMode === 'ecg' && (
          <EcgAnalysis
            setEcgAnalysis={setEcgAnalysis}
            onAnalysisComplete={handleEcgAnalysisComplete}
          />
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
                {currentMode === 'musical' && (
                  <button
                    type="button"
                    className={`toggle-pill ${useAiModel ? 'on' : ''}`}
                    onClick={() => setUseAiModel((p) => !p)}
                  >
                    AI {useAiModel ? '✓' : ''}
                  </button>
                )}
              </div>
              <div className="section-body">
                <TripleViewers
                  inputSignal={inputSignal}
                  fftOutput={outputSignal}
                  waveletOutput={outputWavelet}
                  aiOutput={outputAI}
                  showAi={currentMode === 'ecg' ? !!outputAI : useAiModel}
                  sampleRate={sampleRate}
                  viewState={viewState}
                  setViewState={setViewState}
                  isEcgMode={currentMode === 'ecg'}
                />
                {/* ECG diagnosis panel removed; EcgAnalysis provides its own summary and suggested bands seeds sliders */}
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
                  disableAudiogram={currentMode === 'ecg'}
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
              {showSpectrograms && outputSpectrogram && (
                <div className="section-body">
                  <TimePanBar
                    timeMin={outputSpectrogram.times[0]}
                    timeMax={outputSpectrogram.times[outputSpectrogram.times.length - 1]}
                    visMin={visTime.min}
                    visMax={visTime.max}
                    onVisChange={(lo, hi) => setVisTime({ min: lo, max: hi })}
                  />
                  <div
                    className="spectrogram-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${showAiSpectrogram ? 3 : 2}, minmax(0, 1fr))`,
                      gap: 16,
                    }}
                  >
                    {inputSpectrogram && (
                      <Spectrogram
                        freqs={inputSpectrogram.freqs}
                        times={inputSpectrogram.times}
                        data={inputSpectrogram.values}
                        minFreq={visFreq.min}
                        maxFreq={visFreq.max}
                        minTime={visTime.min}
                        maxTime={visTime.max}
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
                        minTime={visTime.min}
                        maxTime={visTime.max}
                        label="FFT Output"
                      />
                    )}
                    {showAiSpectrogram && (
                      <Spectrogram
                        freqs={aiSpectrogram.freqs}
                        times={aiSpectrogram.times}
                        data={aiSpectrogram.values}
                        minFreq={visFreq.min}
                        maxFreq={visFreq.max}
                        minTime={visTime.min}
                        maxTime={visTime.max}
                        label="AI Output"
                      />
                    )}
                  </div>
                  {currentMode === 'musical' && useAiModel && !showAiSpectrogram && (
                    <div style={{ marginTop: 10, color: 'var(--text-mid)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {aiStatusMessage ? `AI spectrogram unavailable: ${aiStatusMessage}` : 'AI is enabled. Processing model output...'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}