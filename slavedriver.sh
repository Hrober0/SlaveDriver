#!/usr/bin/env bash
# Start SlaveDriver in the background (Linux). Make executable: chmod +x slavedriver.sh
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ ! -x node_modules/electron/dist/electron ] || [ ! -d node_modules/dbus-next ] || [ ! -d node_modules/esbuild ]; then
  echo "First run: installing dependencies..."
  npm install || exit 1
fi
# Rebuild from src/ every start (takes well under a second) so a git pull is always picked up.
node scripts/build.mjs || exit 1
unset ELECTRON_RUN_AS_NODE
nohup node_modules/electron/dist/electron . "$@" >/dev/null 2>&1 &
