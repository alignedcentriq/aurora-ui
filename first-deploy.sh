#!/bin/bash
# Run this ONCE on the server for the very first deployment.
# After this, use: docker compose up -d --build

set -e

DOMAIN="hackathon.alignedautomation.com"

echo "=== Step 1: Install Loki Docker logging plugin ==="
docker plugin install grafana/loki-docker-driver:latest --alias loki --grant-all-permissions || \
  echo "Plugin already installed, continuing..."

echo ""
echo "=== Step 2: Start all services with HTTP-only nginx (no certs yet) ==="
sudo mkdir -p /var/www/certbot
cp nginx/nginx.conf nginx/nginx.conf.ssl
cp nginx/nginx.nossl.conf nginx/nginx.conf

docker compose up -d --build

echo ""
echo "=== Step 3: Get SSL certificate via certbot webroot ==="
sudo apt-get install -y certbot

sudo certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --non-interactive \
  --agree-tos \
  --email admin@alignedautomation.com \
  -d "$DOMAIN"

echo ""
echo "=== Step 4: Switch to full HTTPS nginx config and reload ==="
cp nginx/nginx.conf.ssl nginx/nginx.conf
rm -f nginx/nginx.conf.ssl
docker compose restart nginx

echo ""
echo "=== Step 5: Init the database ==="
docker compose exec backend python init_db_script.py

echo ""
echo "=== Done! ==="
echo "App:      https://$DOMAIN/centriq"
echo "Grafana:  http://$DOMAIN:3001/dashboards"
echo "Langfuse: http://$DOMAIN:3003"
echo "MinIO:    http://$DOMAIN:9001"
