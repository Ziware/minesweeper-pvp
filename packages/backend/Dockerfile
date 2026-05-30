FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/  packages/shared/
COPY packages/backend/ packages/backend/

RUN yarn install --frozen-lockfile

# Сначала собираем shared (его dist/ нужен в проде для require('@minesweeper-pvp/shared'))
WORKDIR /app/packages/shared
RUN yarn tsc -b

# Затем собираем backend
WORKDIR /app/packages/backend
RUN yarn tsc

# ─── Production образ ───────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json yarn.lock ./
COPY packages/shared/package.json  packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json

RUN yarn install --frozen-lockfile --production

# Скомпилированный код shared + backend
COPY --from=builder /app/packages/shared/dist/  ./packages/shared/dist/
COPY --from=builder /app/packages/backend/dist/ ./packages/backend/dist/

EXPOSE 3001

CMD ["node", "packages/backend/dist/backend/src/index.js"]
