## transform Audio Lab (Starter Backend)

This project is an educational audio processing lab that implements a custom **"Zorbe7 Transform"** (manual DFT/IDFT without `np.fft`) and exposes it through a Flask API. The long‑term goal is to support equalization, spectrograms, audiogram views, PCA/SVD "best basis", and edge‑device export.

### Structure (current starter)

- **backend/**
  - `app.py`: Flask app entrypoint and API routes.
  - `zorbe7.py`: Manual DFT/IDFT and basic spectrogram utilities.
  - `requirements.txt`: Python dependencies for the backend.

### Getting Started (Backend Only)

1. **Create and activate a virtual environment** (recommended):

   ```bash
   cd "c:\\Users\\sohai\\OneDrive\\Desktop\\New folder"
   python -m venv .venv
   .venv\\Scripts\\activate
   ```

2. **Install backend dependencies**:

   ```bash
   pip install -r backend/requirements.txt
   ```

3. **Run the Flask backend**:

   ```bash
   cd backend
   set FLASK_APP=app.py
   set FLASK_ENV=development
   flask run
   ```

4. **Test the health endpoint**:

   Open `http://127.0.0.1:5000/health` in a browser or via `curl`:

   ```bash
   curl http://127.0.0.1:5000/health
   ```

### Next Steps (not yet implemented)

- Implement full upload → transform → equalize → inverse → return signal pipeline.
- Add sliding‑window spectrogram and return it as a 2D matrix.
- Define JSON configs for modes (Musical / Animal / Human) and map slider IDs to frequency bins.
- Create a React + Tailwind frontend with linked viewers and sliders.

