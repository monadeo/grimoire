#!/usr/bin/env sh
# Grimoire CLI installer (Linux/macOS) — npm-only.
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Grimoire requires Node.js 24 or newer."
  echo "Install it from https://nodejs.org (or your package manager), then run:"
  echo "  npm install -g @monadeo/grimoire-cli"
  exit 1
fi

echo "Installing @monadeo/grimoire-cli via npm..."
npm install -g @monadeo/grimoire-cli
echo "Done. Run: grimoire login"
