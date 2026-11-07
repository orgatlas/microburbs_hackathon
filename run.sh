#!/usr/bin/env bash
# Starts everything for local work: the proxy (3000), Django (8001) and the website (3001).
# Usage: ./run.sh    Stop with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS=()

port_busy() {
  lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

# npm and Next start child processes, so stop those too.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null || true
}

stop_all() {
  trap - EXIT INT TERM
  echo
  echo "Stopping servers..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap stop_all EXIT INT TERM

# start NAME PORT DIR COMMAND...: prefixes each output line with the server's name.
start() {
  local name="$1" port="$2" dir="$3"
  shift 3
  if port_busy "$port"; then
    echo "[$name] Port $port is already in use, so this one is skipped."
    return
  fi
  (cd "$ROOT/$dir" && exec "$@") > >(sed -u "s/^/[$name] /") 2>&1 &
  PIDS+=("$!")
}

# First-run setup
if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "Setting up the Django environment..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
"$ROOT/backend/.venv/bin/python" "$ROOT/backend/manage.py" migrate --noinput >/dev/null

for dir in proxy frontend; do
  if [ ! -d "$ROOT/$dir/node_modules" ]; then
    echo "Installing $dir packages..."
    npm --prefix "$ROOT/$dir" install --silent
  fi
done

if [ ! -f "$ROOT/proxy/.env" ]; then
  echo "Warning: proxy/.env is missing. Copy proxy/.env.example and add the team key."
fi

start proxy 3000 proxy npm start
start django 8001 backend .venv/bin/python manage.py runserver 8001 --noreload
start website 3001 frontend npm run dev

echo
echo "Website:   http://localhost:3001"
echo "Django:    http://localhost:8001/api/health"
echo "Proxy:     http://localhost:3000"
echo "Press Ctrl+C to stop."
echo

wait
