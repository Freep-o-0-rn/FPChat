FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN corepack enable
RUN pnpm install
COPY . .
CMD ["pnpm", "dev", "--host", "0.0.0.0"]