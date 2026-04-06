#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PA_DIR="$ROOT/mpcp-policy-authority"
GW_DIR="$ROOT/mpcp-gateway"
WEB_DIR="$ROOT/mpcp-robotaxi/web"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

cleanup() {
  echo -e "\n${CYAN}Shutting down…${NC}"
  kill $PA_PID $GW_PID $WEB_PID 2>/dev/null || true
  wait $PA_PID $GW_PID $WEB_PID 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
}
trap cleanup EXIT INT TERM

# ── Preflight checks ─────────────────────────────────────────────────────────

for dir in "$PA_DIR" "$GW_DIR" "$WEB_DIR"; do
  if [ ! -d "$dir/node_modules" ]; then
    echo -e "${RED}Missing node_modules in $dir — run npm install first.${NC}"
    exit 1
  fi
done

if [ ! -f "$PA_DIR/.env" ]; then
  echo -e "${RED}PA .env missing — run: cd mpcp-robotaxi && npm run setup${NC}"
  exit 1
fi

if [ ! -f "$WEB_DIR/.env" ]; then
  echo -e "${RED}Web .env missing — run: cd mpcp-robotaxi && npm run setup${NC}"
  exit 1
fi

# ── Kill stale processes on our ports ─────────────────────────────────────────
for port in 3000 3997 3001; do
  pid=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo -e "${CYAN}Killing stale listener on port $port (pid $pid)${NC}"
    kill -9 $pid 2>/dev/null || true
    sleep 0.3
  fi
done

# Gateway needs the XRPL seed from the web .env for real XRPL payments
XRPL_SEED=$(grep '^XRPL_GATEWAY_SEED=' "$WEB_DIR/.env" | cut -d= -f2)

echo -e "${CYAN}
╔══════════════════════════════════════════════════╗
║          mpcp-robotaxi demo — starting           ║
╚══════════════════════════════════════════════════╝${NC}
"

# ── 1. Policy Authority (port 3000) ──────────────────────────────────────────
echo -e "${GREEN}▸ Policy Authority${NC}  → http://localhost:3000"
(cd "$PA_DIR" && npm run dev) &
PA_PID=$!

# ── 2. Trust Gateway (port 3997) ─────────────────────────────────────────────
echo -e "${GREEN}▸ Trust Gateway${NC}     → http://localhost:3997"
(cd "$GW_DIR" && XRPL_GATEWAY_SEED="$XRPL_SEED" MPCP_PA_URL="http://localhost:3000" npm run dev) &
GW_PID=$!

# ── 3. Robotaxi Web App (port 3001) ─────────────────────────────────────────
echo -e "${GREEN}▸ Robotaxi Web App${NC}  → http://localhost:3001"
(cd "$WEB_DIR" && npm run dev) &
WEB_PID=$!

echo -e "
${CYAN}All services started. Press Ctrl+C to stop.${NC}
"

wait
