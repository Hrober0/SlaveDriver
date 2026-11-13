#!/usr/bin/env bash
# Start SlaveDriver in the background (Linux). Make executable: chmod +x slavedriver.sh
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if [ ! -x node_modules/electron/dist/electron ] || [ ! -d node_modules/dbus-next ]; then
  echo "First run: installing dependencies..."
  npm install || exit 1
fi
unset ELECTRON_RUN_AS_NODE
nohup node_modules/electron/dist/electron . "$@" >/dev/null 2>&1 &
