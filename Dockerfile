# Stage 1: Build the frontend application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build-time environment variables for Vite
# These are embedded in the client bundle and visible in browser
ARG VITE_ZITADEL_ISSUER=https://liverty-music-dev-b4bclr.zitadel.cloud
ARG VITE_ZITADEL_CLIENT_ID=293623653829906440@liverty-music
ENV VITE_ZITADEL_ISSUER=$VITE_ZITADEL_ISSUER
ENV VITE_ZITADEL_CLIENT_ID=$VITE_ZITADEL_CLIENT_ID

# Build the application
RUN npm run build

#----------------------------

# Stage 2: Serve with Caddy
FROM caddy:2-alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /srv

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Expose port 80
EXPOSE 80
