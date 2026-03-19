# Signal Equalizer

A full-stack web application for audio signal equalization with real-time visualization. Upload WAV files, apply customizable or pre-defined equalizer modes, and instantly see synchronized waveforms, FFT analysis, and spectrograms.

**Stack:** React (Vite) · Flask · NumPy FFT · Plotly.js

---

## Screenshots

### 🏠 Main Interface



---<img width="592" height="941" alt="landing" src="https://github.com/user-attachments/assets/b539ed72-f34f-4d88-9229-0b20a7adb71a" />


### 🎚️ Equalizer — viewers 


<img width="1468" height="872" alt="music viewers" src="https://github.com/user-attachments/assets/6b7a3e00-c96a-4fd8-ab43-db3f893ecc62" />

---

### 🎚️ Equalizer — Generic Mode (Custom Bands)


<img width="1396" height="770" alt="generic" src="https://github.com/user-attachments/assets/9af3c92c-4cb4-46e1-8641-c2cdf44bfa8e" />

---

### 📊 FFT Graph and spectrograms 


<img width="1505" height="884" alt="music graphs" src="https://github.com/user-attachments/assets/15275a9b-6fb7-41d5-b88d-50d11cca5588" />

---

### 📊 FFT Graph — Logarithmic (Audiogram) Scale


<img width="1502" height="517" alt="audiogram" src="https://github.com/user-attachments/assets/e46819d6-1fb3-429c-84ab-4c666e963b89" />

---

### 🫀 ECG Mode


<img width="1824" height="820" alt="ecg viewer" src="https://github.com/user-attachments/assets/05a4275a-50cb-4e0e-b3bf-57fda08c9549" />

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Running the Application](#running-the-application)
- [Usage Guide](#usage-guide)
- [API Endpoints](#api-endpoints)
- [Signal Processing Pipeline](#signal-processing-pipeline)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Signal Equalizer lets you:

- Upload WAV audio files (mono or stereo — stereo is auto-converted to mono)
- Apply frequency-domain equalization through graphical band controls
- Switch between preset modes (Musical, Animal, Human, ECG) or define your own bands
- View input and output waveforms side-by-side with synchronized scrolling and zoom
- Analyze frequencies with FFT graphs in linear or dB scale
- Examine time-frequency content with spectrograms

Every adjustment triggers immediate reprocessing — no submit buttons.

---

## Features

### Equalizer Modes

| Mode | Description |
|------|-------------|
| **Musical** | Bass, midrange, treble, and ultrasonic subdivisions |
| **Animal** | Frequency ranges relevant to various animal hearing |
| **Human** | Human speech and hearing range optimization |
| **ECG** | Electrocardiogram abnormality detection bands |
| **Generic** | Fully custom — define any number of bands with any Hz range |

### Generic Mode
- Add/remove frequency bands freely
- Set min/max Hz, label, and gain for each band
- Save configurations to a JSON file and reload them later
- Band boundaries are overlaid directly on the FFT graph

### Waveform Viewers
- Input (original) on the left, output (equalized) on the right
- Synchronized horizontal scroll and zoom
- Vertical crosshair alignment
- Pan by clicking and dragging; zoom with the scroll wheel down to individual samples

### Playback
- Play/pause on each viewer independently
- Speed control: 0.25× to 2×
- Real-time position indicator during playback

### Frequency Analysis
- FFT magnitude spectrum (linear and dB/audiogram scale toggle)
- Band boundary lines overlaid on the graph

### Spectrogram
- Sliding-window FFT with Hanning window
- Color-mapped frequency vs. time heatmap for both input and output
- Show/hide toggle

---

## Installation

### Prerequisites
- Python 3.8+
- Node.js 16+ and npm 7+

### Backend
```bash
cd backend
pip install -r requirements.txt
```

### Frontend
```bash
cd frontend
npm install
```

---

## Running the Application

**Terminal 1 — Backend**
```bash
cd backend
python run.py
# Runs on http://127.0.0.1:5000
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

Then open **http://localhost:5173** in your browser.

### Generate a Synthetic Test Signal (Optional)
```bash
cd backend/data/synthetic
python generate_synthetic.py
```
Creates `synthetic_test.wav` with pure sine waves at 100 Hz, 500 Hz, 1 kHz, 3 kHz, 8 kHz, and 15 kHz. Set a band's gain to 0× to make those frequencies disappear from the output FFT — useful for validating the equalizer.

---

## Usage Guide

1. Start both servers (backend on 5000, frontend on 5173)
2. Drag and drop a WAV file onto the upload area, or click to browse
3. Select a mode from the dropdown
4. Adjust the controls:
   - **Preset modes** — move sliders to set band gains (0× = mute, 2× = double)
   - **Generic mode** — click "Add Band", enter min/max Hz and a label, then adjust its slider
5. Results update automatically in real-time
6. Interact with the viewers:
   - **Pan** — click and drag horizontally
   - **Zoom** — scroll wheel
   - **Playback** — click Play, adjust speed slider
   - **FFT scale** — toggle between Linear and Logarithmic
   - **Spectrogram** — click Show/Hide

---

## API Endpoints

Backend runs on `http://127.0.0.1:5000`. All responses are JSON.

### `GET /modes`
Returns all available equalization mode definitions.

### `POST /transform`
Applies equalization to an uploaded WAV file.

| Field | Type | Description |
|-------|------|-------------|
| `file` | File | WAV audio file |
| `mode` | String | `"generic"`, `"musical"`, `"animal"`, `"human"`, or `"ecg"` |
| `weights` | JSON | Band ID → gain mapping, e.g. `{"bass": 1.5, "mid": 1.0}` |
| `bands` | JSON | (Generic mode only) Array of band objects with `min_freq`, `max_freq`, `label` |

**Response:**
```json
{
  "input_samples": [...],
  "output_samples": [...],
  "input_spectrogram": [...],
  "output_spectrogram": [...],
  "input_fft": [...],
  "output_fft": [...],
  "sample_rate": 11025,
  "duration_s": 5.2,
  "nyquist_hz": 5512.5
}
```

### `POST /config/save`
Saves a generic mode band configuration to `config/generic_saved.json`.

### `GET /config/load`
Loads the previously saved generic mode configuration.

---

## Signal Processing Pipeline

```
WAV Upload → librosa.load (11025 Hz, mono)
           → np.fft.rfft (real FFT)
           → Band equalization (multiply bins by gain)
           → np.fft.irfft (reconstruct time-domain signal)
           → Spectrogram (sliding-window FFT + Hanning window)
           → JSON response to frontend
```

**Why 11.025 kHz?** It covers the full human hearing range (Nyquist ≈ 5.5 kHz) while keeping processing fast. Stereo files are averaged to mono automatically.

**Frequency → bin index mapping:**
```
bin_min = ceil(f_min × N / sample_rate)
bin_max = floor(f_max × N / sample_rate)
```

---

## Project Structure

```
signal-equalizer/
├── frontend/
│   └── src/
│       ├── App.jsx                        # Main state orchestrator
│       ├── components/
│       │   ├── Equalizer/
│       │   │   ├── BandControls.jsx       # Generic mode band editor
│       │   │   └── SliderPanel.jsx        # Preset mode sliders
│       │   ├── Viewers/
│       │   │   ├── CineViewer.jsx         # Waveform + playback
│       │   │   └── LinkedViewers.jsx      # Synchronized input/output
│       │   └── Graphs/
│       │       ├── FftGraph.jsx           # FFT visualization
│       │       └── Spectrogram.jsx        # Frequency vs. time heatmap
│       └── services/
│           └── api.js                     # All backend communication
│
├── backend/
│   ├── run.py                             # Entry point
│   ├── app/
│   │   ├── routes/
│   │   │   └── equalizer_routes.py        # All REST endpoints
│   │   └── services/
│   │       ├── equalizer_service.py       # Band equalization logic
│   │       ├── transform_service.py       # FFT & spectrogram
│   │       └── abnormality_service.py     # ECG-specific processing
│   └── config/
│       ├── modes.json                     # Preset mode definitions
│       └── generic_saved.json             # User-saved generic configs
│
└── README.md
```

---

## Configuration

### Adding a New Preset Mode
Edit `backend/config/modes.json` and add a new entry:
```json
"my_mode": {
  "bands": [
    { "id": "low", "label": "Low", "min_freq": 0, "max_freq": 500 },
    { "id": "high", "label": "High", "min_freq": 500, "max_freq": 5512 }
  ]
}
```
Restart the backend — the new mode appears in the frontend dropdown automatically.

---

## Troubleshooting

**Frontend shows blank page**
- Confirm the backend is running: open `http://127.0.0.1:5000/modes` in your browser
- Check the browser console (F12) for JavaScript errors

**Upload is rejected**
- Ensure the file is a valid WAV (not MP3, FLAC, etc.)
- Stereo is supported — it's automatically converted to mono

**No equalization effect**
- Check that band gains are not all set to 1× (neutral)
- Try the synthetic test signal to confirm the pipeline works

**Waveforms not in sync**
- Refresh the page and re-upload the file

**Spectrogram not showing**
- Click the "Show Spectrogram" toggle button

---

## License

MIT
