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

# Копируем собранный dist
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Конфиг nginx с поддержкой SPA и проксирования Socket.IO
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
