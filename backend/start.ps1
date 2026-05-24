# Centriq AI Backend Startup Script (Windows Native)

Write-Host "--- Starting Centriq AI Backend Infrastructure ---" -ForegroundColor Cyan
docker compose -f ../docker-compose.yml up -d redis db loki grafana langfuse-server

# Create virtual environment if not exists
if (!(Test-Path "venv")) {
    Write-Host "--- Creating virtual environment ---" -ForegroundColor Yellow
    python -m venv venv
    .\venv\Scripts\activate
    pip install -r requirements.txt
    pip install -e .
} else {
    .\venv\Scripts\activate
}

# Ensure database exists and is initialized
Write-Host "--- Ensuring database is ready ---" -ForegroundColor Yellow
python create_db.py
python init_db_script.py

# Set environment variables
$env:LANGFUSE_OTEL="false"

# Start FastAPI
Write-Host "--- Backend running on http://localhost:8080 ---" -ForegroundColor Green
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload --reload-dir app
