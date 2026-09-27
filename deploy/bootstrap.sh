#!/usr/bin/env bash
# One-time setup of a fresh Debian 13 LXC, run as root. From the laptop:
#   ssh root@<lxc-ip> 'bash -s' < deploy/bootstrap.sh
# Afterwards every `git push lxc master` deploys (see README).
set -euo pipefail

apt-get update
apt-get install -y --no-install-recommends python3 python3-venv ffmpeg git nodejs npm curl ca-certificates

id ncosis >/dev/null 2>&1 || useradd --system --home /var/lib/ncosis --shell /usr/sbin/nologin ncosis
install -d -o ncosis -g ncosis -m 750 /var/lib/ncosis
install -d /opt/ncosis
[ -f /etc/ncosis.env ] || install -m 600 /dev/null /etc/ncosis.env

# Push target. Its hook checks out each push to master into /opt/ncosis and runs the update.
[ -d /srv/ncosis.git ] || git init -q --bare -b master /srv/ncosis.git
cat > /srv/ncosis.git/hooks/post-receive <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
while read -r old new ref; do
  [ "$ref" = refs/heads/master ] || continue
  git --git-dir=/srv/ncosis.git --work-tree=/opt/ncosis checkout -f master
  git --git-dir=/srv/ncosis.git log -1 --date=short --format='%h (%cd)' master > /opt/ncosis/VERSION
  /opt/ncosis/deploy/update.sh
done
HOOK
chmod +x /srv/ncosis.git/hooks/post-receive

echo "Bootstrap done. Next, from the laptop: copy data/CA/token (README), then git push lxc master."
