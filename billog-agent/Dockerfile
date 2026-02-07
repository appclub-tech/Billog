# ===========================================
# Billog Agent - Mastra AI Bookkeeper
# ===========================================

FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ===========================================
# Dependencies Stage
# ===========================================
FROM base AS deps

# Install git (required for baileys transitive dependency)
RUN apk add --no-cache git

# Copy package files and npmrc
COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY .npmrc* ./

# Install all dependencies (including dev for mastra CLI)
RUN pnpm install --prod=false

# ===========================================
# Build Stage
# ===========================================
FROM base AS builder

WORKDIR /app

# Install git (required for transitive deps like baileys during build)
RUN apk add --no-cache git

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build TypeScript (custom server)
RUN pnpm build

# Prune dev dependencies (mastra CLI is now in dependencies)
RUN pnpm prune --prod

# ===========================================
# Production Stage
# ===========================================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mastra

# Create data directory for libsql database (persists agent memory/state)
RUN mkdir -p /app/data && chown mastra:nodejs /app/data
VOLUME /app/data

# Create uploads directory for images (receipts, etc.)
RUN mkdir -p /app/uploads && chown mastra:nodejs /app/uploads
VOLUME /app/uploads

# Copy built output
COPY --from=builder --chown=mastra:nodejs /app/dist ./dist
COPY --from=builder --chown=mastra:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=mastra:nodejs /app/package.json ./

USER mastra

EXPOSE 3000

# Health check endpoint (no /api prefix)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server (runs both custom server + mastra)
CMD ["node", "dist/server.js"]
