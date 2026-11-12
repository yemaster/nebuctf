#!/bin/sh
# IPv4-only k3s and Docker; reapply after Docker/k3s networking starts.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$script_dir/firewall.sh"
# INPUT rules never change SSH or the host's default policy.
iptables -N NEBUCTF-HOST 2>/dev/null || true
iptables -F NEBUCTF-HOST
iptables -A NEBUCTF-HOST -i lo -j RETURN
iptables -A NEBUCTF-HOST -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A NEBUCTF-HOST -s 10.42.0.0/16 -p tcp --dport 6443 -j RETURN
iptables -A NEBUCTF-HOST -p tcp -m multiport --dports 6443,10250,2379,2380 -j REJECT
iptables -A NEBUCTF-HOST -p udp --dport 8472 -j DROP
iptables -A NEBUCTF-HOST -s 172.24.0.0/16 -j NEBUCTF-EGRESS
iptables -C INPUT -j NEBUCTF-HOST 2>/dev/null || iptables -I INPUT 1 -j NEBUCTF-HOST
# Judge/internal bridges also cannot initiate traffic to project data, metadata or management.
iptables -N NEBUCTF-PRIVATE 2>/dev/null || true
iptables -F NEBUCTF-PRIVATE
iptables -A NEBUCTF-PRIVATE -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# Same-network traffic (including domain gateway/checker) remains governed by Docker isolation.
iptables -A NEBUCTF-PRIVATE -d 172.24.0.0/16 -j RETURN
for subnet in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  iptables -A NEBUCTF-PRIVATE -d "$subnet" -j DROP
done
iptables -C DOCKER-USER -s 172.24.0.0/16 -j NEBUCTF-PRIVATE 2>/dev/null || iptables -I DOCKER-USER 1 -s 172.24.0.0/16 -j NEBUCTF-PRIVATE
# Append (never prepend) so Kubernetes NetworkPolicy and Docker isolation run first.
# Docker may set FORWARD's default policy to DROP on this shared node.
iptables -C FORWARD -s 10.42.0.0/16 -j ACCEPT 2>/dev/null || iptables -A FORWARD -s 10.42.0.0/16 -j ACCEPT
iptables -C FORWARD -s 172.31.80.0/24 -d 10.42.0.0/16 -p tcp --dport 5432 -j ACCEPT 2>/dev/null || iptables -A FORWARD -s 172.31.80.0/24 -d 10.42.0.0/16 -p tcp --dport 5432 -j ACCEPT
ip6tables -N NEBUCTF-HOST 2>/dev/null || true
ip6tables -F NEBUCTF-HOST
ip6tables -A NEBUCTF-HOST -i lo -j RETURN
ip6tables -A NEBUCTF-HOST -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
ip6tables -A NEBUCTF-HOST -p tcp -m multiport --dports 6443,10250,2379,2380 -j REJECT
ip6tables -A NEBUCTF-HOST -p udp --dport 8472 -j DROP
ip6tables -C INPUT -j NEBUCTF-HOST 2>/dev/null || ip6tables -I INPUT 1 -j NEBUCTF-HOST
printf '%s\n' 'Control plane and challenge-to-platform isolation applied; SSH/public application ports unchanged.'
