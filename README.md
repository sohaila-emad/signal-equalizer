# Signal Equalizer

A full-stack web application for audio signal equalization with real-time visualization. Process WAV files through customizable or pre-defined equalizer modes with synchronized waveform visualization, FFT analysis, and spectrograms.

**Stack:** React (Vite) frontend, Flask backend, NumPy for DSP

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Features](#key-features)
4. [Installation & Setup](#installation--setup)
5. [Running the Application](#running-the-application)
6. [API Endpoints](#api-endpoints)
7. [Frontend Components](#frontend-components)
8. [Backend Services](#backend-services)
9. [Configuration](#configuration)
10. [Usage Guide](#usage-guide)
11. [Technical Details](#technical-details)
12. [File Structure](#file-structure)
13. [Development](#development)
14. [Troubleshooting](#troubleshooting)

---

## Overview

Signal Equalizer is a web-based audio processing tool that allows users to:
- Upload WAV audio files
- Apply frequency-domain equalization through graphical band controls
- Switch between preset equalization modes (Musical, Animal, Human, ECG) or create custom frequency bands
- Visualize input/output signals in real-time with synchronized waveform viewers
- Analyze frequencies using FFT graphs (linear and logarithmic scales)
- Examine time-frequency characteristics with spectrograms

The application emphasizes real-time processing—every adjustment triggers immediate reprocessing and UI updates with no submit buttons.

---

## Architecture

```
signal-equalizer/
├── frontend/                    # React + Vite (SPA)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Equalizer/
│   │   │   │   ├── BandControls.jsx      # Generic mode band management UI
│   │   │   │   └── SliderPanel.jsx       # Preset mode sliders
│   │   │   ├── Viewers/
│   │   │   │   ├── CineViewer.jsx        # Time-domain waveform + playback
│   │   │   │   ├── LinkedViewers.jsx     # Synchronized input/output
│   │   │   │   ├── TripleViewers.jsx     # Main results container
│   │   │   │   └── TripleViewers.css
│   │   │   ├── Graphs/
│   │   │   │   ├── FftGraph.jsx          # FFT magnitude visualization
│   │   │   │   └── Spectrogram.jsx       # Frequency vs. time heatmap
│   │   │   └── Layout/
│   │   │       ├── FileUploader.jsx      # WAV file drag-drop upload
│   │   │       ├── Header.jsx            # Title and branding
│   │   │       └── ModeSelector.jsx      # Mode dropdown
│   │   ├── services/
│   │   │   └── api.js                     # Centralized API communication
│   │   ├── utils.js                       # Shared utilities
│   │   ├── App.jsx                        # Main state orchestrator
│   │   ├── App.css
│   │   ├── index.css
│   │   ├── main.jsx                       # Entry point
│   │   └── assets/
│   ├── public/
│   ├── package.json
│   ├── vite.config.js
│   ├── eslint.config.js
│   └── README.md
│
├── backend/                     # Flask REST API
│   ├── app/
│   │   ├── __init__.py                    # Flask app factory, CORS setup
│   │   ├── routes/
│   │   │   └── equalizer_routes.py        # All REST endpoints
│   │   ├── services/
│   │   │   ├── equalizer_service.py       # Band-based equalization logic
│   │   │   ├── transform_service.py       # FFT, spectrogram computation
│   │   │   ├── music_model.py             # Data models
│   │   │   └── abnormality_service.py     # ECG-specific processing
│   │   └── utils/
│   │       ├── ecg_data_loader.py         # ECG dataset loading
│   │       └── manual_dft.py              # Reference DFT (unused)
│   ├── config/
│   │   ├── modes.json                     # Preset mode definitions
│   │   └── generic_saved.json             # User's saved generic configs
│   ├── data/
│   │   ├── python/
│   │   ├── synthetic/
│   │   │   └── generate_synthetic.py      # Synthetic test signal generator
│   │   └── sinusoids/
│   ├── compare_music_modes.py
│   ├── requirements.txt
│   ├── run.py                             # Entry point
│   └── Context.md
│
└── README.md (this file)
```

---

## Key Features

### 1. **Generic Mode**
Create fully custom frequency subdivisions:
- Define arbitrary number of frequency bands
- Set min/max Hz range for each band (0 Hz to Nyquist frequency)
- Custom labels and gain multipliers
- One-click save to persistent config file (`config/generic_saved.json`)
- Load previously saved configurations
- Visualizes band boundaries on FFT graph

**Use Case:** Investigating specific frequency ranges, research, education

### 2. **Preset Modes**
Pre-configured band layouts for common use cases:
- **Musical**: Bass, midrange, treble, ultrasonic subdivisions
- **Animal**: Frequency ranges relevant to various animal hearing
- **Human**: Human speech and hearing range optimization
- **ECG**: Electrocardiogram abnormality detection bands

**Use Case:** Quick analysis without manual band configuration

### 3. **Real-Time Signal Processing**
- Frequency-domain equalization using NumPy FFT
- Every UI adjustment triggers immediate reprocessing
- Block-wise processing for long audio files
- No latency perceptible to user

### 4. **Dual Waveform Viewers**
- **Left panel**: Input (original) audio
- **Right panel**: Output (equalized) audio
- Synchronized scrolling and zooming
- Vertical crosshair alignment
- Manual pan with boundary enforcement
- Zoom up to waveform sample level

### 5. **Playback Controls**
- Play/pause buttons on each viewer
- Adjustable playback speed (0.25x to 2x)
- Real-time position indicator during playback
- Automatic stop at signal end

### 6. **Frequency Analysis**
- **FFT Graph (Linear)**: Magnitude spectrum in linear scale
- **FFT Graph (Logarithmic/Audiogram)**: Magnitude spectrum in dB scale, better for hearing range
- Toggle between scales with button
- Band outlines overlaid on graph

### 7. **Time-Frequency Analysis**
- **Spectrograms**: Input and output spectrograms displayed
- Color-mapped frequency vs. time heatmaps
- Show/hide toggle for each spectrogram
- Sliding-window FFT visualization with Hanning window

---

## Installation & Setup

### Prerequisites
- Python 3.8+
- Node.js 16+ and npm 7+
- WAV files for testing (or generate synthetic)

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
```

**Dependencies:**
- Flask, Flask-CORS
- NumPy, scipy
- Librosa for audio I/O
- See `requirements.txt` for complete list

### Frontend Setup

```bash
cd frontend
npm install
```

**Dependencies:**
- React 19
- Vite
- Plotly.js for visualizations
- Fetch API (built-in browser)

---

## Running the Application

### Step 1: Start Backend

```bash
cd backend
python run.py
```

- Backend runs on `http://127.0.0.1:5000`
- CORS enabled for `http://localhost:5173`
- Logs HTTP requests and processing times

### Step 2: Start Frontend (New Terminal)

```bash
cd frontend
npm run dev
```

- Frontend runs on `http://localhost:5173`
- Hot module reload enabled for development
- Vite dev server auto-opens browser

### Step 3: Access Application

Open `http://localhost:5173` automatically or navigate manually.

### Optional: Generate Test Signal

```bash
cd backend/data/synthetic
python generate_synthetic.py
```

Creates `synthetic_test.wav` with pure sine waves at 100 Hz, 500 Hz, 1 kHz, 3 kHz, 8 kHz, and 15 kHz.

**Validation tip:** Reduce a band's gain to 0x (or negative) to make sine waves in that band disappear from output FFT.

---

## API Endpoints

All endpoints return JSON responses. The backend runs on port 5000.

### `GET /modes`
**Description:** Fetch all available equalization modes

**Response:**
```json
{
  "generic": { "bands": [...] },
  "musical": { "bands": [...] },
  "animal": { "bands": [...] },
  "human": { "bands": [...] },
  "ecg": { "bands": [...] }
}
```

### `POST /transform`
**Description:** Apply equalization to uploaded WAV file

**Form Data:**
| Field | Type | Description |
|-------|------|-------------|
| `file` | File | WAV audio file (mono or stereo) |
| `mode` | String | Mode key: "generic", "musical", "animal", "human", "ecg" |
| `weights` | JSON | Band ID to gain mapping, e.g., `{"bass": 1.5, "mid": 1.0}` |
| `bands` | JSON | (Generic mode only) Array of band definitions with `min_freq`, `max_freq`, `label` |

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
**Description:** Persist generic mode band configuration

**Request Body:**
```json
{
  "bands": [
    {"min_freq": 0, "max_freq": 250, "label": "Sub-bass"},
    {"min_freq": 250, "max_freq": 500, "label": "Bass"}
  ]
}
```

**Response:**
```json
{ "status": "ok", "message": "Configuration saved" }
```

### `GET /config/load`
**Description:** Load saved generic mode configuration

**Response:**
```json
{
  "bands": [
    {"min_freq": 0, "max_freq": 250, "label": "Sub-bass"},
    {"min_freq": 250, "max_freq": 500, "label": "Bass"}
  ]
}
```

---

## Frontend Components

### App.jsx (State Orchestrator)
- Manages global state: uploaded file, selected mode, weights, bands
- Handles file upload and mode changes
- Triggers API calls via `services/api.js`
- Distributes state to child components via props

### FileUploader (Layout)
- Drag-and-drop WAV file upload
- File validation (MIME type, size)
- Visual feedback (hover states, drag states)

### ModeSelector (Layout)
- Dropdown to switch between preset modes or generic
- Updates app state on selection

### BandControls (Equalizer)
- Generic mode only: add/remove frequency bands
- Each band has: min Hz, max Hz, label inputs
- Displays as editable form
- "Save Config" and "Load Config" buttons

### SliderPanel (Equalizer)
- Preset modes: shows one slider per band
- Range 0x to 2x gain multiplier
- Real-time slider value display

### CineViewer (Viewers)
- Time-domain waveform visualization
- Play/pause, speed adjustment (0.25x–2x)
- Pan with mouse drag (enforces boundaries)
- Zoom with scroll wheel (limited by signal length)
- Crosshair marker at current playback position

### LinkedViewers (Viewers)
- Container for two CineViewers (input and output)
- Synchronizes horizontal scroll position
- Displays labels: "Input" and "Output"

### TripleViewers (Viewers)
- Main results container
- Top: Linked input/output waveforms
- Bottom left: FFT graph
- Bottom right: Spectrogram
- Toggles for FFT scale (linear/log) and spectrogram visibility

### FftGraph (Graphs)
- Plots FFT magnitude spectrum
- Switches between linear and dB (audiogram) scale
- Band outlines overlay
- Uses Plotly.js for rendering

### Spectrogram (Graphs)
- Time-frequency heatmap
- Color intensity = magnitude at (time, frequency)
- X-axis: time (seconds)
- Y-axis: frequency (Hz)
- Can be hidden/shown via toggle

### utils.js
- Shared utility functions for component reuse
- Example: frequency bin to Hz conversion, scaling functions

---

## Backend Services

### equalizer_service.py
**Core equalization logic:**
- `equalize(spectrum, bands, weights)`: Applies band gains to frequency spectrum
- Iterates over defined bands
- Multiplies spectrum values in each band's frequency range by gain factor
- Returns modified spectrum for IFFT

### transform_service.py
**Signal processing:**
- `compute_fft(signal)`: Uses `np.fft.rfft()` for efficient real FFT
- `compute_spectrogram(signal)`: Sliding-window FFT with Hanning window
- `convert_to_db(magnitude)`: Convert magnitude to dB scale (log10 based)
- Helper functions for frequency ↔ bin index conversion

### music_model.py
**Data models:**
- Band definition structure
- Mode structure
- Serialization/deserialization for JSON

### abnormality_service.py
**ECG-specific processing:**
- Abnormality detection logic
- ECG band definitions

### Routes: equalizer_routes.py
**REST endpoints:**
- Handles file parsing (converts stereo to mono if needed)
- Calls services in sequence
- Error handling and validation
- JSON response formatting

### Utils

**ecg_data_loader.py:** Loads ECG datasets (unused in main app)

**manual_dft.py:** Naive DFT implementation (reference only, not called)

---

## Configuration

### modes.json
Defines preset equalization modes. Located at `backend/config/modes.json`.

Structure:
```json
{
  "musical": {
    "bands": [
      {
        "id": "sub_bass",
        "label": "Sub-Bass",
        "min_freq": 20,
        "max_freq": 60
      },
      ...
    ]
  },
  ...
}
```

**Editing:** Manually edit JSON to add new modes or modify band definitions. Restart backend to reload.

### generic_saved.json
User-created generic mode configurations. Located at `backend/config/generic_saved.json`.

Created/updated when user clicks "Save Config" in Generic mode.

Structure:
```json
{
  "bands": [
    {
      "min_freq": 0,
      "max_freq": 250,
      "label": "Bass"
    },
    ...
  ]
}
```

---

## Usage Guide

### Basic Workflow

1. **Start both servers** (backend on 5000, frontend on 5173)
2. **Drag WAV file** onto the upload area or click to select
3. **Select a mode** from dropdown
4. **Adjust controls:**
   - **Preset modes:** Use sliders to set band gains (0x = mute, 2x = boost)
   - **Generic mode:** Click "Add Band" to define custom frequency ranges, set gains via sliders
5. **View results** automatically update in real-time:
   - Input waveform on left, output on right
   - FFT graphs below for frequency analysis
   - Spectrograms for time-frequency view
6. **Interact with visualizations:**
   - **Pan waveforms:** Click and drag horizontally
   - **Zoom waveforms:** Scroll wheel (limited by signal length)
   - **Playback:** Click Play, adjust speed slider (0.25x–2x)
   - **Toggle FFT scale:** Linear ↔ Logarithmic (audiogram)
   - **Toggle spectrogram:** Show/hide button
7. **Save generic config** (if using generic mode) to reuse band definitions later

### Generic Mode Detailed Steps

1. Select "Generic" mode from dropdown
2. Click "Add Band" to create a frequency subdivision
   - Enter min Hz (e.g., 0)
   - Enter max Hz (e.g., 250)
   - Enter label (e.g., "Bass")
3. Slider appears for that band; adjust gain
4. Repeat to add more bands
5. Click "Save Config" to persist; "Load Config" to restore

### Preset Mode Example: Musical

- **Sub-Bass:** 20–60 Hz
- **Bass:** 60–250 Hz
- **Low Mids:** 250–500 Hz
- **Mids:** 500–2000 Hz
- **High Mids:** 2000–4000 Hz
- **Treble:** 4000–8000 Hz
- **Brilliance:** 8000–16000 Hz

Adjust sliders to boost/cut each range for desired sound.

---

## Technical Details

### Signal Processing Pipeline

1. **Audio Load:** `librosa.load(file, sr=11025, mono=True)`
   - Normalizes to 11.025 kHz sample rate
   - Converts stereo to mono (averages channels)

2. **FFT Transform:** `np.fft.rfft(signal)`
   - Real FFT for efficiency (input is real signal)
   - Output: complex magnitude and phase

3. **Band Equalization:** For each band:
   - Map frequency range to FFT bin indices
   - Multiply magnitude by gain factor
   - Preserve phase (untouched)

4. **Inverse FFT:** `np.fft.irfft(modified_spectrum)`
   - Reconstructs time-domain signal

5. **Spectrogram:** Sliding-window FFT
   - Window size, overlap, Hanning window applied
   - Output: 2D magnitude array (time × frequency)

6. **FFT for Display:** Magnitude spectrum computation
   - Linear: direct magnitude values
   - dB: $20 \log_{10}(\text{magnitude})$

### Why NumPy FFT?

- **Efficient:** Implements optimized FFT algorithms (Cooley-Tukey, others)
- **Versatile:** Handles arbitrary signal lengths
- **Standard:** Industry-standard library for signal processing

### Why 11.025 kHz?

- Librosa's default resampling rate
- Sufficient for human hearing range (Nyquist ~5.5 kHz)
- Balances quality and computational cost

### Frequency to Bin Index Mapping

Given sample rate $f_s$ and FFT size $N$:
- Bin $k$ corresponds to frequency: $f = k \cdot \frac{f_s}{N}$
- To find bins for frequency range $[f_{min}, f_{max}]$:
  - $k_{min} = \lceil \frac{f_{min} \cdot N}{f_s} \rceil$
  - $k_{max} = \lfloor \frac{f_{max} \cdot N}{f_s} \rfloor$

---

## File Structure

**Frontend Key Files:**

- `src/App.jsx` – Main orchestrator, state management
- `src/components/Equalizer/BandControls.jsx` – Generic band editor
- `src/components/Equalizer/SliderPanel.jsx` – Preset mode sliders
- `src/components/Viewers/CineViewer.jsx` – Waveform viewer and playback
- `src/components/Graphs/FftGraph.jsx` – FFT visualization
- `src/services/api.js` – All backend communication

**Backend Key Files:**

- `run.py` – Entry point
- `app/__init__.py` – Flask factory
- `app/routes/equalizer_routes.py` – All endpoints
- `app/services/equalizer_service.py` – Band equalization
- `app/services/transform_service.py` – FFT/spectrogram
- `config/modes.json` – Preset definitions
- `config/generic_saved.json` – User configs

---

## Development

### Adding a New Preset Mode

1. Edit `backend/config/modes.json`
2. Add new mode object with band definitions:
   ```json
   "custom_mode": {
     "bands": [
       {"id": "band_1", "label": "Low", "min_freq": 0, "max_freq": 500},
       {"id": "band_2", "label": "Mid", "min_freq": 500, "max_freq": 2000}
     ]
   }
   ```
3. Restart backend
4. New mode appears in frontend dropdown

### Modifying Band Definitions

Edit `backend/config/modes.json` directly. Restart backend to reload.

### Creating a Custom FFT Scaling

Edit `app/services/transform_service.py`:
- Modify `convert_to_db()` function
- Recompute FFT response with new scaling
- Restart backend

### Extending Waveform Viewer

Edit `src/components/Viewers/CineViewer.jsx`:
- Add new event handlers for pan/zoom
- Modify rendering logic
- Frontend hot-reload applies changes instantly

### Performance Optimization

- **Large files:** Implement block-wise FFT processing
- **Backend:** Use NumPy broadcasting instead of loops
- **Frontend:** Downsampl waveform for rendering (show every Nth sample)

---

## Troubleshooting

### Common Issues

**Frontend won't load (blank page)**
- Check backend is running: `http://127.0.0.1:5000/modes`
- Verify CORS is enabled in `app/__init__.py`
- Check browser console for JavaScript errors

**Upload fails (file rejected)**
- Ensure file is valid WAV format
- Check file size (should be < 50 MB for typical systems)
- Verify sample rate is supported (11.025 kHz after resampling)

**Audio file plays but no equalization effect**
- Verify mode was selected before upload
- Check band gains are not all 1x (neutral)
- Test with synthetic signal first

**Waveforms not synchronized**
- Refresh page
- Re-upload file
- Check browser console for errors

**Spectrogram not displaying**
- Click "Show Spectrogram" toggle
- Ensure file was processed completely
- Check backend logs for computation errors

### Debugging

**Backend debugging:**
```bash
python -m pdb run.py
```

**Frontend console:**
- Open DevTools (F12)
- Check Console and Network tabs
- Inspect API responses

**View backend logs:**
- Terminal where `python run.py` is running
- Shows HTTP requests, processing times, errors

### Notes on Limitations

- Designed for **mono WAV files** (stereo auto-converted to mono)
- **Maximum file size:** Limited by system RAM (~1 GB audio)
- **Real-time constraint:** Processing completes in < 1 second for typical files
- **manual_dft.py:** Reference implementation only, never called (NumPy FFT used instead)
- **Config editing:** Generic mode configs are JSON; manually editable but structure must be valid

---

## License & Attribution

This project uses NumPy, Flask, React, and other open-source libraries. Refer to `requirements.txt` and `package.json` for full dependency list and versions.
2. Add new mode with `bands` array
3. Restart backend - frontend will automatically detect it

### Modifying Band Definitions

Edit `backend/config/modes.json` directly:

```json
{
  "new_mode": {
    "bands": [
      { "id": "band1", "label": "Low", "min_hz": 20, "max_hz": 200 },
      { "id": "band2", "label": "High", "min_hz": 200, "max_hz": 5000 }
    ]
  }
}
```

## License

MIT

