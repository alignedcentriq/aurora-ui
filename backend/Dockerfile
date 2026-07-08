# Pinned to bookworm (Debian 12) so the Microsoft ODBC packages below resolve cleanly.
FROM python:3.11-slim-bookworm

WORKDIR /backend

# Base build deps + Microsoft ODBC Driver 18 for SQL Server (needed by pyodbc to reach
# the eSSL biometric attendance DB; without it every attendance lookup fails and the app
# silently reports everyone Absent). We write the apt source line directly (one options
# bracket) instead of sed-editing Microsoft's prod.list, which already ships a
# [arch=… signed-by=…] group — a second bracket makes apt fail with "Malformed entry".
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        gnupg \
        ca-certificates \
        apt-transport-https \
        unixodbc-dev \
    && install -d /usr/share/keyrings \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/12/prod bookworm main" \
        > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN pip install --no-cache-dir -e .

RUN chmod +x entrypoint.sh
CMD ["sh", "entrypoint.sh"]
