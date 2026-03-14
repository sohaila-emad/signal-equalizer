import CineViewer from './CineViewer';
import './TripleViewers.css';

/**
 * TripleViewers: Shows input, FFT output, and Wavelet output signals side by side.
 * NOW FULLY LINKED: All three share the same viewState for pan/zoom/playback sync.
 */
export default function TripleViewers({
  inputSignal,
  fftOutput,
  waveletOutput,
  sampleRate,
  viewState,    // <--- Use the prop from App.js
  setViewState  // <--- Use the prop from App.js
}) {
  
  // This handler ensures that if one viewer changes (zoom/pan/play), 
  // they ALL update simultaneously.
  const handleSharedViewChange = (newView) => {
    setViewState(newView);
  };

  return (
    <div className="triple-viewers-stack">
      <CineViewer
        signal={inputSignal}
        sampleRate={sampleRate}
        viewState={viewState}
        onViewChange={handleSharedViewChange}
        label="Input Signal"
      />
      
      <CineViewer
        signal={fftOutput}
        sampleRate={sampleRate}
        viewState={viewState}
        onViewChange={handleSharedViewChange}
        label="FFT Output"
      />
      
      {/* Only render Wavelet viewer if the signal exists */}
      {waveletOutput && (
        <CineViewer
          signal={waveletOutput}
          sampleRate={sampleRate}
          viewState={viewState}
          onViewChange={handleSharedViewChange}
          label="Wavelet Output"
        />
      )}
    </div>
  );
}