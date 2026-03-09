import { useEffect, useRef, useState } from 'react';

const CANVAS_HEIGHT = 220;
const PAD = { top: 20, right: 16, bottom: 36, left: 48 };
const DB_MIN = -90;
const DB_MAX = 0;

/**
 * FftGraph - FFT magnitude plot
 * Zoom/pan is driven externally via minFreq / maxFreq props.
 * No internal interaction — controlled entirely from App.
 */
function FftGraph({ freqs, inputMag, outputMag, isAudiogram, bands = [], label, minFreq, maxFreq }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

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
    } else window.addEventListener('resize', updateWidth);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !inputMag || !outputMag || freqs.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvasWidth;
    const H = CANVAS_HEIGHT;

    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    // Visible frequency window
    const viewMin = minFreq ?? (isAudiogram ? 20 : 0);
    const viewMax = maxFreq ?? Math.max(...freqs);

    const toX = (freq) => {
      if (isAudiogram) {
        const safeMin = Math.max(viewMin, 1);
        const safeMax = Math.max(viewMax, 2);
        return PAD.left + (Math.log2(Math.max(freq, safeMin) / safeMin) / Math.log2(safeMax / safeMin)) * plotW;
      }
      return PAD.left + ((freq - viewMin) / (viewMax - viewMin)) * plotW;
    };

    const toY = (mag) => {
      const db = 20 * Math.log10(Math.max(mag, 1e-9));
      const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
      return PAD.top + plotH - ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;
    };

    // ── Y grid + labels ───────────────────────────────────────────────────
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    [-80, -60, -40, -20, 0].forEach((db) => {
      const y = PAD.top + plotH - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;
      ctx.strokeStyle = '#1e293b'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${db}`, PAD.left - 4, y + 3.5);
    });

    ctx.save();
    ctx.translate(10, PAD.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = '#475569'; ctx.font = '10px monospace';
    ctx.fillText('dB', 0, 0);
    ctx.restore();

    // ── X grid + labels ───────────────────────────────────────────────────
    const audiogramFreqs = [20, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000];
    const linearStep = (viewMax - viewMin) / 8;
    const xTicks = isAudiogram
      ? audiogramFreqs.filter((f) => f >= viewMin * 0.95 && f <= viewMax * 1.05)
      : Array.from({ length: 9 }, (_, i) => viewMin + linearStep * i);

    ctx.font = '10px monospace'; ctx.textAlign = 'center';
    xTicks.forEach((f) => {
      const x = toX(f);
      if (x < PAD.left - 1 || x > PAD.left + plotW + 1) return;
      ctx.strokeStyle = '#1e293b'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.fillText(f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`, x, PAD.top + plotH + 14);
    });

    ctx.fillStyle = '#475569'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Hz', PAD.left + plotW / 2, H - 2);

    // ── Band shading ──────────────────────────────────────────────────────
    const bandColors = [
      'rgba(59,130,246,0.12)', 'rgba(251,191,36,0.12)', 'rgba(34,197,94,0.12)',
      'rgba(239,68,68,0.12)',  'rgba(168,85,247,0.12)', 'rgba(16,185,129,0.12)',
      'rgba(244,63,94,0.12)',
    ];
    bands.forEach((band, i) => {
      const x1 = Math.max(toX(band.min_hz), PAD.left);
      const x2 = Math.min(toX(band.max_hz), PAD.left + plotW);
      if (x2 <= x1) return;
      ctx.fillStyle = bandColors[i % bandColors.length];
      ctx.fillRect(x1, PAD.top, x2 - x1, plotH);
      ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.textAlign = 'center';
      ctx.fillText(band.label || '', (x1 + x2) / 2, PAD.top + 13);
    });

    // ── Signal lines (clipped) ────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.left, PAD.top, plotW, plotH); ctx.clip();

    const drawLine = (magArr, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < freqs.length; i++) {
        const x = toX(freqs[i]);
        const y = toY(magArr[i]);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(inputMag, '#60a5fa');
    drawLine(outputMag, '#fb923c');
    ctx.restore();

    // ── Border ────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

  }, [freqs, inputMag, outputMag, isAudiogram, bands, canvasWidth, minFreq, maxFreq]);

  if (!freqs || !inputMag || !outputMag || freqs.length === 0) {
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        {label && <h4 style={{ margin: '0 0 6px 0', color: '#94a3b8' }}>{label}</h4>}
        <div style={{ color: '#64748b', padding: 16 }}>No FFT data available.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {label && <h4 style={{ margin: '0 0 6px 0', color: '#e2e8f0', fontSize: 13 }}>{label}</h4>}
      <div style={{ width: '100%', height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: `${CANVAS_HEIGHT}px`, display: 'block' }} />
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12, color: '#94a3b8', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 18, height: 2.5, background: '#60a5fa', display: 'inline-block', borderRadius: 2 }} />
          Input
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 18, height: 2.5, background: '#fb923c', display: 'inline-block', borderRadius: 2 }} />
          Output
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
          {isAudiogram ? 'Log (Audiogram) scale' : 'Linear scale'}
        </span>
      </div>
    </div>
  );
}

export default FftGraph;