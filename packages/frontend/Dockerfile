FROM node:20-alpine AS builder

WORKDIR /app

# Копируем корневые файлы
COPY package.json yarn.lock tsconfig.base.json ./

# Копируем shared, frontend и общие ассеты
COPY packages/shared/   packages/shared/
COPY packages/frontend/ packages/frontend/
COPY packages/content/  packages/content/

# Устанавливаем зависимости
RUN yarn install --frozen-lockfile

# Собираем frontend (Vite)
WORKDIR /app/packages/frontend
RUN yarn build

# ─── Production: раздаём через nginx ────────────────────────
FROM nginx:alpine AS production

# envsubst для подстановки ${DOMAIN} в nginx-конфиг
RUN apk add --no-cache gettext

# Копируем собранный dist
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Шаблон production-конфига, bootstrap-конфиг и HTTP-only конфиг (IS_DEBUG режим)
COPY packages/frontend/nginx.conf.template     /etc/nginx/templates/nginx.conf.template
COPY packages/frontend/nginx.bootstrap.conf    /etc/nginx/templates/nginx.bootstrap.conf
COPY packages/frontend/nginx.conf              /etc/nginx/templates/nginx.http.conf
COPY packages/frontend/docker-entrypoint.sh    /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/docker-entrypoint.sh"]
