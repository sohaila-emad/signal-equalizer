/**
 * frontend/src/components/Separation/VoiceSeparation.jsx
 */

import { useState, useRef, useCallback, useMemo } from "react";
import CineViewer from "../Viewers/CineViewer";
import { separateVoices, encodeWavBlob } from "../../services/api";

function Icon({ d, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── Resample helper for low sample rates ── */
function resampleArray(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const ratio = outputRate / inputRate;
  const newLength = Math.round(input.length * ratio);
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i / ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

function downloadSource(audio, sampleRate, idx, baseName, gain) {
  const scaled = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    scaled[i] = Math.max(-1, Math.min(1, audio[i] * gain));
  }
  const blob = encodeWavBlob(scaled, sampleRate);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${baseName}_voice_${idx}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Source card — gain slider + play/stop (gain controlled by parent) ── */
function SourceCard({ source, index, baseName, sampleRate, gain, onGainChange }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);

  const play = () => {
    if (!source.audio || source.audio.length === 0) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;

    stop();

    let playbackSignal = source.audio;
    let playbackRate = sampleRate;
    if (sampleRate < 3000) {
      playbackRate = 8000;
      playbackSignal = resampleArray(source.audio, sampleRate, playbackRate);
    }

    const buffer = ctx.createBuffer(1, playbackSignal.length, playbackRate);
    buffer.getChannelData(0).set(playbackSignal);

    const srcNode = ctx.createBufferSource();
    srcNode.buffer = buffer;

    const gNode = ctx.createGain();
    gNode.gain.value = gain;

    srcNode.connect(gNode);
    gNode.connect(ctx.destination);

    srcNode.start(0);
    sourceNodeRef.current = srcNode;
    gainNodeRef.current = gNode;
    setIsPlaying(true);

    srcNode.onended = () => {
      setIsPlaying(false);
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
    };
  };

  const stop = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch { /* ignore */ }
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleGainChange = (e) => {
    const v = parseFloat(e.target.value);
    onGainChange(v);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = v;
    }
  };

  return (
    <div className="vs-source-card">
      <div className="vs-source-header">
        <div className="vs-source-label">
          <div className="vs-source-dot" style={{ animationDelay: `${index * 0.18}s` }} />
          <span className="vs-source-title">Voice {index}</span>
          {source.peak_db !== undefined && (
            <span className="vs-source-meta">{source.peak_db} dB peak</span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary vs-dl-btn"
          onClick={() => downloadSource(source.audio, sampleRate, index, baseName, gain)}
          title={`Download voice ${index}`}
        >
          <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" size={12} />
          WAV
        </button>
      </div>

      <div className="vs-gain-row">
        <button
          type="button"
          className={`btn vs-play-btn ${isPlaying ? "btn-danger" : "btn-primary"}`}
          onClick={isPlaying ? stop : play}
        >
          {isPlaying ? (
            <>
              <Icon d="M6 4h4v16H6zM14 4h4v16h-4z" size={14} />
              Stop
            </>
          ) : (
            <>
              <Icon d="M5 3l14 9-14 9V3z" size={14} />
              Play
            </>
          )}
        </button>

        <div className="vs-gain-slider-group">
          <label className="vs-gain-label">Gain</label>
          <input
            type="range"
            className="vs-gain-slider"
            min="0"
            max="2"
            step="0.01"
            value={gain}
            onChange={handleGainChange}
          />
          <span className="vs-gain-value">{Math.round(gain * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ── Combined mix viewer — overlays all sources with gains, plays the mix ── */
function MixViewer({ sources, sampleRate, baseName }) {
  const [viewState, setViewState] = useState({ offsetSamples: 0, zoom: 1 });

  // sources is an array of { audio: Float32Array, gain: number }
  const mixedSignal = useMemo(() => {
    if (!sources || sources.length === 0) return null;
    const maxLen = Math.max(...sources.map((s) => s.audio.length));
    const mix = new Float32Array(maxLen);
    for (const { audio, gain } of sources) {
      for (let i = 0; i < audio.length; i++) {
        mix[i] += audio[i] * gain;
      }
    }
    // Clamp to [-1, 1]
    for (let i = 0; i < mix.length; i++) {
      mix[i] = Math.max(-1, Math.min(1, mix[i]));
    }
    return mix;
  }, [sources]);

  if (!mixedSignal) return null;

  const handleDownloadMix = () => {
    const blob = encodeWavBlob(mixedSignal, sampleRate);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${baseName}_mix.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vs-mix-viewer">
      <div className="vs-mix-header">
        <div className="vs-source-label">
          <div className="vs-source-dot" style={{ background: "#22c55e", boxShadow: "0 0 8px rgba(34,197,94,0.5)" }} />
          <span className="vs-source-title">Combined Mix</span>
        </div>
        <button
          type="button"
          className="btn btn-primary vs-dl-btn"
          onClick={handleDownloadMix}
          title="Download combined mix"
        >
          <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" size={12} />
          WAV
        </button>
      </div>
      <CineViewer
        label="Combined Mix"
        signal={mixedSignal}
        sampleRate={sampleRate}
        viewState={viewState}
        onViewChange={setViewState}
      />
    </div>
  );
}

/* ── Main component ── */
export default function VoiceSeparation({ file, disabled }) {
  const [status,  setStatus]  = useState("idle");
  const [result,  setResult]  = useState(null);
  const [errMsg,  setErrMsg]  = useState("");
  const [nSrcOpt, setNSrcOpt] = useState("auto");
  const [gains,   setGains]   = useState({});  // { sourceId: gainValue }
  const abortRef = useRef(null);

  const baseName = file ? file.name.replace(/\.wav$/i, "") : "output";

  const handleSeparate = useCallback(async () => {
    if (!file || status === "loading") return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus("loading");
    setResult(null);
    setErrMsg("");
    setGains({});

    try {
      const nSrc = nSrcOpt === "auto" ? null : parseInt(nSrcOpt, 10);
      const data = await separateVoices(file, nSrc, abortRef.current.signal);
      // Initialize all gains to 1.0
      const initialGains = {};
      data.sources.forEach((src) => { initialGains[src.id] = 1.0; });
      setGains(initialGains);
      setResult(data);
      setStatus("done");
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("idle");
      } else {
        setErrMsg(err.message);
        setStatus("error");
      }
    }
  }, [file, nSrcOpt, status]);

  const handleCancel = () => { abortRef.current?.abort(); setStatus("idle"); };
  const handleReset  = () => { abortRef.current?.abort(); setStatus("idle"); setResult(null); setErrMsg(""); setGains({}); };

  // Build mix sources array for MixViewer (recomputes when gains change)
  const mixSources = useMemo(() => {
    if (!result) return null;
    return result.sources.map((src) => ({
      audio: src.audio,
      gain: gains[src.id] ?? 1.0,
    }));
  }, [result, gains]);

  return (
    <div className="section-card vs-card">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-icon">
            <Icon
              d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
              size={15}
            />
          </span>
          <span className="section-title">Voice Separation · Multi-Decoder DPRNN</span>
        </div>

        <div className="vs-controls">
          <label className="vs-nsrc-label" htmlFor="vs-nsrc-select">Sources</label>
          <select
            id="vs-nsrc-select"
            className="vs-nsrc-select"
            value={nSrcOpt}
            onChange={(e) => setNSrcOpt(e.target.value)}
            disabled={status === "loading"}
          >
            <option value="auto">Auto</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>

          {status !== "loading" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSeparate}
              disabled={!file || disabled}
            >
              <Icon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
              Separate Voices
            </button>
          ) : (
            <button type="button" className="btn btn-danger" onClick={handleCancel}>
              Cancel
            </button>
          )}

          {status === "done" && (
            <button type="button" className="btn" onClick={handleReset}>Reset</button>
          )}
        </div>
      </div>

      <div className="section-body">
        {!file && (
          <p className="vs-hint">Upload a WAV file from the sidebar to enable voice separation.</p>
        )}

        {file && status === "idle" && (
          <div className="vs-idle-hint">
            <div className="vs-idle-icon">
              <Icon d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" size={28} />
            </div>
            <p>
              Press <strong>Separate Voices</strong> to extract individual speakers from<br />
              <span className="vs-filename">{file.name}</span>
            </p>
            <p className="vs-model-note">
              Model: Multi-Decoder DPRNN · auto-detects 2–5 sources · 8 kHz output
            </p>
          </div>
        )}

        {status === "loading" && (
          <div className="vs-loading">
            <div className="vs-spinner">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="vs-spinner-bar" style={{ "--i": i }} />
              ))}
            </div>
            <p className="vs-loading-text">Separating voices…</p>
            <p className="vs-loading-sub">First run downloads the model (~200 MB) from HuggingFace</p>
          </div>
        )}

        {status === "error" && (
          <div className="vs-error">
            <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
            <span>{errMsg}</span>
            <button className="error-dismiss" onClick={handleReset}>✕</button>
          </div>
        )}

        {status === "done" && result && (
          <>
            <p className="vs-result-summary">
              <Icon d="M22 11.08V12a10 10 0 1 1-5.93-9.14" size={12} />
              Detected <strong>{result.n_sources}</strong> voice{result.n_sources !== 1 ? "s" : ""} · {result.sample_rate} Hz
            </p>
            <div className="vs-sources-grid">
              {result.sources.map((src) => (
                <SourceCard
                  key={src.id}
                  source={src}
                  index={src.id}
                  baseName={baseName}
                  sampleRate={result.sample_rate}
                  gain={gains[src.id] ?? 1.0}
                  onGainChange={(v) => setGains((prev) => ({ ...prev, [src.id]: v }))}
                />
              ))}
            </div>

            <MixViewer
              sources={mixSources}
              sampleRate={result.sample_rate}
              baseName={baseName}
            />
          </>
        )}
      </div>
    </div>
  );
}
