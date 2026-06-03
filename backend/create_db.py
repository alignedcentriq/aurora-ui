"""
Create / migrate the database schema.
Called by run-backend.js before uvicorn starts.
"""
import sys
import os

# Ensure the backend package is importable
sys.path.insert(0, os.path.dirname(__file__))

from app.database import init_db

if __name__ == "__main__":
    print("Creating / migrating database schema...")
    init_db()
    print("Database schema ready.")
