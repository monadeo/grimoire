#!/usr/bin/env sh
# Grimoire CLI installer (Linux/macOS). Prefers npm; falls back to a signed binary.
set -eu

REPO="monadeo/grimoire"

if command -v npm >/dev/null 2>&1; then
  echo "Installing @monadeo/grimoire-cli via npm..."
  npm install -g @monadeo/grimoire-cli
  echo "Done. Run: grimoire login"
  exit 0
fi

os="$(uname -s)"
case "$os" in
  Linux) asset="grimoire-ubuntu-latest" ;;
  Darwin) asset="grimoire-macos-latest" ;;
  *) echo "Unsupported OS: $os — install Node and run: npm i -g @monadeo/grimoire-cli"; exit 1 ;;
esac

dest="${GRIMOIRE_BIN:-/usr/local/bin}/grimoire"
url="https://github.com/${REPO}/releases/latest/download/${asset}"
echo "Downloading $asset ..."
curl -fsSL "$url" -o "$dest"
chmod +x "$dest"
echo "Installed to $dest. Run: grimoire login"
