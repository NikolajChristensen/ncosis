#!/usr/bin/env bash
# Installs or updates the checked-out version in /opt/ncosis and restarts the service.
# Runs automatically after `git push lxc master`; safe to run by hand as root.
set -euo pipefail

APP=/opt/ncosis
DATA=/var/lib/ncosis
cd "$APP"
echo "==> Deploying $(cat VERSION 2>/dev/null || echo unknown version)"

echo "==> Backend"
[ -d backend/.venv ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install -q --disable-pip-version-check -e backend

echo "==> Frontend"
# Reinstall packages only when the lockfile changed; that's the slow part.
lock=$(sha256sum web/package-lock.json | cut -d' ' -f1)
if [ ! -d web/node_modules ] || [ "$lock" != "$(cat web/node_modules/.lock-sha 2>/dev/null)" ]; then
  (cd web && npm ci --no-audit --no-fund --loglevel=error)
  echo "$lock" > web/node_modules/.lock-sha
fi
(cd web && npm run build --silent >/dev/null)

# (Re)issue the server certificate if there is none or the container's IP changed.
ip=$(hostname -I | awk '{print $1}')
if ! openssl x509 -in "$DATA/tls/server.crt" -noout -checkip "$ip" 2>/dev/null | grep -q "does match"; then
  echo "==> Issuing TLS certificate for $ip"
  deploy/make-certs.sh "$DATA/tls" "$ip"
fi
chown -R ncosis:ncosis "$DATA"

echo "==> Restarting service"
install -m 644 deploy/ncosis.service /etc/systemd/system/ncosis.service
systemctl daemon-reload
systemctl enable -q ncosis
systemctl restart ncosis

for _ in $(seq 30); do
  if version=$(curl -sf --cacert "$DATA/tls/ca.crt" https://localhost/api/config); then
    echo "✅ ncosis is up: $version"
    exit 0
  fi
  sleep 1
done
echo "❌ ncosis did not come up. Recent log:"
journalctl -u ncosis -n 30 --no-pager
exit 1
