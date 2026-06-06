#!/bin/bash
# Phase 0 — server topology inspection for Centriq AI deployment.
# Run ON THE SERVER: bash scripts/inspect.sh
# Paste the full output back so the routing branch (A/B/C/D) can be finalized.

echo "=== 1. Ports 80/443 listeners ==="
sudo ss -ltnp | grep -E ':80 |:443 ' 2>/dev/null || ss -ltnp | grep -E ':80 |:443 ' 2>/dev/null || echo "(ss not available)"

echo ""
echo "=== 2. Host nginx status ==="
systemctl is-active nginx 2>/dev/null || echo "(not running via systemd)"
nginx -v 2>&1 || echo "(nginx not in PATH)"

echo ""
echo "=== 3. nginx config dirs ==="
ls /etc/nginx/sites-enabled/ 2>/dev/null && echo "--- sites-enabled above ---" || echo "(no sites-enabled)"
ls /etc/nginx/conf.d/ 2>/dev/null && echo "--- conf.d above ---" || echo "(no conf.d)"

echo ""
echo "=== 4. nginx routing rules (server_name / location / proxy_pass) ==="
sudo grep -rEh 'server_name|^\s+location |proxy_pass' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
    | grep -v '^#' | sort -u \
    || echo "(none — no host nginx or no read access)"

echo ""
echo "=== 5. DNS ==="
dig +short hackathon.alignedautomation.com 2>/dev/null \
    || host hackathon.alignedautomation.com 2>/dev/null \
    || nslookup hackathon.alignedautomation.com 2>/dev/null \
    || echo "(no dig/host/nslookup)"
echo "--- subdomain ---"
dig +short centriq.hackathon.alignedautomation.com 2>/dev/null \
    || echo "(no dig available or not set)"

echo ""
echo "=== 6. Existing TLS certs ==="
sudo ls /etc/letsencrypt/live/ 2>/dev/null || echo "(no /etc/letsencrypt)"

echo ""
echo "=== 7. Running containers + exposed ports ==="
docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null || echo "(docker unavailable or no permission)"

echo ""
echo "=== Done — paste all output into the Claude session. ==="
