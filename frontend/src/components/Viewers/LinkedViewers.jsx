import { useState } from 'react';
import CineViewer from './CineViewer';

/**
 * LinkedViewers - Renders two synchronized CineViewer instances
 * 
 * Owns shared viewState. Any pan/zoom on either viewer updates both.
 */
export default function LinkedViewers({ inputSignal, outputSignal, sampleRate }) {
  const [viewState, setViewState] = useState({ offsetSamples: 0, zoom: 1 });

  return (
    <div className="linked-viewers">
      <h3>Waveforms (Input vs Output)</h3>
      <div className="viewer-grid">
        <CineViewer
          signal={inputSignal}
          sampleRate={sampleRate}
          label="Input"
          viewState={viewState}
          onViewChange={setViewState}
        />
        <CineViewer
          signal={outputSignal}
          sampleRate={sampleRate}
          label="Output (Equalized)"
          viewState={viewState}
          onViewChange={setViewState}
        />
      </div>
    </div>
  );
}
