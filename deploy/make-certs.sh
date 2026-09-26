#!/usr/bin/env bash
# Create a private certificate authority and a server certificate signed by it, for serving
# ncosis over HTTPS on a local network without a domain. Install ca.crt on the phone once
# (Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate).
#
#   deploy/make-certs.sh <out-dir> <ip-or-hostname>...
#
# Re-running keeps an existing CA (so the phone stays trusted) and issues a fresh server cert.
set -euo pipefail

out=$1; shift
[ $# -ge 1 ] || { echo "usage: $0 <out-dir> <ip-or-hostname>..." >&2; exit 1; }
mkdir -p "$out" && chmod 700 "$out" && cd "$out"

# The CA may only vouch for private IPs and localhost, never for real domains, so a leaked
# CA key can't be used to impersonate other websites to the phone.
CONSTRAINTS="permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0"
CONSTRAINTS+=",permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0,permitted;DNS:localhost"

if [ ! -f ca.key ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
    -keyout ca.key -out ca.crt -subj "/CN=ncosis local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,$CONSTRAINTS"
fi

san=""
for name in "$@" localhost 127.0.0.1; do
  if [[ $name =~ ^[0-9.]+$ ]]; then san+="IP:$name,"; else san+="DNS:$name,"; fi
done

openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout server.key -out server.csr -subj "/CN=$1"
# 397 days: the longest validity Chrome accepts for a server certificate.
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 397 -out server.crt \
  -extfile <(printf "subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n" "${san%,}")
rm server.csr
chmod 600 ca.key server.key
echo "CA: $out/ca.crt   server: $out/server.crt (valid for: ${san%,})"
