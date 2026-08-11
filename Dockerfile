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

FROM deps AS migrator

COPY prisma.config.ts ./
COPY prisma ./prisma

CMD ["yarn", "prisma", "migrate", "deploy"]

FROM deps AS prod-deps

ENV NODE_ENV=production
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

RUN rm -rf node_modules \
    && yarn install --frozen-lockfile --production --non-interactive --no-progress --network-timeout 600000 \
    && yarn cache clean

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system nodejs \
    && useradd --system --gid nodejs nestjs \
    && mkdir -p /app/uploads \
    && chown -R nestjs:nodejs /app

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nestjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --chown=nestjs:nodejs package.json ./
COPY --chown=nestjs:nodejs prisma ./prisma

USER nestjs

EXPOSE 3002

CMD ["node", "dist/src/main.js"]
