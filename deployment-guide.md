# Centriq AI — Deployment Guide (Linux Server via SSH)

The project is fully Dockerized. No manual install of Node or Python needed on the server.

---

## Prerequisites

### 1. Install Docker
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in, then verify:
docker --version && docker compose version
```

---

## Deployment Steps

### 3. Copy the project to the server
From your Windows machine (run in PowerShell or Git Bash):
```bash
rsync -avz --exclude node_modules --exclude .git \
  /c/Users/shivam.sharma/aurora-ui/ \
  user@server-ip:/opt/centriq-ai/
```
Or clone from a git remote:
```bash
git clone <your-repo-url> /opt/centriq-ai
```

### 4. Create `backend/.env`
```bash
cd /opt/centriq-ai
cp backend/.env.example backend/.env
nano backend/.env
```

Key values to configure:
```env
# LLM — set explicitly so Docker resolves correctly (same internal network)
AGENT_BASE_URL=http://ml01.alignedautomation.com:11434/v1
ROUTER_BASE_URL=http://ml01.alignedautomation.com:11434/v1
LLM_BASE_URL=http://ml01.alignedautomation.com:11434/v1

# SMTP — all notifications go to poc@alignedautomation
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
HELPDESK_EMAIL=poc@alignedautomation
ADMIN_EMAIL=poc@alignedautomation
```

> Leave `DATABASE_URL` and `REDIS_URL` blank — `docker-compose.yml` injects the correct Docker-internal values automatically.

### 5. (Optional) Change the app port
By default the app runs on **port 80**. To use a custom port (e.g. 8080), edit `docker-compose.yml`:
```yaml
  nginx:
    ports:
      - "8080:80"   # change 8080 to any port you want
```
Then access the app at `http://server-ip:8080`.

### 6. (Optional) Set a domain name
Edit `nginx/nginx.conf` and update `server_name`:
```nginx
server_name your-domain.com;
```

### 7. Start the stack
```bash
cd /opt/centriq-ai
docker compose up -d --build
```
First build takes ~3–5 minutes. Check status:
```bash
docker compose ps                  # all services should show "Up"
docker compose logs -f backend     # watch backend logs
```

---

## Access Points

| Service       | Default URL                          |
|---------------|--------------------------------------|
| **App**       | `http://server-ip` (or custom port)  |
| Langfuse      | `http://server-ip:3003`              |
| MinIO console | `http://server-ip:9001` (minioadmin/minioadmin) |

---

## Day-to-Day Commands

```bash
# Rebuild and restart after a code change
docker compose up -d --build

# Rebuild only the backend
docker compose up -d --build backend

# Rebuild only the frontend
docker compose up -d --build frontend

# View logs (all services)
docker compose logs -f

# View logs for a specific service
docker compose logs -f backend

# Stop everything (keeps data volumes)
docker compose down

# Stop and wipe all data (full reset)
docker compose down -v
```

---

## Changing the App Port — Quick Reference

Edit the `nginx` service ports in `docker-compose.yml`:

| Want to access on | Set ports to     |
|-------------------|------------------|
| Port 80 (default) | `"80:80"`        |
| Port 8080         | `"8080:80"`      |
| Port 3000         | `"3000:80"`      |
| Port 443 (HTTPS)  | `"443:80"`       |

Then restart nginx:
```bash
docker compose up -d nginx
```
