#!/usr/bin/env bash
# Build and deploy this game's server to the shared demos box.
#   https://demos.colyseus.cloud/one-prompt-game
#
# Same layout as the other demos (see demos/ops): each owns a decade of ports so
# nginx can route /<slug>/<port>/ at an exact socket. Only the constants differ.
#
set -euo pipefail
cd "$(dirname "$0")/.."

# ── per-demo constants ────────────────────────────────────────────────
SLUG=one-prompt-game
APP=one-prompt-game
BASE=113        # NODE_APP_INSTANCE base -> first socket 2567+BASE (2680)
INSTANCES=1     # MUST match ecosystem.config.cjs
RESERVE=10      # size of this demo's port decade (2680-2689), for stale-app cleanup
# ──────────────────────────────────────────────────────────────────────

HOST="${DEPLOY_HOST:-deploy@91.99.200.149}"
APP_DIR="/home/deploy/apps/$APP"
ENDPOINT="https://demos.colyseus.cloud/$SLUG"
SRC_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

npm run build
[ -f dist/server/server.mjs ] || { echo "error: dist/server/server.mjs missing after build" >&2; exit 1; }

echo "--- syncing app"
ssh "$HOST" "mkdir -p $APP_DIR/dist"
rsync -az --delete --exclude .DS_Store dist/server/ "$HOST:apps/$APP/dist/server/"
rsync -az package.json package-lock.json ecosystem.config.cjs "$HOST:apps/$APP/"

echo "--- installing runtime deps"
ssh "$HOST" "cd $APP_DIR && npm ci --omit=dev --ignore-scripts --no-audit --no-fund"

echo "--- pm2: $SLUG-0..$((INSTANCES-1))  (sockets $((2567+BASE))..$((2567+BASE+INSTANCES-1)))"
# NOT colyseus-post-deploy: it rewrites every demo's nginx upstream and can
# `pm2 delete all`, taking the other demos down with it.
ssh "$HOST" "set -e
  cd $APP_DIR
  for i in \$(seq $INSTANCES $((RESERVE-1))); do pm2 delete ${SLUG}-\$i >/dev/null 2>&1 || true; done
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save"

echo "--- publishing nginx upstream list"
ssh "$HOST" "set -e
  f=/etc/nginx/colyseus_upstreams/$SLUG.conf
  : > \$f.tmp
  for i in \$(seq 0 $((INSTANCES-1))); do
    echo \"server unix:/run/colyseus/\$((2567 + $BASE + i)).sock;\" >> \$f.tmp
  done
  mv \$f.tmp \$f"   # atomic; fswatch on the dir runs `nginx -t && systemctl reload nginx`

echo "--- health check"
for _ in $(seq 1 30); do
  curl -fsS --max-time 5 "$ENDPOINT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 "$ENDPOINT/health" || { echo "error: $ENDPOINT/health never came up" >&2; exit 1; }
echo

echo "Deployed $SLUG@$SRC_SHA -> $ENDPOINT"
