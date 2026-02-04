#!/bin/sh
set -e

# Check if node_modules needs to be populated (volume may override container's node_modules)
if [ ! -f "/app/node_modules/.bin/nest" ]; then
    echo "Installing dependencies..."
    pnpm install
    pnpm prisma generate
fi

# Build TypeScript if dist doesn't exist
if [ ! -f "/app/dist/main.js" ]; then
    echo "Building TypeScript..."
    rm -f /app/tsconfig.tsbuildinfo
    rm -rf /app/dist
    ./node_modules/.bin/nest build
fi

# Start NestJS in watch mode
exec ./node_modules/.bin/nest start --watch
