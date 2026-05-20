FROM node:22-alpine AS base
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json

RUN corepack enable && pnpm install --filter @fpchat/backend... --filter @fpchat/shared... --no-frozen-lockfile

COPY shared ./shared
COPY backend ./backend

RUN pnpm --filter @fpchat/shared build
RUN pnpm --filter @fpchat/backend prisma:generate
RUN pnpm --filter @fpchat/backend build

WORKDIR /app/backend
COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]