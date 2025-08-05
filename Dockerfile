# Build stage
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling and security updates
RUN apk add --no-cache dumb-init && \
    apk update && apk upgrade

# Create app directory
WORKDIR /usr/src/app

# Create non-root user with specific UID/GID for Podman compatibility
RUN addgroup -g 1001 -S keypilot && \
    adduser -S keypilot -u 1001 -G keypilot

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/scripts ./scripts

# Create logs directory with proper permissions
RUN mkdir -p logs && \
    chown -R keypilot:keypilot /usr/src/app

# Switch to non-root user
USER keypilot

# Expose port
EXPOSE 3000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node scripts/health-check.js || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
