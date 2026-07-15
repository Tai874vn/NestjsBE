FROM node:22-bookworm-slim AS deps

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV YARN_CACHE_FOLDER=/tmp/yarn-cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive --no-progress --network-timeout 600000 \
    && yarn cache clean

FROM deps AS builder

COPY nest-cli.json prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN yarn prisma generate && yarn nest build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NODE_ENV=production
ENV YARN_CACHE_FOLDER=/tmp/yarn-cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY --from=builder /app ./

EXPOSE 3002

CMD ["node", "dist/src/main.js"]
