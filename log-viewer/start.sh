#!/usr/bin/env bash
set -euo pipefail

# `RemoteCommand` в ~/.ssh/config для хоста zishka блокирует выполнение
# любых пользовательских команд (включая rsync) с ошибкой
#   "Cannot execute command-line and remote command".
# Подавляем её на одну сессию через `-o RemoteCommand=none`
# (+ выключаем принудительное PTY, иначе rsync пишет в терминал и ломается).
rsync -e 'ssh -o RemoteCommand=none -o RequestTTY=no' \
  -avz --delete \
  ziware@zishka:/home/ziware/minesweeper-pvp/logs/ \
  logs/

node server.js