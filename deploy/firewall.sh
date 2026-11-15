#!/bin/sh
# Run explicitly as root on a dedicated Linux Docker host, using Docker's iptables backend.
# This controls initiated traffic from challenge bridges, while allowing established replies.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root on the Docker worker host.' >&2; exit 1; }
iptables -nL DOCKER-USER >/dev/null
iptables -N NEBUCTF-EGRESS 2>/dev/null || true
iptables -F NEBUCTF-EGRESS
iptables -A NEBUCTF-EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Permit only L2 forwarding inside the same instance bridge; routed egress still drops.
iptables -A NEBUCTF-EGRESS -m physdev --physdev-is-bridged -j RETURN
iptables -A NEBUCTF-EGRESS -j DROP
iptables -C DOCKER-USER -i 'nctf-+' -j NEBUCTF-EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -i 'nctf-+' -j NEBUCTF-EGRESS
iptables -C DOCKER-USER -i 'nctd-+' -j NEBUCTF-EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -i 'nctd-+' -j NEBUCTF-EGRESS
iptables -C INPUT -i 'nctf-+' -j NEBUCTF-EGRESS 2>/dev/null || iptables -I INPUT 1 -i 'nctf-+' -j NEBUCTF-EGRESS
iptables -C INPUT -i 'nctd-+' -j NEBUCTF-EGRESS 2>/dev/null || iptables -I INPUT 1 -i 'nctd-+' -j NEBUCTF-EGRESS
printf '%s\n' 'Instance-local bridge communication is allowed; challenge-initiated routed IPv4 traffic is blocked.'
