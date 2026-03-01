#!/bin/bash
# release.sh — push current main to GitHub, triggering GHCR image builds
# Usage:
#   ./scripts/release.sh           # push latest main → triggers :latest build
#   ./scripts/release.sh v1.0.0    # push + tag → triggers :v1.0.0 build
set -e

VERSION=$1

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Uncommitted changes present. Commit or stash before releasing."
  exit 1
fi

# Add GitHub remote if not already set
if ! git remote get-url github &>/dev/null; then
  echo "➕ Adding GitHub remote..."
  git remote add github https://github.com/bshandley/pliny.git
fi

echo "🚀 Pushing to GitHub (main)..."
git push github main

if [[ -n "$VERSION" ]]; then
  echo "🏷  Tagging $VERSION..."
  git tag "$VERSION"
  git push github "$VERSION"
  echo "✅ Released $VERSION — GHCR will build ghcr.io/bshandley/pliny-server:$VERSION"
else
  echo "✅ Pushed — GHCR will build ghcr.io/bshandley/pliny-server:latest"
fi

echo ""
echo "Monitor build: https://github.com/bshandley/pliny/actions"
