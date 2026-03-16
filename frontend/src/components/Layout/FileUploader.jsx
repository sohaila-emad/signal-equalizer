import { useState } from 'react';

export default function FileUploader({ onFileSelect, file, mode }) {
  const [dragging, setDragging] = useState(false); // hook must be first
  if (mode === 'ecg') return null; // conditional return after hook

  const handleChange = (e) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.toLowerCase().endsWith('.wav')) onFileSelect(f);
  };

  return (
    <>
      <div
        className={`file-uploader ${dragging ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
      >
        <input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" onChange={handleChange} />
        <div className="upload-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div className="upload-text">
          <strong>{file ? 'Replace file' : 'Upload WAV'}</strong>
          click or drag &amp; drop
        </div>
      </div>

      {file && (
        <div className="file-chip">
          <span className="file-chip-dot" />
          <span className="file-chip-name">{file.name}</span>
        </div>
      )}
    </>
  );
}