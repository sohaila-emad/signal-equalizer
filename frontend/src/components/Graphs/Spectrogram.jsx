import { useEffect, useRef } from 'react';

/**
 * Spectrogram - Reusable canvas heatmap
 * 
 * Props: data (2D float array in dB), freqs, times, label
 * Renders color-mapped spectrogram
 */
export default function Spectrogram({ freqs, times, data, label }) {
  const canvasRef = useRef(null);
  const width = 600;
  const height = 200;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !freqs || !times || !data || data.length === 0) return;

    const rows = data.length;
    const cols = data[0]?.length || 0;
    if (rows === 0 || cols === 0) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(cols, rows);

    // Find min/max for normalization
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = data[r][c];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const range = max - min || 1;

    // Colormap: blue -> green -> yellow
    const colorFor = (v) => {
      const t = (v - min) / range;
      const r = 255 * t;
      const g = 255 * Math.min(1, t * 1.5);
      const b = 255 * (1 - t);
      return [r, g, b];
    };

    for (let r = 0; r < rows; r++) {
      const srcRow = rows - 1 - r; // flip vertically
      for (let c = 0; c < cols; c++) {
        const [R, G, B] = colorFor(data[srcRow][c]);
        const idx = (r * cols + c) * 4;
        imgData.data[idx] = R;
        imgData.data[idx + 1] = G;
        imgData.data[idx + 2] = B;
        imgData.data[idx + 3] = 255;
      }
    }

    // Draw to offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = cols;
    offscreen.height = rows;
    const offCtx = offscreen.getContext('2d');
    offCtx.putImageData(imgData, 0, 0);

    // Scale to display size
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, width, height);
  }, [freqs, times, data]);

  return (
    <div className="spectrogram">
      <h4>{label}</h4>
      <canvas ref={canvasRef} />
    </div>
  );
}
