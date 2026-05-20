#!/bin/sh
set -e

echo "[backend] running prisma migrate deploy"
pnpm prisma:deploy

echo "[backend] starting app"
node dist/main.js