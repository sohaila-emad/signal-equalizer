import CineViewer from './CineViewer';
import './TripleViewers.css';

/**
 * TripleViewers: Shows input, FFT output, and Wavelet output signals side by side.
 * All three share the same viewState for pan/zoom/playback sync.
 * Props:
 *   - inputSignal: Float32Array
 *   - fftOutput:   Float32Array
 *   - waveletOutput: Float32Array
 *   - sampleRate: number
 *   - viewState: object
 *   - setViewState: function
 */
import { useState } from 'react';

export default function TripleViewers({
  inputSignal,
  fftOutput,
  waveletOutput,
  sampleRate,
}) {
  // Each viewer gets its own viewState for independent pan/zoom/playback
  const [inputView, setInputView] = useState({});
  const [fftView, setFftView] = useState({});
  const [waveletView, setWaveletView] = useState({});

  return (
    <div className="triple-viewers-stack">
      <CineViewer
        signal={inputSignal}
        sampleRate={sampleRate}
        viewState={inputView}
        onViewChange={setInputView}
        label="Input Signal"
      />
      <CineViewer
        signal={fftOutput}
        sampleRate={sampleRate}
        viewState={fftView}
        onViewChange={setFftView}
        label="FFT Output"
      />
      <CineViewer
        signal={waveletOutput}
        sampleRate={sampleRate}
        viewState={waveletView}
        onViewChange={setWaveletView}
        label="Wavelet Output"
      />
    </div>
  );
}
