# Stage 1: Build the frontend application
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# The commit SHA names the PostHog release the source maps are uploaded for.
# It is not env-specific, so the bundle stays env-agnostic.
ARG GIT_SHA=""

# Build the application. No env-specific build-args: the resulting bundle
# is env-agnostic and fetches /config.json at runtime from a per-env K8s
# ConfigMap. See OpenSpec change `adopt-runtime-config-for-frontend`.
#
# When the PostHog key is mounted, the build uploads hidden source maps and
# deletes them (OpenSpec `capture-client-errors`, design D7). The key is a
# BuildKit secret, never a build-arg, so it stays out of the image history;
# without it the build is unchanged.
RUN --mount=type=secret,id=posthog_sourcemap_key,required=false \
	if [ -s /run/secrets/posthog_sourcemap_key ]; then \
		POSTHOG_SOURCEMAP_API_KEY="$(cat /run/secrets/posthog_sourcemap_key)" \
		GIT_SHA="$GIT_SHA" npm run build; \
	else \
		npm run build; \
	fi

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
FROM caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5

# Copy built assets from builder stage
COPY --from=builder /app/dist /srv

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Expose port 80
EXPOSE 80
