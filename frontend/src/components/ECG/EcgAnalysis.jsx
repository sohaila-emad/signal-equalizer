import { useState, useRef, useEffect } from 'react';
import { analyzeEcg } from '../../services/api';
import { calculateBPM } from '../../utils';

const LEAD_OPTIONS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'Combined'];

const CLASS_COLORS = {
  NORM: '#4caf50',
  MI:   '#f44336',
  STTC: '#ff9800',
  CD:   '#2196f3',
};

export default function EcgAnalysis({ setEcgAnalysis }) {
  const [heaFile,      setHeaFile]      = useState(null);
  const [datFile,      setDatFile]      = useState(null);
  const [result,       setResult]       = useState(null);
  const [selectedLead, setSelectedLead] = useState('II');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [canvasWidth,  setCanvasWidth]  = useState(600);

  const containerRef = useRef(null);
  const canvasRef    = useRef(null);

  /* ── Observe container width ── */
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setCanvasWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* ── Render canvas ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    // Dark background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    const gradcam  = result.gradcam; // 1000 values
    const leadData = selectedLead === 'Combined'
      ? result.leads['II']
      : result.leads[selectedLead];

    // Draw Grad-CAM as vertical coloured strips
    for (let x = 0; x < W; x++) {
      const idx   = Math.min(Math.floor(x * 1000 / W), 999);
      const value = gradcam[idx];
      const hue   = (1 - value) * 240;
      ctx.fillStyle = `hsl(${hue}, 80%, 40%)`;
      ctx.fillRect(x, 0, 1, H);
    }

    // Draw ECG waveform
    if (leadData && leadData.length > 0) {
      let min = Infinity, max = -Infinity;
      for (const v of leadData) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min || 1;
      const pad = 10;

      ctx.beginPath();
      ctx.strokeStyle  = '#00ff88';
      ctx.lineWidth    = 1.5;
      ctx.shadowColor  = 'rgba(0,255,136,0.35)';
      ctx.shadowBlur   = 3;

      for (let x = 0; x < W; x++) {
        const si  = Math.min(Math.floor(x * leadData.length / W), leadData.length - 1);
        const val = leadData[si];
        const y   = H - pad - ((val - min) / range) * (H - 2 * pad);
        if (x === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [result, selectedLead, canvasWidth]);

  /* ── Handlers ── */
  const handleAnalyze = async () => {
    console.log('Analyze clicked, heaFile:', heaFile, 'datFile:', datFile);
    if (!heaFile || !datFile) return;
    if (!heaFile.name.endsWith('.hea')) {
      setError('First file must be a .hea file');
      return;
    }
    if (!datFile.name.endsWith('.dat')) {
      setError('Second file must be a .dat file');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await analyzeEcg(heaFile, datFile);
      console.log('API response:', data);
      setResult(data);
      console.log('Result state set (staged):', data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('Result state updated:', result);
    if (!result) {
      if (typeof setEcgAnalysis === 'function') setEcgAnalysis({ bpm: null, type: null });
      return;
    }

    try {
      const leadKey = selectedLead === 'Combined' ? 'II' : selectedLead;
      const leadSignal = result.leads?.[leadKey] || null;
      const sampleRate = result.sample_rate || 250;
      if (leadSignal && typeof setEcgAnalysis === 'function') {
        const analysis = calculateBPM(new Float32Array(leadSignal), sampleRate);
        setEcgAnalysis(analysis || { bpm: null, type: null });
      }
    } catch (e) {
      console.warn('Failed to compute BPM from result:', e);
      if (typeof setEcgAnalysis === 'function') setEcgAnalysis({ bpm: null, type: null });
    }
  }, [result, selectedLead]);

  const isValidHea = heaFile && heaFile.name.toLowerCase().endsWith('.hea');
  const isValidDat = datFile && datFile.name.toLowerCase().endsWith('.dat');
  const canAnalyze = !!(isValidHea && isValidDat && !loading);

  return (
    <div className="section-card">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </span>
          <span className="section-title">ECG AI Analysis · ECGNet</span>
        </div>
      </div>

      <div className="section-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── File upload row ── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="ecg-upload-slot">
              <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
                Header file (.hea)
                <input
                  type="file"
                  accept=".hea"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    if (f && !f.name.toLowerCase().endsWith('.hea')) {
                      setError('Selected header file must have .hea extension');
                      setHeaFile(null);
                    } else {
                      setError(null);
                      setHeaFile(f);
                    }
                  }}
                  style={{ display: 'block', marginTop: 4 }}
                />
              </label>
              {heaFile && <span className="file-chip" style={{ marginTop: 6 }}>{heaFile.name} ✓</span>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="ecg-upload-slot">
              <label style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500 }}>
                Data file (.dat)
                <input
                  type="file"
                  accept=".dat"
                  onChange={e => {
                    const f = e.target.files?.[0] || null;
                    if (f && !f.name.toLowerCase().endsWith('.dat')) {
                      setError('Selected data file must have .dat extension');
                      setDatFile(null);
                    } else {
                      setError(null);
                      setDatFile(f);
                    }
                  }}
                  style={{ display: 'block', marginTop: 4 }}
                />
              </label>
              {datFile && <span className="file-chip" style={{ marginTop: 6 }}>{datFile.name} ✓</span>}
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            style={{ opacity: canAnalyze ? 1 : 0.45 }}
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="error-card" style={{ margin: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
            </svg>
            {error}
            <button className="error-dismiss" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="loading-card">
            <div className="eq-bars">
              {[...Array(7)].map((_, i) => <div key={i} className="eq-bar" />)}
            </div>
            <div className="loading-text">Running ECGNet inference…</div>
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <>
            {/* Classification panel */}
            <div style={{
              background: 'var(--surface-2, #161b22)',
              border:     '1px solid var(--border)',
              borderRadius: 8,
              padding: '14px 18px',
            }}>
              <div style={{ marginBottom: 12, fontSize: 15, fontWeight: 600 }}>
                Predicted:&nbsp;
                <span style={{ color: CLASS_COLORS[result.predicted_class] ?? 'var(--accent)', fontSize: 18 }}>
                  {result.predicted_class}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 13, marginLeft: 8 }}>
                  ({(result.probabilities[result.predicted_class] * 100).toFixed(1)}% confidence)
                </span>
              </div>

              {Object.entries(result.probabilities).map(([cls, prob]) => (
                <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 36, fontSize: 12, fontWeight: 600, color: CLASS_COLORS[cls] ?? 'inherit' }}>
                    {cls}
                  </span>
                  <div style={{
                    flex: 1,
                    height: 8,
                    background: 'var(--surface-3, #21262d)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${(prob * 100).toFixed(1)}%`,
                      height: '100%',
                      background: CLASS_COLORS[cls] ?? 'var(--accent)',
                      borderRadius: 4,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <span style={{ width: 40, fontSize: 12, textAlign: 'right', color: 'var(--text-dim)' }}>
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>

            {/* Lead selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Lead:</span>
              <select
                value={selectedLead}
                onChange={e => setSelectedLead(e.target.value)}
                style={{ fontSize: 13 }}
              >
                {LEAD_OPTIONS.map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 4 }}>
                Red&nbsp;=&nbsp;high attention&nbsp;·&nbsp;Blue&nbsp;=&nbsp;low
              </span>
            </div>

            {/* Waveform + Grad-CAM canvas */}
            <div ref={containerRef} style={{ width: '100%' }}>
              <canvas
                ref={canvasRef}
                width={canvasWidth}
                height={200}
                style={{
                  display: 'block',
                  width:   '100%',
                  height:  200,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
