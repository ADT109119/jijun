FROM node:20-alpine AS base

WORKDIR /app

# Copy package files
COPY package.json ./

# Install production dependencies only (no wrangler needed for standalone)
RUN npm install --omit=dev 2>/dev/null; exit 0

# Copy source code
COPY src/ ./src/

# Expose default port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/api/health || exit 1

# Run standalone server
CMD ["node", "src/standalone.js"]
