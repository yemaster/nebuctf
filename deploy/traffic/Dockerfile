FROM node:24.14-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tcpdump && rm -rf /var/lib/apt/lists/*
COPY capture.mjs /capture.mjs
ENTRYPOINT ["node", "--max-old-space-size=16", "/capture.mjs"]
