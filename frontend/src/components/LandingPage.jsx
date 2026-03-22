import { useEffect, useRef, useState } from 'react';

/* ── Animated oscilloscope canvas ── */
function OscilloscopeCanvas() {
  const canvasRef = useRef(null);
  const frameRef  = useRef(null);
  const timeRef   = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    const draw = () => {
      timeRef.current += 0.012;
      const t = timeRef.current;
      const w = W(), h = H();

      ctx.clearRect(0, 0, w, h);

      // faint grid
      ctx.strokeStyle = 'rgba(0,212,160,0.05)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < w; x += 44) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += 44) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const drawWave = (alpha, freq, amp, phase, lineW) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(0,212,160,${alpha})`;
        ctx.lineWidth = lineW;
        for (let px = 0; px < w; px++) {
          const x = px / w;
          const y =
            Math.sin(x * freq * Math.PI * 2 + t + phase) * amp +
            Math.sin(x * freq * 1.7 * Math.PI * 2 + t * 0.8 + phase) * (amp * 0.4) +
            Math.sin(x * freq * 3.1 * Math.PI * 2 + t * 1.3 + phase) * (amp * 0.2);
          const py = h / 2 + y;
          px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      };

      drawWave(0.08, 2, h * 0.28, 0,    0.8);
      drawWave(0.14, 3, h * 0.20, 1.2,  1.0);
      drawWave(0.35, 4, h * 0.14, 2.5,  1.8);
      drawWave(0.70, 5, h * 0.10, 0.8,  2.5);

      // centre line
      ctx.strokeStyle = 'rgba(0,212,160,0.08)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      ctx.setLineDash([]);

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

/* ── EQ Bar visualizer decoration ── */
function EqBars({ count = 28, color = 'var(--accent)' }) {
  const [heights, setHeights] = useState(() => Array.from({ length: count }, () => Math.random()));
  useEffect(() => {
    const id = setInterval(() => {
      setHeights(prev => prev.map(h => {
        const delta = (Math.random() - 0.5) * 0.25;
        return Math.max(0.08, Math.min(1, h + delta));
      }));
    }, 90);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 48 }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          width: 3,
          height: `${h * 100}%`,
          background: color,
          borderRadius: 2,
          opacity: 0.4 + h * 0.6,
          transition: 'height 0.09s ease',
          flexShrink: 0,
        }} />
      ))}
    </div>
  );
}

/* ── Feature card ── */
function FeatureCard({ icon, title, desc, accent }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#0f1827' : '#0a1020',
        border: `1px solid ${hovered ? accent + '40' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12,
        padding: '22px 20px',
        transition: 'all 0.2s ease',
        cursor: 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: hovered ? accent : 'transparent',
        transition: 'background 0.2s ease',
      }} />
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: accent + '18',
        border: `1px solid ${accent}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14, color: accent,
      }}>
        {icon}
      </div>
      <div style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: '#cbd5e1', fontWeight: 500, marginBottom: 8,
      }}>{title}</div>
      <div style={{ fontSize: 13, color: '#4a6280', lineHeight: 1.7 }}>{desc}</div>
    </div>
  );
}

/* ── Mode pill ── */
function ModePill({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 14px',
        borderRadius: 99,
        border: active ? '1px solid rgba(0,212,160,0.4)' : '1px solid rgba(255,255,255,0.08)',
        background: active ? 'rgba(0,212,160,0.1)' : 'rgba(255,255,255,0.02)',
        color: active ? '#00d4a0' : '#4a6280',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11, letterSpacing: '0.08em',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

const MODES = [
  { key: 'musical', label: 'Musical',     color: '#00d4a0', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg> },
  { key: 'animal',  label: 'Animal',      color: '#3d8bff', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg> },
  { key: 'human',   label: 'Human Voice', color: '#a78bfa', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg> },
  { key: 'ecg',     label: 'ECG',         color: '#f87171', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { key: 'generic', label: 'Generic',     color: '#f5a623', icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M8 12h8M6 18h12"/></svg> },
];

export default function LandingPage({ onEnter }) {
  const [activeMode, setActiveMode] = useState('musical');
  const [entered, setEntered] = useState(false);

  const handleEnter = () => {
    setEntered(true);
    setTimeout(onEnter, 420);
  };

  const currentMode = MODES.find(m => m.key === activeMode);

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      position: 'relative',
      background: '#07090f',
      color: '#d8e4f0',
      fontFamily: "'Outfit', sans-serif",
      overflowX: 'hidden',
      opacity: entered ? 0 : 1,
      transform: entered ? 'scale(1.02)' : 'scale(1)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
    }}>

      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: 56,
        background: 'rgba(7,9,15,0.8)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#00d4a0',
            boxShadow: '0 0 10px rgba(0,212,160,0.6)',
            animation: 'lp-pulse 3s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#d8e4f0', fontWeight: 500,
          }}>Equalizer</span>
          <span style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9, letterSpacing: '0.12em', color: '#3d4f66',
          }}>Signal Processing Studio</span>
        </div>
        <button
          onClick={handleEnter}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 18px', borderRadius: 6,
            border: '1px solid rgba(0,212,160,0.3)',
            background: 'rgba(0,212,160,0.08)',
            color: '#00d4a0',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,160,0.15)'; e.currentTarget.style.borderColor = 'rgba(0,212,160,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,160,0.08)'; e.currentTarget.style.borderColor = 'rgba(0,212,160,0.3)'; }}
        >
          Open App
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '80px 24px 60px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* oscilloscope bg */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <OscilloscopeCanvas />
        </div>

        {/* radial glow */}
        <div style={{
          position: 'absolute',
          width: 700, height: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,212,160,0.07) 0%, transparent 70%)',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: 680 }}>

          {/* badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            border: '1px solid rgba(0,212,160,0.25)',
            background: 'rgba(0,212,160,0.06)',
            borderRadius: 99, padding: '5px 16px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#00d4a0', marginBottom: 36,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00d4a0', animation: 'lp-pulse 2s ease-in-out infinite' }} />
            Full-Stack Audio DSP Platform
          </div>

          {/* title */}
          <h1 style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 'clamp(3rem, 9vw, 6rem)',
            lineHeight: 1.0, fontWeight: 500,
            letterSpacing: '-0.02em', margin: '0 0 24px',
          }}>
            <span style={{ color: '#3d4f66' }}>Audio</span>
            <br />
            <span style={{ color: '#00d4a0' }}>Equalizer</span>
          </h1>

          {/* subtitle */}
          <p style={{
            fontSize: 15, color: '#4a6280', lineHeight: 1.8,
            maxWidth: 460, margin: '0 auto 40px',
          }}>
            Process WAV files through FFT-domain equalization, wavelet
            decomposition, and AI-assisted analysis — all in real-time with
            synchronized visualization.
          </p>

          {/* EQ bars decoration */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
            <EqBars count={32} color="#00d4a0" />
          </div>

          {/* CTA row */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleEnter}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9,
                padding: '14px 36px', borderRadius: 8,
                background: '#00d4a0', color: '#020e0a',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase',
                border: 'none', cursor: 'pointer',
                boxShadow: '0 0 40px rgba(0,212,160,0.3)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#00f0b8'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 0 56px rgba(0,212,160,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#00d4a0'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(0,212,160,0.3)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Launch App
            </button>
            <a
              href="https://github.com/sohaila-emad/signal-equalizer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '14px 28px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: '#7a8faa',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                textDecoration: 'none', cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#d8e4f0'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#7a8faa'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
              View Source
            </a>
          </div>

          <p style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, color: '#2d3f55', letterSpacing: '0.06em',
            marginTop: 24,
          }}>
            WAV · Mono &amp; Stereo · 11 kHz · NumPy FFT · React 19 · Flask
          </p>
        </div>
      </section>

      {/* ── MODES SECTION ── */}
      <section style={{ padding: '80px 24px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#00d4a0', marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
            Equalization Modes
            <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
          </div>
          <h2 style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
            fontWeight: 500, letterSpacing: '-0.02em',
            margin: '0 0 12px', color: '#d8e4f0',
          }}>Five modes. One pipeline.</h2>
          <p style={{ color: '#4a6280', fontSize: 14, lineHeight: 1.7 }}>
            Switch between purpose-built presets or define your own custom frequency bands.
          </p>
        </div>

        {/* Mode selector pills */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 28 }}>
          {MODES.map(m => (
            <ModePill
              key={m.key}
              label={m.label}
              icon={<span style={{ color: m.color }}>{m.icon}</span>}
              active={activeMode === m.key}
              onClick={() => setActiveMode(m.key)}
            />
          ))}
        </div>

        {/* Mode display card */}
        <div style={{
          background: '#0a1020',
          border: `1px solid ${currentMode.color}25`,
          borderRadius: 14,
          padding: '28px 28px 20px',
          transition: 'border-color 0.3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 7,
              background: currentMode.color + '18',
              border: `1px solid ${currentMode.color}35`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: currentMode.color,
            }}>
              {currentMode.icon}
            </div>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: currentMode.color,
            }}>
              {currentMode.label} Mode
            </div>
            <div style={{
              marginLeft: 'auto',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9, letterSpacing: '0.1em',
              color: currentMode.key === 'generic' ? '#f5a623' : '#3d4f66',
              background: currentMode.key === 'generic' ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${currentMode.key === 'generic' ? 'rgba(245,166,35,0.25)' : 'rgba(255,255,255,0.06)'}`,
              padding: '2px 8px', borderRadius: 3,
            }}>
              {currentMode.key === 'generic' ? 'CUSTOM' : 'PRESET'}
            </div>
          </div>

          {/* fake sliders */}
          {activeMode !== 'generic' && (
            <ModeSliders mode={activeMode} color={currentMode.color} />
          )}
          {activeMode === 'generic' && (
            <GenericBandEditor color={currentMode.color} />
          )}
        </div>
      </section>

      {/* ── FEATURES GRID ── */}
      <section style={{ padding: '40px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#00d4a0', marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
            Capabilities
            <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
          </div>
          <h2 style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
            fontWeight: 500, letterSpacing: '-0.02em',
            margin: 0, color: '#d8e4f0',
          }}>What's inside</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <FeatureCard
            accent="#00d4a0"
            title="Real-time EQ"
            desc="Every slider adjustment triggers immediate FFT reprocessing. No submit buttons — output updates instantly."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M8 12h8M6 18h12"/></svg>}
          />
          <FeatureCard
            accent="#3d8bff"
            title="Dual Waveforms"
            desc="Input and output viewers scroll and zoom in sync. Pan by dragging, zoom to individual samples."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12h3l3-8 4 16 3-8h3"/></svg>}
          />
          <FeatureCard
            accent="#a78bfa"
            title="FFT + Spectrogram"
            desc="Toggle linear or dB audiogram scale. Sliding-window STFT with Hanning window for time-frequency analysis."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18M7 16l4-8 4 8"/></svg>}
          />
          <FeatureCard
            accent="#f87171"
            title="ECG & AI Mode"
            desc="Electrocardiogram band analysis with abnormality detection. AI-assisted equalization for musical content."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
          />
          <FeatureCard
            accent="#f5a623"
            title="Wavelet Pipeline"
            desc="Dual processing: FFT-domain equalization runs alongside configurable wavelet decomposition (db4, db6, sym4, haar)."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 12 Q17 4 12 12 Q7 20 2 12"/></svg>}
          />
          <FeatureCard
            accent="#34d399"
            title="Voice & Animal Sep."
            desc="Source separation in Human Voice mode. Animal sound isolation with customizable queries in Animal mode."
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>}
          />
        </div>
      </section>

      {/* ── PIPELINE ── */}
      <section style={{
        padding: '60px 24px 80px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: '#080b12',
      }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: '#00d4a0', marginBottom: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
              DSP Pipeline
              <div style={{ width: 20, height: 1, background: '#00d4a0' }} />
            </div>
            <h2 style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
              fontWeight: 500, letterSpacing: '-0.02em',
              margin: 0, color: '#d8e4f0',
            }}>NumPy FFT under the hood</h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '4px 0' }}>
            {[
              { n: '01', name: 'Audio Load', detail: 'librosa · 11 kHz · mono', color: '#00d4a0' },
              { n: '02', name: 'FFT',         detail: 'np.fft.rfft', color: '#3d8bff' },
              { n: '03', name: 'Band EQ',     detail: 'multiply bins × gain', color: '#a78bfa' },
              { n: '04', name: 'iFFT',        detail: 'np.fft.irfft', color: '#f5a623' },
              { n: '05', name: 'Spectrogram', detail: 'STFT + Hanning window', color: '#34d399' },
            ].map((step, i, arr) => (
              <div key={step.n} style={{ display: 'flex', alignItems: 'center', flex: i < arr.length - 1 ? '1 0 auto' : 'none' }}>
                <div style={{
                  background: '#0a1020',
                  border: `1px solid ${step.color}30`,
                  borderRadius: 10,
                  padding: '16px 18px',
                  minWidth: 130,
                  flexShrink: 0,
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: step.color,
                  }} />
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9, color: step.color, letterSpacing: '0.1em', marginBottom: 5,
                  }}>{step.n}</div>
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12, color: '#d8e4f0', fontWeight: 500, marginBottom: 3,
                  }}>{step.name}</div>
                  <div style={{ fontSize: 11, color: '#3d4f66', lineHeight: 1.4 }}>{step.detail}</div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 4px', minWidth: 16 }} />
                )}
              </div>
            ))}
          </div>

          {/* tech pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 40, justifyContent: 'center' }}>
            {['NumPy FFT', 'librosa', 'Flask', 'Flask-CORS', 'React 19', 'Vite', 'Plotly.js', 'scipy', 'PyWavelets', 'MIT License'].map(t => (
              <span key={t} style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10, letterSpacing: '0.06em',
                padding: '4px 10px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.02)',
                color: '#3d4f66',
              }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER CTA ── */}
      <section style={{
        padding: '80px 24px',
        textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,212,160,0.06) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
            <EqBars count={20} color="#00d4a0" />
          </div>
          <h2 style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 'clamp(1.4rem, 4vw, 2rem)',
            fontWeight: 500, letterSpacing: '-0.01em',
            margin: '0 0 12px', color: '#d8e4f0',
          }}>Ready to process?</h2>
          <p style={{ color: '#4a6280', fontSize: 14, marginBottom: 32 }}>
            Upload a WAV file and start equalizing in seconds.
          </p>
          <button
            onClick={handleEnter}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              padding: '14px 40px', borderRadius: 8,
              background: '#00d4a0', color: '#020e0a',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 0 40px rgba(0,212,160,0.25)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#00f0b8'; e.currentTarget.style.boxShadow = '0 0 56px rgba(0,212,160,0.45)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#00d4a0'; e.currentTarget.style.boxShadow = '0 0 40px rgba(0,212,160,0.25)'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Launch App
          </button>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: '1px solid rgba(255,255,255,0.05)',
        padding: '24px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00d4a0' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#3d4f66', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Equalizer · Signal Processing Studio
          </span>
        </div>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#2d3f55' }}>
          React · Flask · NumPy · MIT License
        </span>
      </footer>

      <style>{`
        @keyframes lp-pulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.7); }
        }
      `}</style>
    </div>
  );
}

/* ── Animated sliders for mode preview ── */
function ModeSliders({ mode, color }) {
  const configs = {
    musical: [
      { label: 'Sub-Bass', hz: '20–60', val: 0.7 },
      { label: 'Bass',     hz: '60–250', val: 1.4 },
      { label: 'Low Mid',  hz: '250–500', val: 1.0 },
      { label: 'Mids',     hz: '500–2k', val: 1.2 },
      { label: 'High Mid', hz: '2k–4k',  val: 0.9 },
      { label: 'Treble',   hz: '4k–8k',  val: 1.7 },
      { label: 'Brilliance', hz: '8k+',  val: 1.1 },
    ],
    animal: [
      { label: 'Infrasound', hz: '<20Hz',   val: 0.3 },
      { label: 'Human',      hz: '20–20k',  val: 1.0 },
      { label: 'Dog',        hz: '40–65k',  val: 1.5 },
      { label: 'Cat',        hz: '45–79k',  val: 1.3 },
      { label: 'Bat',        hz: '20k+',    val: 0.8 },
    ],
    human: [
      { label: 'Sub-vocal', hz: '<80Hz',    val: 0.4 },
      { label: 'Low Voice', hz: '80–300',   val: 1.0 },
      { label: 'Speech',    hz: '300–3k',   val: 1.6 },
      { label: 'Presence',  hz: '3k–8k',    val: 1.2 },
      { label: 'Air',       hz: '8k+',      val: 0.6 },
    ],
    ecg: [
      { label: 'Wander',   hz: '0.05–0.5', val: 0.2 },
      { label: 'QRS',      hz: '0.5–40',   val: 1.5 },
      { label: 'HF Noise', hz: '40–150',   val: 0.1 },
      { label: 'EMG',      hz: '>150',      val: 0.0 },
    ],
  };
  const bands = configs[mode] || configs.musical;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
      {bands.map(b => (
        <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 56 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: color }}>{b.val.toFixed(1)}×</span>
          <div style={{ height: 80, width: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${b.val / 2 * 100}%`, background: color, borderRadius: 2, opacity: 0.85 }} />
            <div style={{ position: 'absolute', width: 14, height: 4, background: '#d8e4f0', borderRadius: 2, left: -5, bottom: `${b.val / 2 * 100}%`, transform: 'translateY(50%)' }} />
          </div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: '#3d4f66', textAlign: 'center', maxWidth: 60, lineHeight: 1.3 }}>{b.label}</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: '#2a3a50', textAlign: 'center' }}>{b.hz}</span>
        </div>
      ))}
    </div>
  );
}

function GenericBandEditor({ color }) {
  const bands = [
    { min: 0,    max: 250,  label: 'Sub-bass', gain: 1.5 },
    { min: 250,  max: 1000, label: 'Bass',     gain: 1.0 },
    { min: 1000, max: 5512, label: 'Highs',    gain: 0.6 },
  ];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 70px 1fr 60px', gap: 6, marginBottom: 8 }}>
        {['MIN Hz', 'MAX Hz', 'LABEL', 'GAIN'].map(h => (
          <span key={h} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.1em', color: '#3d4f66' }}>{h}</span>
        ))}
      </div>
      {bands.map(b => (
        <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '70px 70px 1fr 60px', gap: 6, marginBottom: 7, alignItems: 'center' }}>
          {[b.min, b.max].map((v, i) => (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 5, padding: '4px 7px',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#7a8faa',
            }}>{v}</div>
          ))}
          <div style={{
            background: `${color}10`, border: `1px solid ${color}30`,
            borderRadius: 5, padding: '4px 7px',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: color,
          }}>{b.label}</div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: b.gain < 1 ? '#f87171' : '#34d399' }}>{b.gain.toFixed(1)}×</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        {['+ ADD BAND', 'SAVE CONFIG', 'LOAD CONFIG'].map(label => (
          <button key={label} style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.08em',
            padding: '5px 10px', borderRadius: 4,
            background: label === '+ ADD BAND' ? `${color}12` : 'transparent',
            border: `1px solid ${label === '+ ADD BAND' ? color + '30' : 'rgba(255,255,255,0.07)'}`,
            color: label === '+ ADD BAND' ? color : '#3d4f66',
            cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>
    </div>
  );
}