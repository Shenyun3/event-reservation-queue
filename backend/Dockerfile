# Backend runtime image: Node 26.13.1 + pnpm 12.21.0 + Prisma 7 CLI & tsx
FROM node:26.13.1-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Node 26 官方镜像已移除内置 corepack，显式通过 npm 锁定与 packageManager 一致的 pnpm@12.21.0
RUN npm install -g pnpm@12.21.0

# 拷贝 workspace 清单与锁文件以最大化层缓存命中率
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN pnpm install --frozen-lockfile --filter @queue-reservation/backend...

# 拷贝共享契约与后端源码及 Prisma 迁移脚本
COPY packages/shared ./packages/shared
COPY backend ./backend

# 构建期生成 Prisma 7 客户端（仅提供构建期占位 DATABASE_URL 给 prisma.config.ts）
RUN DATABASE_URL="postgresql://postgres:postgres@localhost:5432/queue_reservation" \
  pnpm --filter @queue-reservation/backend db:generate

ENV PORT=3000
ENV DB_POOL_MAX=30
ENV ENABLE_EXPIRATION_WORKER=true
ENV LOG_LEVEL=info

EXPOSE 3000

# 启动前自动执行 Prisma 迁移部署与幂等 Seed，再用 exec 移交 PID 1 确保容器 SIGTERM 优雅停机
CMD ["sh", "-c", "pnpm --filter @queue-reservation/backend db:migrate && pnpm --filter @queue-reservation/backend db:seed && cd /app/backend && exec ./node_modules/.bin/tsx src/server.ts"]
