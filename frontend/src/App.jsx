import { useState, useEffect, useRef } from 'react';
import './App.css';
import Header from './components/Layout/Header';
import ModeSelector from './components/Layout/ModeSelector';
import FileUploader from './components/Layout/FileUploader';
import SliderPanel from './components/Equalizer/SliderPanel';
import LinkedViewers from './components/Viewers/LinkedViewers';
import FftGraph from './components/Graphs/FftGraph';
import Spectrogram from './components/Graphs/Spectrogram';
import { uploadAndTransform, getModes } from './services/api';
import { calculateBPM } from './utils';

// ── ZoomPanBar ────────────────────────────────────────────────────────────────
function ZoomPanBar({ freqMin, freqMax, visMin, visMax, onVisChange, isAudiogram, onToggleAudiogram, disableAudiogram }) {
  const fullSpan = freqMax - freqMin;
  const visSpan  = visMax  - visMin;

  const zoom = (factor) => {
    const center = visMin + visSpan * 0.5;
    const newSpan = Math.min(fullSpan, Math.max(fullSpan * 0.01, visSpan * factor));
    let lo = center - newSpan * 0.5;
    let hi = lo + newSpan;
    if (lo < freqMin) { lo = freqMin; hi = lo + newSpan; }
    if (hi > freqMax) { hi = freqMax; lo = hi - newSpan; }
    onVisChange(Math.max(freqMin, lo), Math.min(freqMax, hi));
  };

  const pan = (dir) => {
    const step = visSpan * 0.25;
    const lo = Math.max(freqMin, Math.min(freqMax - visSpan, visMin + dir * step));
    onVisChange(lo, lo + visSpan);
  };

  const btn = (label, onClick, active = false, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        fontSize: '11px',
        background: active ? '#1d4ed8' : disabled ? '#1e293b' : '#334155',
        color: disabled ? '#475569' : '#cbd5e1',
        border: `1px solid ${disabled ? '#334155' : '#475569'}`,
        borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );

  const sep = <div style={{ width: 1, height: 22, background: '#334155', margin: '0 2px' }} />;
  const fmt = (f) => f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`;

  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
      background: '#1e293b', padding: '8px 10px', borderRadius: 8,
    }}>
      {btn('＋ Zoom In',    () => zoom(1 / 1.5))}
      {btn('－ Zoom Out',   () => zoom(1.5))}
      {sep}
      {btn('◀ Pan Left',   () => pan(-1))}
      {btn('Pan Right ▶',  () => pan(1))}
      {sep}
      {btn('Focus Low',    () => onVisChange(freqMin, freqMin + fullSpan * 0.05))}
      {btn('Reset',        () => onVisChange(freqMin, freqMax))}
      {sep}
      {btn(
        isAudiogram ? 'Log ✓' : 'Audiogram',
        onToggleAudiogram,
        isAudiogram,
        disableAudiogram,
      )}

      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {fmt(visMin)} – {fmt(visMax)} Hz
        &nbsp;({Math.round((visSpan / fullSpan) * 100)}% of range)
        {disableAudiogram && <span style={{ color: '#475569' }}> · Linear (ECG mode)</span>}
      </span>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [file,            setFile]            = useState(null);
  const [currentMode,     setCurrentMode]     = useState('generic');
  const [allModes,        setAllModes]        = useState({});
  const [bands,           setBands]           = useState([]);
  const [weights,         setWeights]         = useState({});

  const [inputSignal,     setInputSignal]     = useState(null);
  const [outputSignal,    setOutputSignal]    = useState(null);
  const [inputSpectrogram, setInputSpectrogram]   = useState(null);
  const [outputSpectrogram, setOutputSpectrogram] = useState(null);
  const [fftData,         setFftData]         = useState(null);
  const [sampleRate,      setSampleRate]      = useState(11025);

  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [showSpectrograms,setShowSpectrograms]= useState(true);
  const [isAudiogram,     setIsAudiogram]     = useState(false);
  const [ecgAnalysis,     setEcgAnalysis]     = useState({ bpm: null, type: null });

  // Frequency view — full data range + current visible window
  const [freqRange, setFreqRange] = useState({ min: 0, max: 5000 });
  const [visFreq,   setVisFreq]   = useState({ min: 0, max: 5000 });

  // Set full range once when data arrives (NOT when isAudiogram changes — that would wipe zoom)
  const prevFftIdRef = useRef(null);
  useEffect(() => {
    if (!fftData?.freqs?.length) return;
    const id = fftData.freqs.length + '_' + fftData.freqs[fftData.freqs.length - 1];
    if (id === prevFftIdRef.current) return; // same dataset, don't reset
    prevFftIdRef.current = id;
    const min = 0;
    const max = Math.max(...fftData.freqs);
    setFreqRange({ min, max });
    setVisFreq({ min, max });
  }, [fftData]);

  // When audiogram toggles, just clamp visFreq.min to 20 if needed — don't wipe zoom
  useEffect(() => {
    if (isAudiogram && visFreq.min < 20) {
      setVisFreq((v) => ({ ...v, min: 20 }));
      setFreqRange((r) => ({ ...r, min: 20 }));
    } else if (!isAudiogram) {
      setFreqRange((r) => ({ ...r, min: 0 }));
    }
  }, [isAudiogram]);

  const handleVisChange = (lo, hi) => setVisFreq({ min: lo, max: hi });

  // Fetch modes
  useEffect(() => {
    getModes()
      .then((data) => setAllModes(data))
      .catch((err) => console.error('Failed to load modes:', err));
  }, []);

  // bandsLoadedFromConfig event
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
      freqs: result.fft_freqs,
      inputMag: result.input_fft,
      outputMag: result.output_fft,
    });
    setLoading(false);
  };

  const processSignalWithBands = async (bandsArg) => {
    try {
      setLoading(true);
      setError(null);
      const finalWeights = { ...weights };
      if (currentMode === 'generic') {
        bandsArg.forEach((band) => {
          if (band.id) finalWeights[band.id] = band.scale ?? 1;
        });
      }
      const result = await uploadAndTransform(file, currentMode, finalWeights, bandsArg);
      applyResult(result);
    } catch (err) {
      console.error('Processing error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const debounceTimer = useRef(null);
  useEffect(() => {
    if (!file) return;
    const processSignal = async () => {
      try {
        setLoading(true);
        setError(null);
        const finalWeights = { ...weights };
        if (currentMode === 'generic') {
          bands.forEach((band) => {
            if (band.id) finalWeights[band.id] = band.scale ?? 1;
          });
        }
        const result = await uploadAndTransform(file, currentMode, finalWeights, bands);
        applyResult(result);
      } catch (err) {
        console.error('Processing error:', err);
        setError(err.message);
        setLoading(false);
      }
    };
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(processSignal, 350);
    return () => clearTimeout(debounceTimer.current);
  }, [file, currentMode, bands, weights]);

  const handleFileSelect = (f) => setFile(f);

  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    setWeights({});
    setEcgAnalysis({ bpm: null, type: null });
    if (newMode === 'ecg') setIsAudiogram(false); // force linear for ECG
    if (newMode !== 'generic') setBands(allModes[newMode]?.bands ?? []);
  };

  const isEcg = currentMode === 'ecg';

  return (
    <div className="app">
      <Header />

      <div className="panel">
        <h2>Configuration</h2>
        <FileUploader onFileSelect={handleFileSelect} />
        <ModeSelector value={currentMode} onChange={handleModeChange} modes={allModes} />
        {file && <p className="file-info">Selected: {file.name}</p>}
      </div>

      {file && (
        <div className="panel">
          <SliderPanel
            mode={currentMode}
            bands={bands}
            onBandsChange={setBands}
            weights={weights}
            onWeightsChange={setWeights}
          />
        </div>
      )}

      {loading && <div className="panel"><p>Processing...</p></div>}

      {error && <div className="panel error"><p>Error: {error}</p></div>}

      {inputSignal && outputSignal && !loading && (
        <>
          {/* Waveform viewer */}
          <div className="panel">
            <LinkedViewers
              inputSignal={inputSignal}
              outputSignal={outputSignal}
              sampleRate={sampleRate}
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

          {/* Frequency analysis */}
          <div className="panel">
            <div className="panel-header">
              <h2>Frequency Analysis</h2>
            </div>

            <ZoomPanBar
              freqMin={freqRange.min}
              freqMax={freqRange.max}
              visMin={visFreq.min}
              visMax={visFreq.max}
              onVisChange={handleVisChange}
              isAudiogram={isAudiogram}
              onToggleAudiogram={() => setIsAudiogram((p) => !p)}
              disableAudiogram={isEcg}
            />

            <div className="graph-grid" style={{ marginTop: 12 }}>
              {fftData && (
                <FftGraph
                  freqs={fftData.freqs}
                  inputMag={fftData.inputMag}
                  outputMag={fftData.outputMag}
                  isAudiogram={isAudiogram}
                  bands={bands}
                  minFreq={visFreq.min}
                  maxFreq={visFreq.max}
                  label="Input / Output FFT"
                />
              )}
            </div>
          </div>

          {/* Spectrograms */}
          {showSpectrograms && (
            <div className="panel">
              <div className="panel-header">
                <h2>Spectrograms</h2>
                <button type="button" onClick={() => setShowSpectrograms(false)}>Hide</button>
              </div>
              <div className="spectrogram-grid">
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
                    label="Output"
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;