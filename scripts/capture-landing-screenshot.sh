#!/usr/bin/env bash
set -euo pipefail

paths=(
  "$(nix eval --raw nixpkgs#glib.out)/lib"
  "$(nix eval --raw nixpkgs#libXfixes.out)/lib"
  "$(nix eval --raw nixpkgs#nspr.out)/lib"
  "$(nix eval --raw nixpkgs#nss.out)/lib"
  "$(nix eval --raw nixpkgs#atk.out)/lib"
  "$(nix eval --raw nixpkgs#cairo.out)/lib"
  "$(nix eval --raw nixpkgs#pango.out)/lib"
  "$(nix eval --raw nixpkgs#gdk-pixbuf.out)/lib"
  "$(nix eval --raw nixpkgs#gtk3.out)/lib"
  "$(nix eval --raw nixpkgs#dbus.lib)/lib"
  "$(nix eval --raw nixpkgs#cups.lib)/lib"
  "$(nix eval --raw nixpkgs#expat.out)/lib"
  "$(nix eval --raw nixpkgs#libxcb.out)/lib"
  "$(nix eval --raw nixpkgs#libxkbcommon.out)/lib"
  "$(nix eval --raw nixpkgs#libX11.out)/lib"
  "$(nix eval --raw nixpkgs#libXcomposite.out)/lib"
  "$(nix eval --raw nixpkgs#libXdamage.out)/lib"
  "$(nix eval --raw nixpkgs#libXext.out)/lib"
  "$(nix eval --raw nixpkgs#libXrandr.out)/lib"
  "$(nix eval --raw nixpkgs#libgbm.out)/lib"
  "$(nix eval --raw nixpkgs#alsa-lib.out)/lib"
)

LD_JOINED=$(printf "%s:" "${paths[@]}")
LD_JOINED=${LD_JOINED%:}

export PLAYWRIGHT_BROWSERS_PATH=".playwright-browsers"
export LD_LIBRARY_PATH="${LD_JOINED}:${LD_LIBRARY_PATH:-}"

start_dev_server() {
  pnpm dev --hostname 127.0.0.1 --port 3000 >/tmp/mockauth-dev.log 2>&1 &
  DEV_PID=$!
  trap 'kill ${DEV_PID} >/dev/null 2>&1 || true' EXIT

  for _ in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3000 >/dev/null; then
      echo "Dev server ready"
      return 0
    fi
    sleep 1
  done

  echo "Dev server failed to become ready" >&2
  return 1
}

main() {
  start_dev_server
  pnpm exec node -e "const path = require('node:path'); const { chromium } = require('playwright'); (async () => { const executablePath = path.resolve('.playwright-browsers', 'chromium-1208', 'chrome-linux', 'chrome'); const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle' }); await page.screenshot({ path: 'docs/marketing/landing-20260305.png', fullPage: true }); await browser.close(); })().catch(err => { console.error(err); process.exit(1); });"
}

main
