# Stage 1: Build the frontend application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code (including .env files)
COPY . .

# Build-time environment variables for Vite
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}
ARG VITE_LOG_LEVEL
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}

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
