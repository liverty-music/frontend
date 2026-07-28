# Stage 1: Build the frontend application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application. No env-specific build-args: the resulting bundle
# is env-agnostic and fetches /config.json at runtime from a per-env K8s
# ConfigMap. See OpenSpec change `adopt-runtime-config-for-frontend`.
RUN npm run build

# Defense-in-depth: assert every route chunk still contains its compiled
# template marker. Catches the class of bug that produced the v1.0.0
# blank-screen regression (template stripping when a build-time toggle
# interacts badly with the Aurelia Vite plugin).
RUN npm run verify:build-templates

# Defense-in-depth: assert the consumer entry (index.html) chunk graph
# references no admin-origin module. Guards the bundle-isolation invariant
# (OpenSpec change `add-admin-console`, design D2) against a stray
# src/ -> admin/ import sneaking admin code into the fan-facing bundle.
RUN npm run verify:bundle-isolation

#----------------------------

# Stage 2: Serve with Caddy
FROM caddy:2-alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /srv

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Expose port 80
EXPOSE 80
