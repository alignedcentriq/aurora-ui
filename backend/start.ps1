Write-Host "🚀 Starting Centriq AI Backend..." -ForegroundColor Cyan

if (-not (Test-Path "venv")) {
    Write-Host "📦 Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

Write-Host "📥 Activating virtual environment and installing dependencies..." -ForegroundColor Yellow
.\venv\Scripts\activate
pip install -r requirements.txt

Write-Host "✅ Backend running on http://localhost:8000" -ForegroundColor Green
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
