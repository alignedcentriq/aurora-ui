Write-Host "Starting Centriq AI Backend..." -ForegroundColor Cyan

if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

Write-Host "Activating venv and installing dependencies..." -ForegroundColor Yellow
& .\venv\Scripts\Activate.ps1
pip install -r requirements.txt -q

Write-Host "Backend running on http://localhost:8080" -ForegroundColor Green
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
