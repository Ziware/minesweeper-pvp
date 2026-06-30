FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json yarn.lock ./
COPY tsconfig.base.json ./

# Copy packages
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN yarn install --frozen-lockfile

# Copy source files
COPY packages/api ./packages/api
COPY packages/shared ./packages/shared

# Generate Prisma client
RUN yarn workspace @minesweeper-pvp/api db:generate

# Build
RUN yarn workspace @minesweeper-pvp/api build

# ─── Runtime ────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
COPY tsconfig.base.json ./
COPY packages/api/package.json ./packages/api/
COPY packages/shared/package.json ./packages/shared/

RUN yarn install --frozen-lockfile --production

# Copy built output + prisma schema (needed for migrations)
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/src/prisma ./packages/api/src/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

WORKDIR /app/packages/api

EXPOSE 3002

CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/prisma/schema.prisma && node dist/index.js"]
