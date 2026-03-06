# Signal Equalizer

A full-stack web application for audio signal equalization with real-time visualization. Features a React (Vite) frontend and Flask backend.

## Architecture

```
signal-equalizer/
├── frontend/          # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Equalizer/   # Band controls and sliders
│   │   │   ├── Viewers/     # Waveform viewers with playback
│   │   │   ├── Graphs/      # FFT and spectrogram visualizations
│   │   │   └── Layout/      # Header, mode selector, file uploader
│   │   ├── services/
│   │   │   └── api.js       # ONLY file that calls fetch
│   │   ├── App.jsx          # Thin orchestrator
│   │   └── main.jsx
│   └── package.json
│
├── backend/           # Flask backend
│   ├── app/
│   │   ├── __init__.py      # Flask app factory
│   │   ├── routes/
│   │   │   └── equalizer_routes.py  # All API endpoints
│   │   ├── services/
│   │   │   ├── equalizer_service.py # Band equalization using np.fft
│   │   │   └── transform_service.py # Spectrogram and FFT computation
│   │   └── utils/
│   │       └── manual_dft.py        # Unused - kept for reference only
│   ├── config/
│   │   ├── modes.json              # Mode definitions (musical, animal, human, ecg)
│   │   └── generic_saved.json      # Saved generic mode configurations
│   ├── data/
│   │   └── synthetic/
│   │       └── generate_synthetic.py  # Test signal generator
│   ├── requirements.txt
│   └── run.py              # Entry point
```

## Key Features

### Generic Mode
- **Custom frequency bands**: Define your own bands with min/max Hz ranges
- **Real-time adjustment**: Every slider change immediately triggers reprocessing
- **Save/Load configs**: Persist custom band configurations to `config/generic_saved.json`
- **Human-editable**: Config files are plain JSON, manually editable outside the app

### Customized Modes
- **Pre-defined bands**: Musical, Animal, Human, ECG abnormalities
- **Simple sliders**: One slider per band (0x to 2x gain)
- **Mode definitions**: Loaded from backend's `config/modes.json`

### Signal Processing
- **Uses np.fft everywhere**: All FFT operations use NumPy's optimized implementation
- **Block-wise processing**: Handles long audio files efficiently
- **Real-time equalization**: Applied in frequency domain with immediate feedback

### Visualization
- **Linked Cine Viewers**: Synchronized input/output waveform viewers
- **Playback controls**: Play, pause, speed adjustment (0.25x to 2x)
- **Pan and Zoom**: Navigate through time-domain signal with boundary enforcement
- **FFT Graphs**: Toggle between linear and audiogram (logarithmic) scales
- **Spectrograms**: Color-mapped frequency vs. time heatmaps with show/hide toggle

## Installation

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

## Running the Application

### 1. Start Backend

```bash
cd backend
python run.py
```

Backend runs on `http://127.0.0.1:5000`

### 2. Start Frontend

```bash
cd frontend
npm run dev
```

Frontend runs on `http://localhost:5173`

### 3. Generate Test Signal (Optional)

```bash
cd backend/data/synthetic
python generate_synthetic.py
```

This creates `synthetic_test.wav` with pure sine waves at 100Hz, 500Hz, 1kHz, 3kHz, 8kHz, and 15kHz.
Use this to validate the equalizer - zeroing out a band containing one of these frequencies should make it disappear from the output FFT.

## API Endpoints

### `GET /modes`
Returns all available modes from `modes.json`.

### `POST /transform`
Process audio file with equalization.

**Form Data:**
- `file`: WAV file
- `mode`: Mode key (e.g., "generic", "musical")
- `weights`: JSON object mapping band ID to gain (e.g., `{"bass": 1.5}`)
- `bands`: (Generic mode only) JSON array of band configurations

**Returns:**
- Input/output audio samples
- Spectrograms (input/output)
- FFT magnitude data
- Sample rate and metadata

### `POST /config/save`
Save generic mode band configuration.

**Body:** `{ "bands": [...] }`

### `GET /config/load`
Load saved generic mode configuration.

**Returns:** `{ "bands": [...] }`

## Usage

1. **Upload Audio**: Drag and drop a WAV file or click to select
2. **Select Mode**: Choose "Generic" or a predefined mode
3. **Generic Mode**:
   - Click "Add Band" to create frequency subdivisions
   - Adjust min/max Hz, label, and scale for each band
   - Click "Save Config" to persist, "Load Config" to restore
4. **Other Modes**:
   - Use sliders to adjust pre-defined frequency bands
5. **View Results** (automatically updates):
   - Synchronized waveform viewers with playback
   - FFT graphs (toggle linear/audiogram)
   - Spectrograms (show/hide toggle)

## Technical Details

### Signal Processing Pipeline

1. **Load Audio**: `librosa.load()` downsamples to 11.025 kHz
2. **Transform to Frequency Domain**: `np.fft.rfft()` for real signals
3. **Apply Band Gains**: Multiply spectrum bins in each band by gain factor
4. **Transform Back**: `np.fft.irfft()` to reconstruct time-domain signal
5. **Compute Spectrogram**: Sliding window FFT with Hanning window
6. **Compute FFT Magnitude**: For visualization

### Frontend Architecture

- **Fully Reactive**: No submit buttons - all changes trigger immediate reprocessing
- **Component Reuse**: `CineViewer` used twice, `Spectrogram` used twice
- **Single API Module**: Only `services/api.js` calls `fetch`
- **Thin Orchestrator**: `App.jsx` manages state and delegates to components

### Backend Architecture

- **Flask App Factory**: Creates app with CORS in `app/__init__.py`
- **Route Organization**: All endpoints in `app/routes/equalizer_routes.py`
- **Service Layer**: Signal processing logic separated into service modules
- **Config Management**: JSON files for mode definitions and user configs

## Boundary Conditions

- **Cine Viewer**: Cannot scroll past signal edges, zoom limited by signal length
- **Band Frequencies**: Min Hz must be ≥ 0, Max Hz must be ≤ Nyquist frequency
- **Playback**: Handles edge cases (playing from offset, speed changes, end of signal)

## Notes

- `manual_dft.py` exists in `backend/app/utils/` but is **never imported or called** - kept for reference only
- All actual FFT operations use `np.fft.rfft` and `np.fft.irfft` for efficiency
- Generic mode configuration files are human-readable and can be edited manually
- The app is designed for mono WAV files; stereo files are mixed to mono

## Development

### Adding a New Mode

1. Edit `backend/config/modes.json`
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

