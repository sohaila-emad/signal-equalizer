import { useEffect, useRef, useState } from 'react';

const CANVAS_HEIGHT = 220;
const PAD = { top: 20, right: 16, bottom: 36, left: 48 };
const DB_MIN = -90;
const DB_MAX = 0;

/**
 * FftGraph — FFT magnitude plot
 * - Zoom/pan driven by minFreq / maxFreq props
 * - Band labels use a stagger algorithm so they never overlap
 */
function FftGraph({ freqs, inputMag, outputMag, isAudiogram, bands = [], label, minFreq, maxFreq }) {
  const canvasRef    = useRef(null);
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
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, W, H);

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const viewMin = minFreq ?? (isAudiogram ? 20 : 0);
    const viewMax = maxFreq ?? Math.max(...freqs);

    const toX = (freq) => {
      if (isAudiogram) {
        const logMin = Math.log10(Math.max(1, minFreq));
        const logMax = Math.log10(Math.max(1, maxFreq));
        const logCurr = Math.log10(Math.max(1, freq));
        return PAD.left + ((logCurr - logMin) / (logMax - logMin)) * plotW;
        } else {
          // Linear scale (Standard)
        return PAD.left + ((freq - minFreq) / (maxFreq - minFreq)) * plotW;
      }
    };

    const toY = (mag) => {
      const db = 20 * Math.log10(Math.max(mag, 1e-9));
      const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
      return PAD.top + plotH - ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;
    };

    // ── Y grid + labels ──────────────────────────────────────────────────
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    [-80, -60, -40, -20, 0].forEach((db) => {
      const y = PAD.top + plotH - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * plotH;
      ctx.strokeStyle = '#1a2235'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#3d4f66';
      ctx.fillText(`${db}`, PAD.left - 4, y + 3.5);
    });
    ctx.save();
    ctx.translate(10, PAD.top + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillStyle = '#2e3d55'; ctx.font = '10px monospace';
    ctx.fillText('dB', 0, 0);
    ctx.restore();

    // ── X grid + labels ──────────────────────────────────────────────────
    const audiogramFreqs = [20, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000];
    const linearStep = (viewMax - viewMin) / 8;
    const xTicks = isAudiogram
      ? audiogramFreqs.filter((f) => f >= viewMin * 0.95 && f <= viewMax * 1.05)
      : Array.from({ length: 9 }, (_, i) => viewMin + linearStep * i);

    ctx.font = '10px monospace'; ctx.textAlign = 'center';
    xTicks.forEach((f) => {
      const x = toX(f);
      if (x < PAD.left - 1 || x > PAD.left + plotW + 1) return;
      ctx.strokeStyle = '#1a2235'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#3d4f66';
      ctx.fillText(f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${Math.round(f)}`, x, PAD.top + plotH + 14);
    });
    ctx.fillStyle = '#2e3d55'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Hz', PAD.left + plotW / 2, H - 2);

    // ── Band shading ─────────────────────────────────────────────────────
    const bandColors = [
      [59, 130, 246],
      [251, 191, 36],
      [34, 197, 94],
      [239, 68, 68],
      [168, 85, 247],
      [16, 185, 129],
      [244, 63, 94],
    ];

    // Collect visible band rects (clamped to plot area)
    const visibleBands = bands.map((band, i) => {
      // Support multi-range bands — shade each range, label at first range center
      const ranges = band.ranges?.length > 0
        ? band.ranges
        : [{ min_hz: band.min_hz, max_hz: band.max_hz }];

      const [r, g, b] = bandColors[i % bandColors.length];
      ranges.forEach((range) => {
        const x1 = Math.max(toX(range.min_hz), PAD.left);
        const x2 = Math.min(toX(range.max_hz), PAD.left + plotW);
        if (x2 <= x1) return;
        ctx.fillStyle = `rgba(${r},${g},${b},0.1)`;
        ctx.fillRect(x1, PAD.top, x2 - x1, plotH);
        // Vertical border lines for each range
        ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
        ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, PAD.top); ctx.lineTo(x1, PAD.top + plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, PAD.top); ctx.lineTo(x2, PAD.top + plotH); ctx.stroke();
      });

      // Label x = center of first visible range
      const firstRange = ranges[0];
      const lx1 = Math.max(toX(firstRange.min_hz), PAD.left);
      const lx2 = Math.min(toX(firstRange.max_hz), PAD.left + plotW);
      const centerX = (lx1 + lx2) / 2;

      return { band, centerX, color: [r, g, b], visible: lx2 > lx1 };
    }).filter((b) => b.visible);

    // ── STAGGERED LABEL PLACEMENT ────────────────────────────────────────
    // Measure each label width, then assign to rows greedily to avoid overlap
    const FONT_SIZE    = 10;
    const LABEL_PAD    = 6;   // horizontal padding between labels
    const ROW_H        = 14;  // pixels per row
    const MAX_ROWS     = 4;
    const ROW_BASE_Y   = PAD.top + 12; // top of first row

    ctx.font = `${FONT_SIZE}px monospace`;

    // Each row tracks the rightmost used x so far
    const rowRight = new Array(MAX_ROWS).fill(PAD.left - 999);

    const labelPlacements = visibleBands.map(({ band, centerX, color }) => {
      const text  = band.label || '';
      const tw    = ctx.measureText(text).width;
      const halfW = tw / 2;
      const lLeft  = centerX - halfW - 2;
      const lRight = centerX + halfW + 2;

      // Find lowest row where this label fits
      let chosenRow = -1;
      for (let row = 0; row < MAX_ROWS; row++) {
        if (rowRight[row] + LABEL_PAD <= lLeft) {
          chosenRow = row;
          break;
        }
      }
      if (chosenRow === -1) chosenRow = MAX_ROWS - 1; // fallback: last row, accept overlap

      rowRight[chosenRow] = lRight;
      const y = ROW_BASE_Y + chosenRow * ROW_H;
      return { text, centerX, y, color, row: chosenRow };
    });

    // Draw connector tick from label to band top, then the label
    labelPlacements.forEach(({ text, centerX, y, color, row }) => {
      const [r, g, b] = color;

      // Tiny tick line connecting label baseline to PAD.top
      if (row > 0) {
        ctx.strokeStyle = `rgba(${r},${g},${b},0.35)`;
        ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(centerX, PAD.top);
        ctx.lineTo(centerX, y - FONT_SIZE);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Label background pill
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
      const pillX = centerX - tw / 2 - 4;
      const pillY = y - FONT_SIZE;
      const pillW = tw + 8;
      const pillH = FONT_SIZE + 4;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 3);
      ctx.fill();

      // Label text
      ctx.font = `${FONT_SIZE}px monospace`;
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.textAlign = 'center';
      ctx.fillText(text, centerX, y);
    });

    // ── Signal lines (clipped to plot) ───────────────────────────────────
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

    drawLine(inputMag, '#4d9fff');
    drawLine(outputMag, '#f5a623');
    ctx.restore();

    // ── Border ───────────────────────────────────────────────────────────
    ctx.strokeStyle = '#1e2d45'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(PAD.left, PAD.top, plotW, plotH);

  }, [freqs, inputMag, outputMag, isAudiogram, bands, canvasWidth, minFreq, maxFreq]);

  if (!freqs || !inputMag || !outputMag || freqs.length === 0) {
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        {label && <h4>{label}</h4>}
        <div style={{ color: 'var(--text-dim)', padding: 16, fontFamily: 'var(--mono)', fontSize: 11 }}>
          No FFT data available.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {label && <h4>{label}</h4>}
      <div className="canvas-bg" style={{ width: '100%', height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: `${CANVAS_HEIGHT}px`, display: 'block' }}
        />
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, alignItems: 'center', color: 'var(--text-mid)', fontFamily: 'var(--mono)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 18, height: 2, background: '#4d9fff', display: 'inline-block', borderRadius: 2 }} />
          Input
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 18, height: 2, background: '#f5a623', display: 'inline-block', borderRadius: 2 }} />
          Output
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>
          {isAudiogram ? 'Log (Audiogram)' : 'Linear scale'}
        </span>
      </div>
    </div>
  );
}

export default FftGraph;