FROM node:24.14-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY apps apps
RUN npm run build

FROM node:24.14-bookworm-slim AS runtime-dependencies
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root=false --no-audit --no-fund

FROM node:24.14-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node --from=runtime-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./package.json
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY --chown=nginx:nginx deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/apps/web/dist /usr/share/nginx/html
USER root
RUN mkdir -p /var/cache/nebuctf/assets && chown -R nginx:nginx /var/cache/nebuctf
COPY --chmod=755 deploy/40-asset-archive.sh /docker-entrypoint.d/40-asset-archive.sh
USER nginx
EXPOSE 8080
