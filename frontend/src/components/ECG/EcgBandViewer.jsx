/**
 * EcgBandViewer.jsx
 *
 * Shows the four ECG frequency bands as separate annotated waveform strips,
 * so the user can visually see what each slider controls:
 *
 *   NORM  (0.05–0.5 Hz)  — baseline wander / P-wave / T-wave DC drift
 *   MI    (0.5–4 Hz)     — ST elevation, T-wave morphology (slow changes)
 *   STTC  (4–15 Hz)      — repolarisation, QT prolongation (mid-freq)
 *   CD    (15–50 Hz)     — QRS notching, bundle branch detail (sharp edges)
 *
 * Each strip renders the band-isolated signal scaled to fill the strip height,
 * with a gain bar on the right showing the current slider value.
 * Strips with gain=0 are greyed out with a MUTED label.
 */

import { useRef, useEffect } from 'react';

const BAND_META = [
  {
    id:    'norm',
    label: 'NORM',
    hz:    '0.05 – 0.5 Hz',
    color: '#38bdf8',
    desc:  'Baseline wander · P-wave · T-wave DC',
  },
  {
    id:    'mi',
    label: 'MI',
    hz:    '0.5 – 4 Hz',
    color: '#f87171',
    desc:  'ST elevation · T-wave morphology',
  },
  {
    id:    'sttc',
    label: 'STTC',
    hz:    '4 – 15 Hz',
    color: '#fb923c',
    desc:  'Repolarisation · QT prolongation',
  },
  {
    id:    'cd',
    label: 'CD',
    hz:    '15 – 50 Hz',
    color: '#a78bfa',
    desc:  'QRS notching · Bundle branch detail',
  },
];

const STRIP_H  = 80;   // px per strip
const PAD_L    = 72;   // left label area
const PAD_R    = 48;   // right gain bar area
const PAD_V    = 8;    // vertical padding inside strip

function drawStrip(canvas, signal, meta, gain, totalW) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W   = totalW;
  const H   = STRIP_H;

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const hex = meta.color;
  const r   = parseInt(hex.slice(1,3), 16);
  const g   = parseInt(hex.slice(3,5), 16);
  const b   = parseInt(hex.slice(5,7), 16);

  const muted = gain < 0.01;

  // Background
  ctx.fillStyle = muted ? '#0a0a12' : `rgba(${r},${g},${b},0.04)`;
  ctx.fillRect(0, 0, W, H);

  // Bottom border
  ctx.strokeStyle = `rgba(${r},${g},${b},0.2)`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, H - 0.5);
  ctx.lineTo(W, H - 0.5);
  ctx.stroke();

  // Left label block
  ctx.fillStyle = `rgba(${r},${g},${b},${muted ? 0.2 : 0.9})`;
  ctx.font      = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(meta.label, 6, 20);

  ctx.fillStyle = `rgba(${r},${g},${b},${muted ? 0.15 : 0.5})`;
  ctx.font      = '9px monospace';
  ctx.fillText(meta.hz, 6, 33);

  // Gain bar (right side)
  const barH    = H - 10;
  const barFill = Math.max(0, Math.min(1, gain / 2)) * barH;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(W - PAD_R + 6, 5, 12, barH);
  ctx.fillStyle = muted
    ? 'rgba(100,100,120,0.3)'
    : `rgba(${r},${g},${b},0.75)`;
  ctx.fillRect(W - PAD_R + 6, 5 + barH - barFill, 12, barFill);

  // Gain text
  ctx.fillStyle = muted ? 'rgba(120,120,140,0.5)' : `rgba(${r},${g},${b},0.8)`;
  ctx.font      = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${gain.toFixed(1)}×`, W - PAD_R + 12, H - 2);

  if (muted) {
    // Muted label
    ctx.fillStyle = 'rgba(120,120,140,0.4)';
    ctx.font      = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MUTED', PAD_L + (W - PAD_L - PAD_R) / 2, H / 2 + 4);

    // Flat line
    ctx.strokeStyle = 'rgba(120,120,140,0.2)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, H / 2);
    ctx.lineTo(W - PAD_R, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (!signal || signal.length === 0) return;

  // Waveform — scale to fill strip height using THIS band's own min/max
  // so the shape is always visible regardless of absolute amplitude
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - 2 * PAD_V;

  let vMin =  Infinity;
  let vMax = -Infinity;
  for (const v of signal) {
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const range = vMax - vMin || 1e-6;

  // Zero line (where v=0 sits in this normalised view)
  const zeroY = PAD_V + (1 - (-vMin) / range) * innerH;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.15)`;
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(PAD_L, zeroY);
  ctx.lineTo(W - PAD_R, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw waveform — apply gain visually too (scale around zero)
  const displayGain = gain;   // mirror the slider value in the visual amplitude
  ctx.beginPath();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = `rgba(${r},${g},${b},0.4)`;
  ctx.shadowBlur  = 3;

  const N = signal.length;
  for (let x = 0; x < innerW; x++) {
    const si  = Math.min(Math.floor((x / innerW) * N), N - 1);
    const v   = signal[si] * displayGain;
    // Rescale: v is in original units; rescale using original range but with gain
    const vScaled = ((v - vMin * displayGain) / (range * displayGain));
    const y       = PAD_V + (1 - vScaled) * innerH;
    const cx      = PAD_L + x;
    x === 0 ? ctx.moveTo(cx, y) : ctx.lineTo(cx, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Amplitude label (peak-to-peak in original signal)
  const pp = vMax - vMin;
  ctx.fillStyle = `rgba(${r},${g},${b},0.45)`;
  ctx.font      = '9px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${(pp * 1000).toFixed(1)} µV p-p`, W - PAD_R - 2, H - 3);
}


export default function EcgBandViewer({ bandSignals, weights, sampleRate }) {
  const canvasRefs = useRef({});
  const wrapRef    = useRef(null);

  useEffect(() => {
    if (!bandSignals || !wrapRef.current) return;
    const W = wrapRef.current.clientWidth || 700;

    for (const meta of BAND_META) {
      const canvas = canvasRefs.current[meta.id];
      if (!canvas) continue;
      const signal = bandSignals[meta.id] ?? null;
      const gain   = parseFloat(weights?.[meta.id] ?? weights?.[meta.id.toUpperCase()] ?? 1.0);
      drawStrip(canvas, signal, meta, gain, W);
    }
  }, [bandSignals, weights, sampleRate]);

  if (!bandSignals) return null;

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>
          ECG Band Decomposition
        </span>
        <span style={styles.subtitle}>
          Each strip shows only that band's frequency content · gain mirrors slider
        </span>
      </div>

      <div ref={wrapRef} style={styles.strips}>
        {BAND_META.map(meta => (
          <div key={meta.id} style={styles.stripWrap}>
            <canvas
              ref={el => { canvasRefs.current[meta.id] = el; }}
              style={{ display: 'block', width: '100%' }}
            />
            <div style={{ ...styles.descBar, color: meta.color + '80' }}>
              {meta.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  root: {
    background:   '#07090f',
    border:       '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding:      '12px 0 4px',
    marginTop:    12,
  },
  header: {
    display:        'flex',
    alignItems:     'baseline',
    gap:            12,
    padding:        '0 14px 10px',
    flexWrap:       'wrap',
  },
  title: {
    fontSize:     12,
    fontWeight:   700,
    color:        'rgba(200,220,255,0.7)',
    fontFamily:   'monospace',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize:  10,
    color:     'rgba(140,160,190,0.45)',
    fontFamily: 'monospace',
  },
  strips: {
    width: '100%',
  },
  stripWrap: {
    width: '100%',
  },
  descBar: {
    fontSize:   9,
    fontFamily: 'monospace',
    padding:    '1px 72px 4px',
    opacity:    0.8,
  },
};