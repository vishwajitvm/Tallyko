# syntax=docker/dockerfile:1
# Tallyko web app.
#   target "dev"  : Expo dev server for the web UI (docker-compose.yml)
#   target "prod" : static production build served by Caddy, which also proxies /api to the backend
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV EXPO_NO_TELEMETRY=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS dev
COPY . .
EXPOSE 8081
CMD ["npx", "expo", "start", "--web", "--port", "8081"]

FROM deps AS build
COPY . .
# Same-origin API: the browser calls /api/v1 on whatever domain serves the app
ARG EXPO_PUBLIC_API_URL=/api/v1
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
RUN npx expo export --platform web --output-dir dist

FROM caddy:2.10-alpine AS prod
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80 443
