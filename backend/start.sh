#!/bin/bash
echo "🚀 Starting Nexus AI Backend..."

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv and install dependencies
source venv/bin/activate
echo "📥 Installing dependencies..."
pip install -r requirements.txt

# Start FastAPI
echo "✅ Backend running on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
