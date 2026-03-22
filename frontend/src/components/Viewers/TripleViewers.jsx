import CineViewer from './CineViewer';
import EcgCineViewer from './EcgCineViewer';
import EcgBandViewer from '../ECG/EcgBandViewer';
import './TripleViewers.css';

/**
 * TripleViewers: Shows input, FFT output, and Wavelet output signals side by side.
 * NOW FULLY LINKED: All three share the same viewState for pan/zoom/playback sync.
 */
export default function TripleViewers({
  inputSignal,
  fftOutput,
  waveletOutput,
  aiOutput,
  showAi,
  sampleRate,
  viewState,
  setViewState,
  isEcgMode = false,
  ecgBandSignals = null,
  ecgWeights = null,
}) {
  // This handler ensures that if one viewer changes (zoom/pan/play), 
  // they ALL update simultaneously.
  const handleSharedViewChange = (newView) => {
    setViewState(newView);
  };

  const Viewer = isEcgMode ? EcgCineViewer : CineViewer;

  return (
    <>
    <div className="triple-viewers-stack">
      <Viewer
        signal={inputSignal}
        sampleRate={sampleRate}
        viewState={viewState}
        onViewChange={handleSharedViewChange}
        label={isEcgMode ? 'ECG Input' : 'Input Signal'}
      />
      <Viewer
        signal={fftOutput}
        sampleRate={sampleRate}
        viewState={viewState}
        onViewChange={handleSharedViewChange}
        label={isEcgMode ? 'ECG FFT Output' : 'FFT Output'}
      />
      {waveletOutput && (
        <Viewer
          signal={waveletOutput}
          sampleRate={sampleRate}
          viewState={viewState}
          onViewChange={handleSharedViewChange}
          label={isEcgMode ? 'ECG Wavelet Output' : 'Wavelet Output'}
        />
      )}
      {aiOutput && (
        isEcgMode ? (
          <EcgCineViewer
            signal={aiOutput}
            sampleRate={sampleRate}
            viewState={viewState}
            onViewChange={handleSharedViewChange}
            label="ECG AI Output"
          />
        ) : (
          showAi && (
            <CineViewer
              signal={aiOutput}
              sampleRate={sampleRate}
              viewState={viewState}
              onViewChange={handleSharedViewChange}
              label="Musical AI (HTDemucs)"
            />
          )
        )
      )}
    </div>

    {isEcgMode && ecgBandSignals && (
      <EcgBandViewer
        bandSignals={ecgBandSignals}
        weights={ecgWeights || {}}
        sampleRate={sampleRate}
      />
    )}
    </>
  );
}