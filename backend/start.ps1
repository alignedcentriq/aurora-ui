Write-Host "Starting Centriq AI Backend..."

if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

Write-Host "Activating virtual environment and installing dependencies..."
. .\venv\Scripts\Activate.ps1
pip install -r requirements.txt

Write-Host "Backend running on http://localhost:8080"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
