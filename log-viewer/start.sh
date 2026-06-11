#!/bin/sh
set -eu

# `RemoteCommand` в ~/.ssh/config для хоста zishka блокирует выполнение
# любых пользовательских команд (включая rsync) с ошибкой
#   "Cannot execute command-line and remote command".
# Подавляем её на одну сессию через `-o RemoteCommand=none`
# (+ выключаем принудительное PTY, иначе rsync пишет в терминал и ломается).

# Обновляем логи с удалённого сервера
echo "[log-viewer] Syncing logs from remote server..."
if rsync -e 'ssh -i /root/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o RemoteCommand=none -o RequestTTY=no' \
  -avz --delete \
  ziware@zishka:/home/ziware/minesweeper-pvp/logs/ \
  logs/; then
  echo "[log-viewer] Log sync complete."
else
  echo "[log-viewer] Log sync failed; starting server without fresh remote logs."
fi

# Запускаем сервер
echo "[log-viewer] Starting server..."
node server.js
