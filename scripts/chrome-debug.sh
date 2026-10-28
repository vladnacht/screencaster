#!/usr/bin/env bash
# Start Google Chrome with a remote-debugging port so demo-capture can list and record its tabs.
# Chrome refuses remote debugging on the default profile (since v136), so this uses a dedicated
# profile in ~/.screencaster/chrome-profile: sign in there once, the session is kept.
#
# Usage: scripts/chrome-debug.sh [url ...]      (PORT=9222 by default)
set -euo pipefail

PORT="${PORT:-9222}"
PROFILE="${SCREENCASTER_CHROME_PROFILE:-$HOME/.screencaster/chrome-profile}"
mkdir -p "$PROFILE"

if curl -fs "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "Chrome écoute déjà sur le port $PORT."
  exit 0
fi

case "$(uname -s)" in
  Darwin)
    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ;;
  *)
    CHROME="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || true)"
    ;;
esac
CHROME="${SCREENCASTER_CHROME:-$CHROME}"
if [[ -z "$CHROME" || ! -x "$CHROME" ]]; then
  echo "Chrome introuvable. Définis SCREENCASTER_CHROME vers son exécutable." >&2
  exit 1
fi

"$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check "$@" >/dev/null 2>&1 &

for _ in $(seq 1 50); do
  if curl -fs "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "Chrome prêt sur http://127.0.0.1:$PORT (profil : $PROFILE)."
    exit 0
  fi
  sleep 0.2
done
echo "Chrome n'a pas ouvert le port $PORT." >&2
exit 1
