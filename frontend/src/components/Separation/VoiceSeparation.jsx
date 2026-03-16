/**
 * frontend/src/components/Separation/VoiceSeparation.jsx
 */

import { useState, useRef, useCallback } from "react";
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

/* encodeWavBlob is provided by services/api and returns a WAV Blob */

function downloadSource(audio, sampleRate, idx, baseName) {
  const blob = encodeWavBlob(audio, sampleRate);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${baseName}_voice_${idx}.wav`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Source card — owns its own viewState so each viewer is independent ── */
function SourceCard({ source, index, baseName, sampleRate }) {
  const [viewState, setViewState] = useState({ offsetSamples: 0, zoom: 1 });

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
          onClick={() => downloadSource(source.audio, sampleRate, index, baseName)}
          title={`Download voice ${index}`}
        >
          <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" size={12} />
          WAV
        </button>
      </div>

      <CineViewer
        label={`Voice ${index}`}
        signal={source.audio}
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
  const abortRef = useRef(null);

  const baseName = file ? file.name.replace(/\.wav$/i, "") : "output";

  const handleSeparate = useCallback(async () => {
    if (!file || status === "loading") return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus("loading");
    setResult(null);
    setErrMsg("");

    try {
      const nSrc = nSrcOpt === "auto" ? null : parseInt(nSrcOpt, 10);
      const data = await separateVoices(file, nSrc, abortRef.current.signal);
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
  const handleReset  = () => { abortRef.current?.abort(); setStatus("idle"); setResult(null); setErrMsg(""); };

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
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}