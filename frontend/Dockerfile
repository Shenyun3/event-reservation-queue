# Frontend multi-stage image: Node 26.13.1 Vite build -> Nginx 1.27 static + /api proxy
FROM node:26.13.1-slim AS builder

WORKDIR /app

# Node 26 官方镜像已移除内置 corepack，显式通过 npm 锁定与 packageManager 一致的 pnpm@12.21.0
RUN npm install -g pnpm@12.21.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN pnpm install --frozen-lockfile --filter @queue-reservation/frontend...

COPY packages/shared ./packages/shared
COPY frontend ./frontend

RUN pnpm --filter @queue-reservation/frontend build

FROM nginx:1.27-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
