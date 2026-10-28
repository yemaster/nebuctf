FROM python:3.12-slim
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    bash netcat-openbsd curl tmux ca-certificates procps less vim-tiny \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/player && chown 65534:65534 /home/player \
    && printf 'set -g status off\nset -g history-limit 3000\nset -g default-shell /bin/bash\nset -g mouse on\n' > /etc/tmux.conf
ENV HOME=/home/player TERM=xterm-256color LANG=C.UTF-8
WORKDIR /home/player
USER 65534:65534
CMD ["sleep", "infinity"]
