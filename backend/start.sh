#!/bin/bash
echo "🚀 Starting Centriq AI Backend..."

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
    # Only install if requirements.txt is newer than venv directory
    if [ requirements.txt -nt venv ]; then
        echo "📥 Updating dependencies..."
        pip install -r requirements.txt
        touch venv
    fi
fi

# Start FastAPI
echo "✅ Backend running on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
