#!/bin/sh
set -e

# Install dependencies if node_modules was mounted empty
if [ ! -f "/app/node_modules/.bin/nest" ]; then
    echo "Installing dependencies..."
    pnpm install
    pnpm prisma generate
fi

# Clean build when src is mounted (files may differ from image)
echo "Building TypeScript..."
rm -f /app/tsconfig.tsbuildinfo
rm -rf /app/dist
./node_modules/.bin/nest build

# Run the dev server with watch mode
exec ./node_modules/.bin/nest start --watch
