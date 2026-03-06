from flask import Flask
from flask_cors import CORS


def create_app():
    """Flask app factory with CORS enabled."""
    app = Flask(__name__)
    CORS(app)
    
    # Register routes
    from app.routes.equalizer_routes import register_routes
    register_routes(app)
    
    return app
