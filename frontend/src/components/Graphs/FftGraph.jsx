import { useEffect, useRef, useState } from 'react';

const CANVAS_HEIGHT = 200;

/**
 * FftGraph - Plots FFT magnitude vs frequency
 * Fixed height to avoid infinite resize loop.
 * Overlays input (blue) and output (orange) on same canvas.
 * Supports linear and audiogram (log) scale.
 */
function FftGraph({ freqs, inputMag, outputMag, isAudiogram, bands = [], label }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  // Only observe width — never height
  useEffect(() => {
    if (!containerRef.current) return;
    const node = containerRef.current;
    const updateWidth = () => {
      const w = node.getBoundingClientRect().width;
      if (w > 0) setCanvasWidth(Math.floor(w));
    };
    updateWidth();
    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(updateWidth);
      ro.observe(node);
    } else {
      window.addEventListener('resize', updateWidth);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !inputMag || !outputMag || freqs.length === 0) return;

    const W = canvasWidth;
    const H = CANVAS_HEIGHT;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);

    const maxF = Math.max(...freqs);
    const minF = isAudiogram ? 20 : 0;

    const toX = (freq) => {
      if (isAudiogram) {
        const f = Math.max(freq, minF);
        return (Math.log2(f / minF) / Math.log2(maxF / minF)) * W;
      }
      return (freq / maxF) * W;
    };

    // Normalize magnitude to dB, map to Y
    const toY = (mag) => {
      const db = 20 * Math.log10(mag + 1e-6);
      const normalized = Math.max(0, Math.min(1, (db + 100) / 100));
      return H - normalized * H * 0.9;
    };

    // Band shading
    const bandColors = [
      'rgba(59,130,246,0.15)',
      'rgba(251,191,36,0.15)',
      'rgba(34,197,94,0.15)',
      'rgba(239,68,68,0.15)',
      'rgba(168,85,247,0.15)',
      'rgba(16,185,129,0.15)',
      'rgba(244,63,94,0.15)',
    ];
    bands.forEach((band, i) => {
      const x1 = toX(band.min_hz);
      const x2 = toX(band.max_hz);
      ctx.fillStyle = bandColors[i % bandColors.length];
      ctx.fillRect(x1, 0, x2 - x1, H);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(band.label || '', (x1 + x2) / 2, 14);
    });

    // Audiogram grid lines
    if (isAudiogram) {
      const gridFreqs = [125, 250, 500, 1000, 2000, 4000, 8000];
      ctx.strokeStyle = '#334155';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      gridFreqs.forEach((f) => {
        if (f <= maxF) {
          const x = toX(f);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
          ctx.fillStyle = '#64748b';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${f >= 1000 ? f / 1000 + 'k' : f}`, x, H - 4);
        }
      });
      ctx.setLineDash([]);
    }

    // Draw input FFT — blue
    const drawLine = (magArr, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = toX(freqs[i]);
        const y = toY(magArr[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(inputMag, '#60a5fa');  // blue
    drawLine(outputMag, '#fbbf24'); // orange

  }, [freqs, inputMag, outputMag, isAudiogram, bands, canvasWidth]);

  if (!freqs || !inputMag || !outputMag || freqs.length === 0) {
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <h4>{label}</h4>
        <div style={{ color: '#888', padding: 16 }}>No FFT data available.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {label && <h4 style={{ margin: '0 0 6px 0' }}>{label}</h4>}

      {/* Fixed height wrapper — this breaks the infinite loop */}
      <div style={{ width: '100%', height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${CANVAS_HEIGHT}px`, display: 'block' }}
        />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 3, background: '#60a5fa', display: 'inline-block' }} />
          Input
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 3, background: '#fbbf24', display: 'inline-block' }} />
          Output
        </span>
      </div>

      {/* Axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        <span>Frequency (Hz)</span>
        <span>{isAudiogram ? 'Audiogram (Log scale)' : 'Linear scale'} — Magnitude (dB)</span>
      </div>
    </div>
  );
}

export default FftGraph;