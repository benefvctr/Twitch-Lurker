#!/usr/bin/env bash
# lowping relay setup — run ON THE VPS as root (Ubuntu/Debian).
#
#   bash setup-server.sh <game-ips>
#   e.g. bash setup-server.sh 203.0.113.10/32,198.51.100.0/24
#
# The game IPs become the client's AllowedIPs: ONLY traffic to those
# addresses uses the tunnel (split tunneling). Everything else on your
# gaming PC keeps using your normal connection.
set -euo pipefail

GAME_IPS="${1:-}"
WG_PORT="${WG_PORT:-51820}"
WG_NET="10.66.66"

if [[ -z "$GAME_IPS" ]]; then
  echo "Usage: $0 <game-ips>"
  echo "  e.g. $0 203.0.113.10/32,198.51.100.0/24"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash setup-server.sh ...)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard curl

umask 077
mkdir -p /etc/wireguard

# Reuse keys on re-run so an existing client config keeps working.
[[ -f /etc/wireguard/server.key ]] || wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
[[ -f /etc/wireguard/client.key ]] || wg genkey | tee /etc/wireguard/client.key | wg pubkey > /etc/wireguard/client.pub

NIC=$(ip -4 route ls default | awk '{print $5; exit}')
SERVER_IP=$(curl -4 -fsS ifconfig.me || hostname -I | awk '{print $1}')

cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = ${WG_NET}.1/24
ListenPort = ${WG_PORT}
PrivateKey = $(cat /etc/wireguard/server.key)
PostUp = iptables -t nat -A POSTROUTING -o ${NIC} -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -o ${NIC} -j MASQUERADE

[Peer]
PublicKey = $(cat /etc/wireguard/client.pub)
AllowedIPs = ${WG_NET}.2/32
EOF

sysctl -qw net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-lowping.conf

systemctl enable --now wg-quick@wg0 >/dev/null
systemctl restart wg-quick@wg0

# Open the port if a firewall is active.
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow "${WG_PORT}/udp" >/dev/null
fi

cat <<EOF

──────────────────────────────────────────────────────────────
 Relay is up. Save everything below as  lowping.conf  and
 import it into the WireGuard app on your gaming PC.
 Only traffic to ${GAME_IPS} will use the tunnel.
──────────────────────────────────────────────────────────────

[Interface]
PrivateKey = $(cat /etc/wireguard/client.key)
Address = ${WG_NET}.2/24

[Peer]
PublicKey = $(cat /etc/wireguard/server.pub)
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = ${GAME_IPS}
PersistentKeepalive = 25
EOF
