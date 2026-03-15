import { useEffect, useRef, useState } from 'react';

const PAD = { top: 16, right: 16, bottom: 36, left: 52 };
const CANVAS_HEIGHT = 220;

/**
 * Spectrogram - Canvas heatmap
 * Zoom/pan on BOTH axes is driven externally via props from App.
 * No internal interaction.
 *
 * Props:
 *   freqs    – frequency array (rows)
 *   times    – time array (cols)
 *   data     – 2D float array [freqIdx][timeIdx] in dB
 *   label    – title
 *   minFreq  – visible freq lower bound
 *   maxFreq  – visible freq upper bound
 *   minTime  – visible time lower bound
 *   maxTime  – visible time upper bound
 */
export default function Spectrogram({ freqs, times, data, label, minFreq, maxFreq, minTime, maxTime }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const node = containerRef.current;
    const update = () => {
      const w = node.getBoundingClientRect().width;
      if (w > 0) setCanvasWidth(Math.floor(w));
    };
    update();
    let ro;
    if (window.ResizeObserver) { ro = new ResizeObserver(update); ro.observe(node); }
    else window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !times || !data || data.length === 0) return;

    const rows = data.length;
    const cols = data[0]?.length || 0;
    if (rows === 0 || cols === 0) return;

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

    const LEGEND_W = 14;
    const plotW = W - PAD.left - PAD.right - LEGEND_W - 6;
    const plotH = H - PAD.top - PAD.bottom;

    // Freq bounds
    const freqMin = minFreq ?? freqs[0];
    const freqMax = maxFreq ?? freqs[freqs.length - 1];
    // Time bounds (Horizontal) driven by props
    const timeMin = minTime ?? times[0];
    const timeMax = maxTime ?? times[times.length - 1];

    // Global dB range for colormap
    let globalMin = Infinity, globalMax = -Infinity;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = data[r][c];
        if (v < globalMin) globalMin = v;
        if (v > globalMax) globalMax = v;
      }
    const range = globalMax - globalMin || 1;

    // Viridis-inspired colormap
    const colorFor = (v) => {
      const t = Math.max(0, Math.min(1, (v - globalMin) / range));
      let r, g, b;
      if (t < 0.25) {
        const s = t / 0.25;
        r = Math.round(68 + s * (59 - 68)); g = Math.round(1 + s * (82 - 1)); b = Math.round(84 + s * (139 - 84));
      } else if (t < 0.5) {
        const s = (t - 0.25) / 0.25;
        r = Math.round(59 + s * (33 - 59)); g = Math.round(82 + s * (145 - 82)); b = Math.round(139 + s * (140 - 139));
      } else if (t < 0.75) {
        const s = (t - 0.5) / 0.25;
        r = Math.round(33 + s * (94 - 33)); g = Math.round(145 + s * (201 - 145)); b = Math.round(140 + s * (98 - 140));
      } else {
        const s = (t - 0.75) / 0.25;
        r = Math.round(94 + s * (253 - 94)); g = Math.round(201 + s * (231 - 201)); b = Math.round(98 + s * (37 - 98));
      }
      return [r, g, b];
    };

    // ── Build heatmap ─────────────────────────────────────────────────────
    const pw = Math.max(1, Math.round(plotW));
    const ph = Math.max(1, Math.round(plotH));
    const offscreen = document.createElement('canvas');
    offscreen.width = pw; offscreen.height = ph;
    const offCtx = offscreen.getContext('2d');
    const imgData = offCtx.createImageData(pw, ph);

    for (let py = 0; py < ph; py++) {
      const freqFrac = 1 - py / (ph - 1);
      const targetFreq = freqMin + freqFrac * (freqMax - freqMin);
      let freqIdx = 0, bestFDist = Infinity;
      for (let r = 0; r < rows; r++) {
        const d = Math.abs(freqs[r] - targetFreq);
        if (d < bestFDist) { bestFDist = d; freqIdx = r; }
      }
      
      for (let px = 0; px < pw; px++) {
        const timeFrac = px / (pw - 1);
        // Map targetTime to the visible window, not the whole array
        const targetTime = timeMin + timeFrac * (timeMax - timeMin);
        
        // Find the index in the 'times' array that matches this targetTime
        let timeIdx = 0;
        const totalDuration = times[times.length - 1] - times[0];
        const timeStep = totalDuration / (times.length - 1);
        timeIdx = Math.round((targetTime - times[0]) / timeStep);

        const v = data[freqIdx]?.[timeIdx] ?? globalMin;
        const [R, G, B] = colorFor(v);
        const idx = (py * pw + px) * 4;
        imgData.data[idx] = R; imgData.data[idx+1] = G; imgData.data[idx+2] = B; imgData.data[idx+3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, PAD.left, PAD.top, plotW, plotH);

    // ── Y-axis: frequency ─────────────────────────────────────────────────
    const freqSpan = freqMax - freqMin;
    const rawStep = freqSpan / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const niceSteps = [1, 2, 2.5, 5, 10];
    const niceStep = niceSteps.map((s) => s * mag).find((s) => freqSpan / s <= 7) || rawStep;
    const freqTicks = [];
    for (let f = Math.ceil(freqMin / niceStep) * niceStep; f <= freqMax + 1e-6; f += niceStep) freqTicks.push(f);

    ctx.font = '10px monospace'; ctx.textAlign = 'right';
    freqTicks.forEach((f) => {
      const frac = (f - freqMin) / (freqMax - freqMin);
      const y = PAD.top + plotH - frac * plotH;
      if (y < PAD.top - 2 || y > PAD.top + plotH + 2) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.fillText(f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`, PAD.left - 4, y + 3.5);
    });

    ctx.save();
    ctx.translate(11, PAD.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = '#475569'; ctx.font = '10px monospace';
    ctx.fillText('Hz', 0, 0);
    ctx.restore();

    // ── X-axis: time ──────────────────────────────────────────────────────
    const timeSpan = timeMax - timeMin;
    const tRawStep = timeSpan / 6;
    const tMag = Math.pow(10, Math.floor(Math.log10(tRawStep || 1)));
    const tNiceStep = niceSteps.map((s) => s * tMag).find((s) => timeSpan / s <= 8) || tRawStep;
    const timeTicks = [];
    for (let t = Math.ceil(timeMin / tNiceStep) * tNiceStep; t <= timeMax + 1e-9; t += tNiceStep) timeTicks.push(t);

    ctx.font = '10px monospace'; ctx.textAlign = 'center';
    timeTicks.forEach((t) => {
      const frac = (t - timeMin) / (timeMax - timeMin);
      const x = PAD.left + frac * plotW;
      if (x < PAD.left - 2 || x > PAD.left + plotW + 2) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.fillText(`${t.toFixed(2)}s`, x, PAD.top + plotH + 14);
    });

    ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; ctx.font = '10px monospace';
    ctx.fillText('Time (s)', PAD.left + plotW / 2, H - 2);

    // ── Border ────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

    // ── Legend bar ────────────────────────────────────────────────────────
    const legendX = PAD.left + plotW + 6;
    for (let i = 0; i < plotH; i++) {
      const t = 1 - i / (plotH - 1);
      const [R, G, B] = colorFor(globalMin + t * range);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(legendX, PAD.top + i, LEGEND_W, 1);
    }
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
    ctx.strokeRect(legendX, PAD.top, LEGEND_W, plotH);
    ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#64748b';
    ctx.fillText(`${Math.round(globalMax)}`, legendX + LEGEND_W + 2, PAD.top + 8);
    ctx.fillText('dB',                       legendX + LEGEND_W + 2, PAD.top + plotH / 2 + 4);
    ctx.fillText(`${Math.round(globalMin)}`, legendX + LEGEND_W + 2, PAD.top + plotH);

  }, [freqs, times, data, minFreq, maxFreq, minTime, maxTime, canvasWidth]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {label && <h4 style={{ margin: '0 0 6px 0', color: '#e2e8f0', fontSize: 13 }}>{label}</h4>}
      <div style={{ width: '100%', height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: `${CANVAS_HEIGHT}px`, display: 'block' }} />
      </div>
    </div>
  );
}