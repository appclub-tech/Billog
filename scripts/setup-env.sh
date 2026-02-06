#!/bin/bash
# Setup script for Billog environment
# Run this on a new machine after cloning the repo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "🔧 Setting up Billog environment..."

# Create .env from .env.example if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Created .env from .env.example"
        echo "⚠️  Please edit .env and fill in your secret values"
    else
        echo "❌ .env.example not found!"
        exit 1
    fi
else
    echo "ℹ️  .env already exists, skipping copy"
fi

# Create symlinks for subprojects
for dir in billog-*/; do
    dir="${dir%/}"  # Remove trailing slash
    if [ -d "$dir" ]; then
        # Remove existing .env if it's not a symlink
        if [ -f "$dir/.env" ] && [ ! -L "$dir/.env" ]; then
            rm "$dir/.env"
            echo "🗑️  Removed existing $dir/.env (was not a symlink)"
        fi

        # Create symlink if it doesn't exist
        if [ ! -L "$dir/.env" ]; then
            ln -s ../.env "$dir/.env"
            echo "✅ Created symlink: $dir/.env -> ../.env"
        else
            echo "ℹ️  Symlink already exists: $dir/.env"
        fi
    fi
done

# Install dependencies for each subproject
echo ""
echo "📦 Installing dependencies..."

for dir in billog-*/; do
    dir="${dir%/}"  # Remove trailing slash
    if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
        echo "📦 Installing $dir dependencies..."
        (cd "$dir" && pnpm install)
        echo "✅ $dir dependencies installed"
    fi
done

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your actual secret values (if not done)"
echo "  2. Run: docker compose up -d --build"
