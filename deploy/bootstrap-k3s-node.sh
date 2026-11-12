#!/bin/sh
# Debian 13, single amd64 node. Run explicitly as root before deploying workloads.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root.' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'This pinned air-gap bundle is amd64 only.' >&2; exit 1; }
node_name=${NODE_NAME:-tencent-sh}
set -- $(hostname -I)
node_ip=${NODE_IP:-$1}
version='v1.37.2+k3s1'
release='https://github.com/k3s-io/k3s/releases/download/v1.37.2%2Bk3s1'
binary_sha=265b3ee6a3198ef14033c63ef46cbb32370d83795199fb6d1b01f21575eddbda
images_sha=35a5af1e69b57b8b627a4f6b1c29ea104209b661067b8c97fd40dc3f860bfcd2
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -e /etc/rancher/k3s/config.yaml ] && [ ! -e /etc/rancher/k3s/nebuctf-managed ]; then
  echo 'Existing unmanaged k3s config: review and merge manually; refusing overwrite.' >&2
  exit 1
fi
if [ -e /etc/docker/daemon.json ] && [ ! -e /etc/docker/nebuctf-managed ]; then
  echo 'Existing unmanaged Docker config: review address pools before bootstrap.' >&2
  exit 1
fi
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker.io docker-cli docker-compose curl ca-certificates jq iptables rsync xz-utils
modprobe overlay
modprobe br_netfilter
install -d /etc/sysctl.d /etc/docker /etc/rancher/k3s /var/lib/rancher/k3s/agent/images
cat > /etc/sysctl.d/90-nebuctf.conf <<'EOF'
net.ipv4.ip_forward=1
net.bridge.bridge-nf-call-iptables=1
net.bridge.bridge-nf-call-ip6tables=1
EOF
sysctl -p /etc/sysctl.d/90-nebuctf.conf
if [ ! -e /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "default-address-pools": [{ "base": "172.24.0.0/16", "size": 24 }],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  systemctl restart docker
fi
install -d -m 0750 /srv/nebuctf /srv/platform
install -d -m 0750 -o 1000 -g 1000 /srv/nebuctf/data /srv/nebuctf/traffic
install -d -m 0750 -o 101 -g 101 /srv/nebuctf/web-assets
install -d -m 0700 -o 70 -g 70 /srv/platform/postgres
install -d /usr/local/lib/nebuctf /etc/systemd/system/docker.service.d
install -m 0755 "$script_dir/firewall.sh" /usr/local/lib/nebuctf/firewall.sh
install -m 0755 "$script_dir/k3s-host-firewall.sh" /usr/local/lib/nebuctf/k3s-host-firewall.sh
cat > /etc/systemd/system/docker.service.d/nebuctf-firewall.conf <<'EOF'
[Service]
ExecStartPost=/usr/local/lib/nebuctf/k3s-host-firewall.sh
EOF
/usr/local/lib/nebuctf/k3s-host-firewall.sh
: > /etc/docker/nebuctf-managed
needs_binary=true
if [ -x /usr/local/bin/k3s ]; then
  case "$(/usr/local/bin/k3s --version)" in
    "k3s version $version "*) needs_binary=false ;;
  esac
fi
if "$needs_binary"; then
  curl -fL --retry 1 --connect-timeout 10 --speed-time 30 --speed-limit 10240 --max-time 900 "$release/k3s" -o /var/tmp/nebuctf-k3s
  printf '%s  %s\n' "$binary_sha" /var/tmp/nebuctf-k3s | sha256sum -c -
  install -m 0755 /var/tmp/nebuctf-k3s /usr/local/bin/k3s
fi
images=/var/lib/rancher/k3s/agent/images/k3s-airgap-images-amd64.tar.zst
if [ ! -f "$images" ]; then
  curl -fL --retry 1 --connect-timeout 10 --speed-time 30 --speed-limit 10240 --max-time 900 "$release/k3s-airgap-images-amd64.tar.zst" -o "$images.partial"
  printf '%s  %s\n' "$images_sha" "$images.partial" | sha256sum -c -
  mv "$images.partial" "$images"
else
  printf '%s  %s\n' "$images_sha" "$images" | sha256sum -c -
fi
umask 077
cat > /etc/rancher/k3s/config.yaml <<EOF
node-name: $node_name
node-ip: $node_ip
bind-address: 0.0.0.0
cluster-cidr: 10.42.0.0/16
service-cidr: 10.43.0.0/16
write-kubeconfig-mode: '0600'
secrets-encryption: true
disable:
  - metrics-server
kube-proxy-arg:
  - proxy-mode=iptables
kubelet-arg:
  - 'system-reserved=cpu=200m,memory=256Mi'
  - 'kube-reserved=cpu=300m,memory=512Mi'
  - 'max-pods=64'
  - 'eviction-hard=memory.available<150Mi,nodefs.available<10%,imagefs.available<10%'
EOF
: > /etc/rancher/k3s/nebuctf-managed
curl -fL --retry 2 --connect-timeout 10 --max-time 60 https://get.k3s.io -o /var/tmp/nebuctf-install-k3s.sh
INSTALL_K3S_SKIP_DOWNLOAD=true sh /var/tmp/nebuctf-install-k3s.sh server
systemctl daemon-reload
systemctl enable docker k3s
k3s kubectl wait --for=condition=Ready node/"$node_name" --timeout=180s
/usr/local/lib/nebuctf/k3s-host-firewall.sh
printf '%s\n' 'Node ready. No application secrets or project workloads have been installed.'
