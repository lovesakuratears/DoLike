FROM node:22-slim

ENV CI=true
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 make g++ ffmpeg libasound2 || \
    (sleep 60 && apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ffmpeg libasound2) || \
    (sleep 120 && apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ffmpeg libasound2) || \
    (sleep 180 && apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ffmpeg libasound2) \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY server/package.json server/pnpm-lock.yaml* server/
COPY server/tsconfig.json server/

RUN cd server && pnpm install --frozen-lockfile || pnpm install

COPY server/ server/
RUN cd server && pnpm prisma:generate && pnpm build

RUN npx playwright-core install-deps chromium 2>/dev/null || true
RUN npx playwright-core install chromium 2>/dev/null || true

EXPOSE 3000
CMD ["node", "--import", "tsx/esm", "server/dist/main.js"]
