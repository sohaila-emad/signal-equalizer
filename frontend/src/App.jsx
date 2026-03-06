import { useState, useEffect, useRef } from 'react';
import './App.css';
import Header from './components/Layout/Header';
import ModeSelector from './components/Layout/ModeSelector';
import FileUploader from './components/Layout/FileUploader';
import SliderPanel from './components/Equalizer/SliderPanel';
import LinkedViewers from './components/Viewers/LinkedViewers';
import FftGraph from './components/Graphs/FftGraph';
import Spectrogram from './components/Graphs/Spectrogram';
import { uploadAndTransform } from './services/api';

function App() {
  // Core state
  const [file, setFile] = useState(null);
  const [currentMode, setCurrentMode] = useState('generic');
  const [bands, setBands] = useState([]);
  const [weights, setWeights] = useState({});

  // Result state
  const [inputSignal, setInputSignal] = useState(null);
  const [outputSignal, setOutputSignal] = useState(null);
  const [inputSpectrogram, setInputSpectrogram] = useState(null);
  const [outputSpectrogram, setOutputSpectrogram] = useState(null);
  const [fftData, setFftData] = useState(null);
  const [sampleRate, setSampleRate] = useState(11025);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSpectrograms, setShowSpectrograms] = useState(true);
  const [isAudiogram, setIsAudiogram] = useState(false);

  // Listen for bandsLoadedFromConfig event to trigger uploadAndTransform
  useEffect(() => {
    const handler = (e) => {
      if (!file) return;
      // Use current weights, mode, and loaded bands
      processSignalWithBands(e.detail);
    };
    window.addEventListener('bandsLoadedFromConfig', handler);
    return () => window.removeEventListener('bandsLoadedFromConfig', handler);
  }, [file, currentMode, weights]);

  const processSignalWithBands = async (bandsArg) => {
    try {
      setLoading(true);
      setError(null);
      const finalWeights = { ...weights };
      if (currentMode === 'generic') {
        bandsArg.forEach((band) => {
          if (band.id) {
            finalWeights[band.id] = (band.scale === null || band.scale === undefined) ? 1 : band.scale;
          }
        });
      }
      const result = await uploadAndTransform(file, currentMode, finalWeights, bandsArg);
      setInputSignal(new Float32Array(result.input_audio));
      setOutputSignal(new Float32Array(result.output_audio));
      setSampleRate(result.sample_rate);
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
    } catch (err) {
      console.error('Processing error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  // Process signal whenever file, mode, bands, or weights change
  // Debounce for uploadAndTransform on band/slider changes
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (!file) return;

    const processSignal = async () => {
      try {
        setLoading(true);
        setError(null);

        // Build weights from bands for generic mode
        const finalWeights = { ...weights };
        if (currentMode === 'generic') {
          bands.forEach((band) => {
            if (band.id) {
              finalWeights[band.id] = (band.scale === null || band.scale === undefined) ? 1 : band.scale;
            }
          });
        }

        const result = await uploadAndTransform(file, currentMode, finalWeights, bands);

        // Update all state from result
        setInputSignal(new Float32Array(result.input_audio));
        setOutputSignal(new Float32Array(result.output_audio));
        setSampleRate(result.sample_rate);

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
      } catch (err) {
        console.error('Processing error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    // Only debounce for band/slider changes, not file upload
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      processSignal();
    }, 350);

    return () => clearTimeout(debounceTimer.current);
  }, [file, currentMode, bands, weights]);

  const handleFileSelect = (selectedFile) => {
    setFile(selectedFile);
  };

  const handleModeChange = (newMode) => {
    setCurrentMode(newMode);
    setWeights({});
    if (newMode === 'generic') {
      // Keep current bands for generic mode
    } else {
      // Bands will come from backend for other modes
      setBands([]);
    }
  };

  return (
    <div className="app">
      <Header />

      <div className="panel">
        <h2>Configuration</h2>
        <FileUploader onFileSelect={handleFileSelect} />
        <ModeSelector value={currentMode} onChange={handleModeChange} />
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

      {loading && (
        <div className="panel">
          <p>Processing...</p>
        </div>
      )}

      {error && (
        <div className="panel error">
          <p>Error: {error}</p>
        </div>
      )}

      {inputSignal && outputSignal && !loading && (
        <>
          <div className="panel">
            <LinkedViewers
              inputSignal={inputSignal}
              outputSignal={outputSignal}
              sampleRate={sampleRate}
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Frequency Analysis</h2>
              <button
                type="button"
                onClick={() => setIsAudiogram((prev) => !prev)}
              >
                Switch to {isAudiogram ? 'Linear Scale' : 'Audiogram Scale'}
              </button>
            </div>
            <div className="graph-grid">
              {fftData && (
                <FftGraph
                  freqs={fftData.freqs}
                  inputMag={fftData.inputMag}
                  outputMag={fftData.outputMag}
                  isAudiogram={isAudiogram}
                  bands={bands}
                  label="Input/Output FFT"
                />
              )}
            </div>
          </div>

          {showSpectrograms && (
            <div className="panel">
              <div className="panel-header">
                <h2>Spectrograms</h2>
                <button type="button" onClick={() => setShowSpectrograms(false)}>
                  Hide
                </button>
              </div>
              <div className="spectrogram-grid">
                {inputSpectrogram && (
                  <Spectrogram
                    freqs={inputSpectrogram.freqs}
                    times={inputSpectrogram.times}
                    data={inputSpectrogram.values}
                    label="Input"
                  />
                )}
                {outputSpectrogram && (
                  <Spectrogram
                    freqs={outputSpectrogram.freqs}
                    times={outputSpectrogram.times}
                    data={outputSpectrogram.values}
                    label="Output"
                  />
                )}
              </div>
            </div>
          )}

          {!showSpectrograms && (
            <div className="panel">
              <button type="button" onClick={() => setShowSpectrograms(true)}>
                Show Spectrograms
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
