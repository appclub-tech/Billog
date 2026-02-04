# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm and git (needed for some npm packages)
RUN apt-get update && apt-get install -y git --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

# Copy prisma schema and generate client
COPY prisma ./prisma/
RUN pnpm prisma generate

# Copy source code
COPY . .

# Build TypeScript (NestJS)
RUN pnpm build

# Production stage
FROM node:20-slim AS runner

# Install git (needed for Baileys dependency) and fonts for international text
RUN apt-get update && apt-get install -y \
    git \
    fonts-thai-tlwg \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod

# Copy prisma schema and generate client (using dlx to avoid installing prisma CLI)
COPY --from=builder /app/prisma ./prisma
RUN pnpm dlx prisma@6.3.0 generate

# Copy built files
COPY --from=builder /app/dist ./dist

# Create data directory for WhatsApp auth
RUN mkdir -p ./data/sessions

# Set environment
ENV NODE_ENV=production
ENV PORT=8000

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Run NestJS application
CMD ["node", "dist/main.js"]
