FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages/shared/  packages/shared/
COPY packages/backend/ packages/backend/

RUN yarn install --frozen-lockfile

WORKDIR /app/packages/backend
RUN yarn tsc

RUN find /app/packages/backend/dist -type f -name "*.js"

# ─── Production образ ───────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json yarn.lock ./
COPY packages/shared/  packages/shared/
COPY packages/backend/ packages/backend/

RUN yarn install --frozen-lockfile --production

COPY --from=builder /app/packages/backend/dist/ ./packages/backend/dist/

EXPOSE 3001

# Путь зависит от rootDir — запусти builder debug чтобы увидеть точный путь
CMD ["node", "packages/backend/dist/backend/src/index.js"]
