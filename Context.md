# Signal Equalizer — Project Context

## Stack
- Frontend: React + Vite
- Backend: Flask + Python
- Processing: np.fft (manual_dft.py exists but is never called)


## Project Structure (After Frontend Rework)
signal-equalizer/
├── frontend/
│   ├── public/index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Equalizer/
│   │   │   │   ├── SliderPanel.jsx
│   │   │   │   └── BandControls.jsx
│   │   │   ├── Viewers/
│   │   │   │   ├── CineViewer.jsx
│   │   │   │   └── LinkedViewers.jsx
│   │   │   ├── Graphs/
│   │   │   │   ├── FftGraph.jsx
│   │   │   │   └── Spectrogram.jsx
│   │   │   └── Layout/
│   │   │       ├── Header.jsx
│   │   │       ├── ModeSelector.jsx
│   │   │       └── FileUploader.jsx
│   │   ├── services/
│   │   │   └── api.js   # All fetch calls centralized here (see below)
│   │   ├── App.jsx     # Thin orchestrator, all state and logic
│   │   └── main.jsx
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── routes/equalizer_routes.py
│   │   ├── services/
│   │   │   ├── equalizer_service.py
│   │   │   └── transform_service.py
│   │   └── utils/manual_dft.py
│   ├── config/
│   │   ├── modes.json
│   │   └── generic_saved.json
│   ├── data/synthetic/generate_synthetic.py
│   ├── requirements.txt
│   └── run.py


## What Works
- Backend /transform endpoint: equalization pipeline confirmed working
- modes.json band configs exist for musical/animal/human/ecg modes
- Generic mode: adding bands, setting freq range, scaling works
- Zeroing out a band reduces that frequency range in output FFT (confirmed)
- FFT graph overlays input and output on the same plot with legend (blue/orange)
- FFT graph shows input vs output, with band regions shaded and labeled
- Spectrogram renders
- Cine viewers show input vs output waveforms, time axis labeled
- All frequency number inputs show "Hz" label
- Amplitude sliders show current value as "0.00x" next to slider, updating live
- FFT graph x-axis labeled "Frequency (Hz)", y-axis labeled "Magnitude (dB)"
- All UI is fully reactive, no submit buttons

## What's Built This Session
- [x] Backend refactored into app factory structure  # Complete: Flask app factory, modular routes/services
- [x] /modes, /config/save, /config/load endpoints  # Complete: All endpoints implemented as specified
- [x] Generic mode bands from request payload (not modes.json)  # Complete: Generic mode reads bands from request, not modes.json
- [x] generate_synthetic.py  # Complete: Standalone script for test signal generation
- [x] api.js  # Complete: All fetch/API calls centralized here
- [x] ModeSelector.jsx  # Complete: Loads modes from backend, no hardcoded configs
- [x] FileUploader.jsx  # Complete: Drag-and-drop/click upload, triggers processing
- [x] BandControls.jsx  # Complete: Manages one band, all changes reactive
- [x] SliderPanel.jsx  # Complete: Handles both generic/custom modes, no duplication
- [x] CineViewer.jsx  # Complete: Reusable waveform viewer, all controls, boundary checks
- [x] LinkedViewers.jsx  # Complete: Two CineViewers, shared state, synchronized
- [x] FftGraph.jsx (linear + audiogram toggle)  # Complete: FFT graph with toggle, no state reset
- [x] Spectrogram.jsx  # Complete: Reusable, color-mapped, used twice
- [x] App.jsx  # Complete: Thin orchestrator, all state, no logic duplication

## Known Bugs
(none known)

## Hard Rules (never violate)
- np.fft for all processing, manual_dft.py never imported
- api.js is the only file that calls fetch
- CineViewer used twice, Spectrogram used twice — never duplicated
- No unused code, no submit buttons, fully reactive
- Mode configs come from /modes endpoint only — modesConfig.js deleted
- generic_saved.json must be human-readable/editable JSON

## Next Session Starting Point
- All core bugs and UI issues from previous sessions are now fixed and verified.
- FFT graph overlays input/output, shows shaded band regions, and has axis labels/legend.
- CineViewer and Spectrogram are each used twice, never duplicated.
- All UI is fully reactive, no submit buttons, and all units/labels are present.
- No known bugs as of this session; test edge cases if new issues arise.