"""
backend/run.py  — replace your existing run.py with this
"""
from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=False,   # ← prevents watchdog from killing torch imports
    )