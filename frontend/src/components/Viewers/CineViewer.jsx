import { useEffect, useRef, useState } from 'react';

/**
 * CineViewer - Reusable canvas waveform viewer with playback controls
 * 
 * Props:
 * - signal: Float32Array of samples
 * - sampleRate: Sample rate in Hz
 * - label: Display label
 * - viewState: { offsetSamples, zoom }
 * - onViewChange: Callback when view changes
 */
export default function CineViewer({ signal, sampleRate, label, viewState, onViewChange }) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(0);
  const startTimeRef = useRef(0);
  const startOffsetRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const { offsetSamples = 0, zoom = 1 } = viewState || {};

  // Calculate window size based on zoom
  const baseWindowSize = 6000;
  const windowSize = Math.floor(baseWindowSize / zoom);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !signal || signal.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = 600;
    const height = 120;
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    // Clamp offset to valid range
    const start = Math.max(0, Math.min(offsetSamples, Math.max(0, signal.length - 1)));
    const end = Math.min(signal.length, start + windowSize);
    const view = signal.slice(start, end);

    const midY = height / 2;
    const step = Math.max(1, Math.floor(view.length / width));
    const amp = midY * 0.9;

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const i = x * step;
      const v = view[i] ?? 0;
      const y = midY - v * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw playhead
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
  }, [signal, offsetSamples, windowSize]);

  const stopPlayback = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // ignore
      }
      sourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const play = () => {
    if (!signal || signal.length === 0) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;

    stopPlayback();

    const buffer = ctx.createBuffer(1, signal.length, sampleRate);
    buffer.getChannelData(0).set(signal);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackSpeed;
    source.connect(ctx.destination);

    const clampedOffset = Math.max(0, Math.min(offsetSamples, signal.length - 1));
    const offsetSec = clampedOffset / sampleRate;

    source.start(0, offsetSec);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    startOffsetRef.current = clampedOffset;
    setIsPlaying(true);

    source.onended = () => {
      setIsPlaying(false);
      sourceRef.current = null;
    };

    const updateProgress = () => {
      if (!sourceRef.current) return;
      const elapsed = (ctx.currentTime - startTimeRef.current) * playbackSpeed;
      const currentSample = Math.floor(startOffsetRef.current + elapsed * sampleRate);
      if (currentSample < signal.length) {
        onViewChange({ offsetSamples: currentSample, zoom });
        rafRef.current = requestAnimationFrame(updateProgress);
      } else {
        setIsPlaying(false);
        sourceRef.current = null;
        onViewChange({ offsetSamples: 0, zoom });
      }
    };
    rafRef.current = requestAnimationFrame(updateProgress);
  };

  const handleZoomIn = () => {
    const newZoom = Math.min(zoom * 2, 100);
    onViewChange({ offsetSamples, zoom: newZoom });
  };

  const handleZoomOut = () => {
    const maxZoomOut = signal ? signal.length / baseWindowSize : 1;
    const newZoom = Math.max(zoom / 2, 1 / maxZoomOut);
    onViewChange({ offsetSamples, zoom: newZoom });
  };

  const handlePanLeft = () => {
    const step = Math.floor(windowSize * 0.1);
    const newOffset = Math.max(0, offsetSamples - step);
    onViewChange({ offsetSamples: newOffset, zoom });
  };

  const handlePanRight = () => {
    const step = Math.floor(windowSize * 0.1);
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
          <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}>
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
