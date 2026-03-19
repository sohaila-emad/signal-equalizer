/**
 * frontend/src/components/Separation/AnimalSeparation.jsx
 */

import { useState, useRef, useCallback, useMemo } from "react";
import CineViewer from "../Viewers/CineViewer";
import { separateAnimal } from "../../services/api";

function Icon({ d, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── WAV encoder (PCM-16, mono) ── */
function encodeWav(samples, sampleRate) {
  const len      = samples.length;
  const buffer   = new ArrayBuffer(44 + len * 2);
  const view     = new DataView(buffer);
  const writeStr = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));
  const clip     = (x) => Math.max(-1, Math.min(1, x));

  writeStr(0,  "RIFF");
  view.setUint32(4,  36 + len * 2,   true);
  writeStr(8,  "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16,             true);
  view.setUint16(20, 1,              true);
  view.setUint16(22, 1,              true);
  view.setUint32(24, sampleRate,     true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2,              true);
  view.setUint16(34, 16,             true);
  writeStr(36, "data");
  view.setUint32(40, len * 2,        true);

  for (let i = 0; i < len; i++) {
    view.setInt16(44 + i * 2, clip(samples[i]) * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
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

function downloadSource(audio, sampleRate, label, baseName, gain) {
  const scaled = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    scaled[i] = Math.max(-1, Math.min(1, audio[i] * gain));
  }
  const blob = encodeWav(scaled, Math.round(sampleRate));
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${baseName}_${label.replace(/\s+/g, "_")}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Source card — gain slider + play/stop (gain controlled by parent) ── */
function SourceCard({ source, baseName, gain, onGainChange }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);

  const previewRate = Math.round(source.sample_rate);

  const play = () => {
    if (!source.audio || source.audio.length === 0) return;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;

    stop();

    let playbackSignal = source.audio;
    let playbackRate = previewRate;
    if (previewRate < 3000) {
      playbackRate = 8000;
      playbackSignal = resampleArray(source.audio, previewRate, playbackRate);
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
          <div className="vs-source-dot" />
          <span className="vs-source-title">{source.label}</span>
          <span className="vs-source-meta">{previewRate} Hz preview</span>
        </div>
        <button
          type="button"
          className="btn btn-primary vs-dl-btn"
          onClick={() => downloadSource(source.audio, previewRate, source.label, baseName, gain)}
          title={`Download ${source.label}`}
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

  const mixedSignal = useMemo(() => {
    if (!sources || sources.length === 0) return null;
    const maxLen = Math.max(...sources.map((s) => s.audio.length));
    const mix = new Float32Array(maxLen);
    for (const { audio, gain } of sources) {
      for (let i = 0; i < audio.length; i++) {
        mix[i] += audio[i] * gain;
      }
    }
    for (let i = 0; i < mix.length; i++) {
      mix[i] = Math.max(-1, Math.min(1, mix[i]));
    }
    return mix;
  }, [sources]);

  if (!mixedSignal) return null;

  const handleDownloadMix = () => {
    const blob = encodeWav(mixedSignal, Math.round(sampleRate));
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

/* ── Preset queries ── */
const PRESET_QUERIES = [
  "dog barking",
  "cat meowing",
  "bird chirping",
  "cow mooing",
];

/* ── Main component ── */
export default function AnimalSeparation({ file, disabled }) {
  const [status,       setStatus]       = useState("idle");
  const [result,       setResult]       = useState(null);
  const [errMsg,       setErrMsg]       = useState("");
  const [selected,     setSelected]     = useState(new Set(PRESET_QUERIES));
  const [customInput,  setCustomInput]  = useState("");
  const [customQueries,setCustomQueries]= useState([]);
  const [gains,        setGains]        = useState({});   // { sourceId: gainValue }
  const abortRef = useRef(null);

  const baseName   = file ? file.name.replace(/\.wav$/i, "") : "output";
  const allQueries = [...PRESET_QUERIES, ...customQueries];
  const activeQueries = allQueries.filter((q) => selected.has(q));

  const toggleQuery = (q) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q); else next.add(q);
      return next;
    });
  };

  const addCustom = () => {
    const q = customInput.trim();
    if (!q || allQueries.includes(q)) return;
    setCustomQueries((prev) => [...prev, q]);
    setSelected((prev) => new Set(prev).add(q));
    setCustomInput("");
  };

  const handleSeparate = useCallback(async () => {
    if (!file || status === "loading" || activeQueries.length === 0) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus("loading");
    setResult(null);
    setErrMsg("");
    setGains({});

    try {
      const data = await separateAnimal(file, activeQueries, abortRef.current.signal);
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
  }, [file, activeQueries, status]);

  const handleCancel = () => { abortRef.current?.abort(); setStatus("idle"); };
  const handleReset  = () => {
    abortRef.current?.abort();
    setStatus("idle");
    setResult(null);
    setErrMsg("");
    setGains({});
  };

  // Use the global sample_rate for the mix (all animal sources share same rate from backend)
  const mixSampleRate = result?.sample_rate ?? 32000;

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
              d="M12 8c-1.7-2-5-2.5-6.5.5C4 11.5 5 15 8 16c1.5.5 3 .5 4 0 1 .5 2.5.5 4 0 3-1 4-4.5 2.5-7.5C17 5.5 13.7 6 12 8z"
              size={15}
            />
          </span>
          <span className="section-title">Animal Sound Separation · AudioSep</span>
        </div>

        <div className="vs-controls">
          {status !== "loading" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSeparate}
              disabled={!file || disabled || activeQueries.length === 0}
            >
              <Icon d="M12 8c-1.7-2-5-2.5-6.5.5C4 11.5 5 15 8 16c1.5.5 3 .5 4 0 1 .5 2.5.5 4 0 3-1 4-4.5 2.5-7.5C17 5.5 13.7 6 12 8z" />
              Separate Sounds
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
          <p className="vs-hint">Upload a WAV file from the sidebar to enable animal sound separation.</p>
        )}

        {file && status !== "loading" && (
          <div className="vs-query-selector">
            <div className="vs-query-list">
              {allQueries.map((q) => (
                <label key={q} className="vs-query-item">
                  <input
                    type="checkbox"
                    checked={selected.has(q)}
                    onChange={() => toggleQuery(q)}
                    disabled={status === "loading"}
                  />
                  <span>{q}</span>
                </label>
              ))}
            </div>
            <div className="vs-custom-row">
              <input
                type="text"
                className="vs-custom-input"
                placeholder='Custom query, e.g. "rooster crowing"'
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              />
              <button
                type="button"
                className="btn"
                onClick={addCustom}
                disabled={!customInput.trim()}
              >
                Add
              </button>
            </div>
          </div>
        )}

        {file && status === "idle" && (
          <div className="vs-idle-hint">
            <div className="vs-idle-icon">
              <Icon d="M12 8c-1.7-2-5-2.5-6.5.5C4 11.5 5 15 8 16c1.5.5 3 .5 4 0 1 .5 2.5.5 4 0 3-1 4-4.5 2.5-7.5C17 5.5 13.7 6 12 8z" size={28} />
            </div>
            <p>
              Select sounds and press <strong>Separate Sounds</strong> to extract them from<br />
              <span className="vs-filename">{file.name}</span>
            </p>
            <p className="vs-model-note">
              Model: AudioSep · text-guided separation · 32 kHz output
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
            <p className="vs-loading-text">Separating animal sounds…</p>
            <p className="vs-loading-sub">
              Processing {activeQueries.length} query{activeQueries.length !== 1 ? "s" : ""} — first run loads the AudioSep model (~1 GB)
            </p>
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
              Separated <strong>{result.sources.length}</strong> sound{result.sources.length !== 1 ? "s" : ""} · {result.sample_rate} Hz
            </p>
            <div className="vs-sources-grid">
              {result.sources.map((src) => (
                <SourceCard
                  key={src.id}
                  source={src}
                  baseName={baseName}
                  gain={gains[src.id] ?? 1.0}
                  onGainChange={(v) => setGains((prev) => ({ ...prev, [src.id]: v }))}
                />
              ))}
            </div>

            <MixViewer
              sources={mixSources}
              sampleRate={mixSampleRate}
              baseName={baseName}
            />
          </>
        )}
      </div>
    </div>
  );
}
