#!/bin/bash
echo "🚀 Starting Centriq AI Backend..."

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    pip install -e .
else
    source venv/bin/activate
    # Only install if requirements.txt is newer than venv directory
    if [ requirements.txt -nt venv ]; then
        echo "📥 Updating dependencies..."
        pip install -r requirements.txt
        pip install -e .
        touch venv
    fi
fi

# Ensure database exists and is initialized
echo "📂 Ensuring database is ready..."
python3 create_db.py
python3 init_db_script.py

# Start FastAPI
echo "✅ Backend running on http://localhost:8080"
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload --reload-dir app
