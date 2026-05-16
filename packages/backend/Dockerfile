FROM node:20-alpine AS builder

WORKDIR /app

# Копируем корневые файлы воркспейса
COPY package.json yarn.lock tsconfig.base.json ./

# Копируем shared и backend
COPY packages/shared/  packages/shared/
COPY packages/backend/ packages/backend/

# Устанавливаем все зависимости воркспейса
RUN yarn install --frozen-lockfile

# Собираем shared
WORKDIR /app/packages/shared
RUN yarn tsc --outDir dist --rootDir src || true

# Собираем backend
WORKDIR /app/packages/backend
RUN yarn tsc

# ─── Production образ ───────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/  packages/shared/
COPY packages/backend/ packages/backend/

RUN yarn install --frozen-lockfile --production

# Копируем скомпилированный backend
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/shared/dist  ./packages/shared/dist

EXPOSE 3001

CMD ["node", "packages/backend/dist/index.js"]
