#!/usr/bin/env bash
# Install or update ncosis on a Debian 13 LXC. Run as root from the repo checkout:
#   git clone <repo> /opt/ncosis && /opt/ncosis/deploy/install.sh
# Re-run after `git pull` to update.
set -euo pipefail

APP=/opt/ncosis
DATA=/var/lib/ncosis
cd "$APP"

apt-get update
apt-get install -y python3 python3-venv ffmpeg nodejs npm

id ncosis >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin ncosis
install -d -o ncosis -g ncosis "$DATA"

# Backend: CPU-only PyTorch first, so pip doesn't pull the multi-GB CUDA build.
[ -d backend/.venv ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip
backend/.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
backend/.venv/bin/pip install -e backend

# Frontend
(cd web && npm ci && npm run build)

install -m 644 deploy/ncosis.service /etc/systemd/system/ncosis.service
systemctl daemon-reload
systemctl enable ncosis
systemctl restart ncosis
echo "ncosis is running on port 8000. Logs: journalctl -u ncosis -f"
