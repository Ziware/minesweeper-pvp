#!/bin/sh
# Entrypoint для nginx-контейнера frontend.
#
# Логика:
#   1. Подставляет ${DOMAIN} в шаблон nginx.conf.template → /etc/nginx/conf.d/default.conf.
#   2. Если сертификата ещё нет (первый запуск), временно подменяет конфиг
#      на bootstrap-вариант (только HTTP + ACME challenge на 80-м порту).
#      Это нужно, чтобы certbot мог выпустить сертификат через http-01.
#   3. Запускает nginx в foreground с обработчиком SIGHUP — это позволяет
#      certbot после обновления сертификата сделать `docker exec nginx -s reload`.
#
# Переменные окружения:
#   DOMAIN — основной домен (например, example.com). ОБЯЗАТЕЛЬНА.

set -e

: "${DOMAIN:?env DOMAIN is required (the public domain name, e.g. example.com)}"

CONF_DIR=/etc/nginx/conf.d
TEMPLATE=/etc/nginx/templates/nginx.conf.template
BOOTSTRAP=/etc/nginx/templates/nginx.bootstrap.conf
CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

mkdir -p /var/www/certbot

if [ -f "$CERT_FILE" ]; then
    echo "[entrypoint] certificate found at $CERT_FILE, applying HTTPS config for $DOMAIN"
    envsubst '${DOMAIN}' < "$TEMPLATE" > "$CONF_DIR/default.conf"
else
    echo "[entrypoint] no certificate at $CERT_FILE yet — starting with HTTP-only bootstrap config"
    echo "[entrypoint] run './init-letsencrypt.sh' on the host to obtain the certificate, then \`docker compose restart frontend\`"
    cp "$BOOTSTRAP" "$CONF_DIR/default.conf"
fi

# Фоновая задача: каждые 6 часов проверяем обновление сертификата и шлём nginx SIGHUP,
# чтобы он перечитал новые файлы. Сам выпуск/обновление делает контейнер certbot.
(
    while :; do
        sleep 21600
        if [ -f "$CERT_FILE" ]; then
            nginx -s reload 2>/dev/null || true
        fi
    done
) &

exec nginx -g 'daemon off;'
