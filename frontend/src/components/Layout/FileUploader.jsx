export default function FileUploader({ onFileSelect }) {
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.wav')) {
      onFileSelect(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  return (
    <div 
      className="file-uploader"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <label htmlFor="file">Audio file (.wav):</label>
      <input
        id="file"
        type="file"
        accept=".wav,audio/wav"
        onChange={handleFileChange}
      />
      <p className="hint">Or drag and drop a WAV file here</p>
    </div>
  );
}
