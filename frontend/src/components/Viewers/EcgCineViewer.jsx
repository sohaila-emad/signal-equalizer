import { useEffect, useRef, useState } from 'react';

/**
 * EcgCineViewer - Specialized CineViewer for ECG signals (not audio)
 * - Handles playback and navigation for ECG data, not sound.
 * - UI and controls match CineViewer for consistency.
 *
 * Props:
 * - signal: Float32Array of samples
 * - sampleRate: Sample rate in Hz (for time axis, not audio)
 * - label: Display label
 * - viewState: { offsetSamples, zoom }
 * - onViewChange: Callback when view changes
 */

export default function EcgCineViewer({ signal, sampleRate, label, viewState, onViewChange }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const playStartRef = useRef(0);
  const playOffsetRef = useRef(0);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(1);

  // Keep playbackSpeedRef in sync with state
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  const { offsetSamples = 0, zoom = 1 } = viewState || {};
  // Show ~2.5 seconds worth of samples by default, regardless of total length
  const defaultWindowSamples = Math.round(sampleRate * 2.5);
  const baseWindowSize = signal ? Math.min(defaultWindowSamples, signal.length) : 250;
  const windowSize = Math.floor(baseWindowSize / zoom);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !signal || signal.length === 0) return;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const parentWidth = canvas.parentElement?.clientWidth || 1200;
      const height = 240;
      const dpr = window.devicePixelRatio || 1;
      const width = Math.floor(parentWidth);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);
      const maxStart = Math.max(0, signal.length - windowSize);
      const start = Math.max(0, Math.min(offsetSamples, maxStart));
      const end = Math.min(signal.length, start + windowSize);
      const view = signal.slice(start, end);
      const viewLen = view.length;
      if (viewLen > 0) {
        const midY = height / 2;
        const amp = midY * 0.9;
        const xScale = width / Math.max(1, windowSize - 1);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < viewLen; i++) {
          const x = i * xScale;
          const v = view[i] ?? 0;
          const y = midY - v * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();
    };
    draw();
    const handleResize = () => { draw(); };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [signal, offsetSamples, windowSize]);

  const stopPlayback = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setIsPlaying(false);
    isPlayingRef.current = false;
    // Update playOffsetRef so resume works from the right place
    playOffsetRef.current = offsetSamples;
  };

  // ECG playback: animate playhead visually, not audio
  const play = () => {
    if (!signal || signal.length === 0) return;
    // Prevent multiple playbacks
    stopPlayback();
    setIsPlaying(true);
    isPlayingRef.current = true;
    playStartRef.current = performance.now();
    // Always start from the current offset
    playOffsetRef.current = offsetSamples;
    const animate = () => {
      if (!isPlayingRef.current) return;
      const elapsed = (performance.now() - playStartRef.current) / 1000 * playbackSpeedRef.current;
      let currentSample = Math.floor(playOffsetRef.current + elapsed * sampleRate);
      if (currentSample >= signal.length) {
        currentSample = signal.length - 1;
        setIsPlaying(false);
        isPlayingRef.current = false;
        // Snap window to end
        onViewChange({ offsetSamples: Math.max(0, signal.length - windowSize), zoom });
        return;
      }
      // Center window on playhead
      const halfWindow = Math.floor(windowSize / 2);
      const newOffset = Math.max(0, Math.min(currentSample - halfWindow, Math.max(0, signal.length - windowSize)));
      onViewChange({ offsetSamples: newOffset, zoom });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
  };

  const handleZoomIn = () => {
    // minZoom = show entire signal at once
    const minZoom = baseWindowSize / Math.max(1, signal?.length || baseWindowSize);
    const maxZoom = 100;
    const newZoom = Math.min(maxZoom, zoom * 2);
    onViewChange({ offsetSamples, zoom: Math.max(minZoom, newZoom) });
  };
  const handleZoomOut = () => {
    // minZoom = show entire signal at once
    const minZoom = baseWindowSize / Math.max(1, signal?.length || baseWindowSize);
    const newZoom = zoom / 2;
    onViewChange({ offsetSamples, zoom: Math.max(minZoom, newZoom) });
  };
  const handlePanLeft = () => {
    const step = Math.max(1, Math.floor(Math.min(windowSize, signal?.length || windowSize) * 0.1));
    const newOffset = Math.max(0, offsetSamples - step);
    onViewChange({ offsetSamples: newOffset, zoom });
  };
  const handlePanRight = () => {
    const step = Math.max(1, Math.floor(Math.min(windowSize, signal?.length || windowSize) * 0.1));
    const maxOffset = signal ? Math.max(0, signal.length - windowSize) : 0;
    const newOffset = Math.min(maxOffset, offsetSamples + step);
    onViewChange({ offsetSamples: newOffset, zoom });
  };
  const handleReset = () => {
    stopPlayback();
    onViewChange({ offsetSamples: 0, zoom: 1 });
  };

  return (
    <div className="cine-viewer">
      <h4>{label}</h4>
      <canvas ref={canvasRef} className="waveform-canvas" />
      <div className="controls">
        <button type="button" onClick={play} disabled={isPlaying}>
          Play
        </button>
        <button type="button" onClick={stopPlayback} disabled={!isPlaying}>
          Pause
        </button>
        <button type="button" onClick={handleReset}>
          Reset
        </button>
        <label>
          Speed:
          <select
            value={playbackSpeed}
            onChange={e => {
              const val = parseFloat(e.target.value);
              setPlaybackSpeed(val);
              playbackSpeedRef.current = val;
              // Reset play start so speed change is immediate
              playStartRef.current = performance.now();
              playOffsetRef.current = offsetSamples;
            }}
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="2">2x</option>
          </select>
        </label>
        <button type="button" onClick={handleZoomIn}>
          Zoom In
        </button>
        <button type="button" onClick={handleZoomOut}>
          Zoom Out
        </button>
        <button type="button" onClick={handlePanLeft}>
          ← Pan
        </button>
        <button type="button" onClick={handlePanRight}>
          Pan →
        </button>
      </div>
    </div>
  );
}