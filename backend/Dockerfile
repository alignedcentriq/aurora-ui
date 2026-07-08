FROM python:3.11-slim

WORKDIR /backend

# Base build deps + Microsoft ODBC Driver 18 for SQL Server (needed by pyodbc to reach
# the eSSL biometric attendance DB; without it every attendance lookup fails and the app
# silently reports everyone Absent).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        gnupg \
        unixodbc-dev \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list \
        | sed 's#https://#[signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://#' \
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
