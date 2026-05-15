# Stage 1: Build the frontend application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code (including .env files)
COPY . .

# Vite mode selector — controls which `.env.<mode>` overlay file is loaded
# on top of the base `.env` at build time. Defaults to empty (Vite's
# built-in `production` mode, which loads only `.env`). The prod CI path
# passes `--build-arg VITE_MODE=prod` to load `.env.prod` overlay (apex
# API URL, prod OIDC issuer + client_id + org_id, prod VAPID public key,
# `info` log level). See OpenSpec change `prepare-prod-service-in` D2.
ARG VITE_MODE=""

# Build the application. When VITE_MODE is unset (= dev path), this is
# `npm run build` (Vite defaults to mode=production but no `.env.production`
# file exists so only `.env` is loaded). When VITE_MODE=prod, this becomes
# `npm run build -- --mode prod`, loading `.env` + `.env.prod`.
RUN if [ -n "$VITE_MODE" ]; then npm run build -- --mode "$VITE_MODE"; else npm run build; fi

#----------------------------

# Stage 2: Serve with Caddy
FROM caddy:2-alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /srv

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Expose port 80
EXPOSE 80
