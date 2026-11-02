const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
require('reflect-metadata');
require('ts-node/register/transpile-only');

// Fixtures must not inherit a production cache or password file from the shell.
for (const key of [
  'REDIS_URL',
  'AUTH_REDIS_URL',
  'AUTH_REDIS_PASSWORD',
  'AUTH_REDIS_PASSWORD_FILE',
]) {
  delete process.env[key];
}

const prefix = `jobaura-auth-test-${Date.now()}`;
const pgName = `${prefix}-pg`;
const redisName = `${prefix}-redis`;
const password = 'isolated-fixture-password-not-production';
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const mappedPort = (name, port) =>
  docker('port', name, `${port}/tcp`).split(':').at(-1);
async function ready(check) {
  for (let i = 0; i < 60; i++) {
    try {
      if (await check()) return;
    } catch {
      /* The fixture can still be starting. */
    }
    await delay(250);
  }
  throw new Error('Isolated fixture did not become ready');
}

let prisma, pool, raw, authRedis, sessions, app;
let passed = 0;
async function check(name, operation) {
  await operation();
  passed++;
  console.log(`PASS ${name}`);
}

(async () => {
  try {
    docker(
      'run',
      '-d',
      '--name',
      pgName,
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_USER=audit',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=auth_test',
      'postgres:17-alpine',
    );
    docker(
      'run',
      '-d',
      '--name',
      redisName,
      '-p',
      '127.0.0.1::6379',
      'redis:7-alpine',
      'redis-server',
      '--requirepass',
      password,
      '--maxmemory-policy',
      'noeviction',
    );
    await ready(() =>
      docker(
        'exec',
        pgName,
        'pg_isready',
        '-U',
        'audit',
        '-d',
        'auth_test',
      ).includes('accepting connections'),
    );
    const databaseUrl = `postgresql://audit:${password}@127.0.0.1:${mappedPort(pgName, 5432)}/auth_test?schema=public`;
    const redisUrl = `redis://127.0.0.1:${mappedPort(redisName, 6379)}`;
    const migrated = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 90000,
      },
    );
    assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
    const { PrismaClient } = require('@prisma/client');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');
    const { createClient } = require('redis');
    const { JwtService } = require('@nestjs/jwt');
    const { ConfigService } = require('@nestjs/config');
    const {
      AuthSessionService,
      refreshDigest,
    } = require('../src/modules/auth/session/auth-session.service');
    const {
      AuthRedisService,
    } = require('../src/modules/auth/session/auth-redis.service');
    const {
      jwtVerifyOptions,
    } = require('../src/modules/auth/session/auth-jwt.config');
    const bcrypt = require('bcrypt');
    pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 1000,
    });
    pool.on('error', () => {});
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    raw = createClient({ url: redisUrl, password });
    raw.on('error', () => {});
    await raw.connect();
    const config = new ConfigService({
      AUTH_REDIS_URL: redisUrl,
      AUTH_REDIS_PASSWORD: password,
      AUTH_REDIS_COMMAND_TIMEOUT_MS: 100,
      AUTH_REDIS_CONNECT_TIMEOUT_MS: 150,
      JWT_EXPIRES_IN: '10m',
      AUTH_REFRESH_TTL_DAYS: 14,
    });
    authRedis = new AuthRedisService(config);
    await authRedis.onModuleInit();
    const jwt = new JwtService({
      secret: 'isolated-auth-secret-not-a-production-secret',
    });
    sessions = new AuthSessionService(prisma, jwt, authRedis, config);
    const user = await prisma.user.create({
      data: {
        name: 'Auth fixture',
        email: `${randomUUID()}@example.test`,
        password: await bcrypt.hash('OldPassword123', 4),
        role: 'user',
      },
    });
    let initial, rotated;
    await check(
      'login stores SHA-256 only and creates an expiring Redis session',
      async () => {
        initial = await sessions.create(user.id, {
          userAgent: 'integration-fixture',
          ip: '127.0.0.1',
        });
        const row = await prisma.authRefreshToken.findUnique({
          where: { id: initial.refreshToken.split('.')[0] },
        });
        assert.equal(row.tokenHash, refreshDigest(initial.refreshToken));
        assert.equal(row.tokenHash.length, 64);
        assert.ok(!JSON.stringify(row).includes(initial.refreshToken));
        assert.ok((await raw.pTTL(`auth:session:${initial.sessionId}`)) > 0);
      },
    );
    await check(
      'access JWT has bounded lifetime, issuer/audience, sid/jti and no email',
      async () => {
        const claims = jwt.verify(initial.token, jwtVerifyOptions());
        assert.equal(claims.exp - claims.iat, 600);
        assert.equal(claims.sid, initial.sessionId);
        assert.equal(claims.role, 'user');
        assert.ok(claims.jti);
        assert.equal(claims.email, undefined);
      },
    );
    await check(
      'refresh cache miss reads through and rotates canonically',
      async () => {
        const id = initial.refreshToken.split('.')[0];
        await raw.del(`auth:refresh:${id}`);
        rotated = await sessions.refresh(initial.refreshToken);
        assert.notEqual(rotated.refreshToken, initial.refreshToken);
        assert.ok(
          (await prisma.authRefreshToken.findUnique({ where: { id } })).usedAt,
        );
        assert.ok(
          (await raw.pTTL(
            `auth:refresh:${rotated.refreshToken.split('.')[0]}`,
          )) > 0,
        );
      },
    );
    await check(
      'wrong random secret cannot revoke the genuine family',
      async () => {
        const fake = `${rotated.refreshToken.split('.')[0]}.${'A'.repeat(43)}`;
        await assert.rejects(
          sessions.refresh(fake),
          (e) => e.getResponse().code === 'INVALID_REFRESH_TOKEN',
        );
        assert.equal(
          (
            await prisma.authSession.findUnique({
              where: { id: initial.sessionId },
            })
          ).revokedAt,
          null,
        );
      },
    );
    await check(
      'genuine consumed refresh replay revokes family and live access jtis',
      async () => {
        const firstJti = jwt.decode(initial.token).jti;
        await assert.rejects(
          sessions.refresh(initial.refreshToken),
          (e) => e.getResponse().code === 'REFRESH_REUSED',
        );
        assert.ok(
          (
            await prisma.authSession.findUnique({
              where: { id: initial.sessionId },
            })
          ).revokedAt,
        );
        assert.equal(await authRedis.isAccessRevoked(firstJti), true);
        await assert.rejects(
          sessions.refresh(rotated.refreshToken),
          (e) => e.getResponse().code === 'SESSION_REVOKED',
        );
      },
    );
    await check(
      'stale cache warmup cannot resurrect a revoked session',
      async () => {
        await authRedis.writeSession(
          initial.sessionId,
          user.id,
          new Date(Date.now() + 600000),
        );
        await assert.rejects(
          sessions.assertAccessSession(initial.sessionId, user.id),
          (e) => e.getResponse().code === 'SESSION_REVOKED',
        );
      },
    );
    await check(
      'logout revokes only its device, not a second device',
      async () => {
        const a = await sessions.create(user.id);
        const b = await sessions.create(user.id);
        await sessions.logoutToken(a.refreshToken);
        await assert.rejects(
          sessions.assertAccessSession(a.sessionId, user.id),
          (e) => e.getResponse().code === 'SESSION_REVOKED',
        );
        await sessions.assertAccessSession(b.sessionId, user.id);
      },
    );
    await check(
      'logout credential works without an access or refresh cookie',
      async () => {
        const a = await sessions.create(user.id);
        await sessions.logoutCredentialToken(a.logoutToken);
        await assert.rejects(
          sessions.assertAccessSession(a.sessionId, user.id),
        );
      },
    );
    await check(
      'role changes are loaded from PostgreSQL at refresh',
      async () => {
        const a = await sessions.create(user.id);
        await prisma.user.update({
          where: { id: user.id },
          data: { role: 'employer' },
        });
        const b = await sessions.refresh(a.refreshToken);
        assert.equal(jwt.decode(b.accessToken).role, 'employer');
      },
    );
    await check(
      'logout-all increments version and revokes every device',
      async () => {
        await sessions.create(user.id);
        await sessions.logoutAll(user.id);
        assert.equal(
          await prisma.authSession.count({
            where: { userId: user.id, revokedAt: null },
          }),
          0,
        );
        assert.equal(
          (await prisma.user.findUnique({ where: { id: user.id } }))
            .tokenVersion,
          1,
        );
      },
    );
    await check(
      'account deletion invalidates cached admin access before returning',
      async () => {
        const admin = await prisma.user.create({
          data: {
            name: 'Deleted admin fixture',
            email: `${randomUUID()}@example.test`,
            role: 'admin',
          },
        });
        const a = await sessions.create(admin.id);
        await sessions.deleteUser(admin.id);
        assert.equal(
          await prisma.user.findUnique({ where: { id: admin.id } }),
          null,
        );
        await assert.rejects(
          sessions.assertAccessSession(
            a.sessionId,
            admin.id,
            jwt.decode(a.token).jti,
          ),
        );
        assert.equal(
          await authRedis.isAccessRevoked(jwt.decode(a.token).jti),
          true,
        );
      },
    );
    await check(
      'password change updates hash and revokes current sessions atomically',
      async () => {
        const a = await sessions.create(user.id);
        await sessions.changePassword(
          user.id,
          'OldPassword123',
          'NewPassword123',
        );
        const u = await prisma.user.findUnique({ where: { id: user.id } });
        assert.ok(await bcrypt.compare('NewPassword123', u.password));
        await assert.rejects(sessions.refresh(a.refreshToken));
      },
    );
    await check(
      'ban revokes sessions and prevents login/refresh until unbanned',
      async () => {
        const a = await sessions.create(user.id);
        await sessions.setBanned(user.id, true, user.id + 1);
        await assert.rejects(sessions.create(user.id));
        await assert.rejects(sessions.refresh(a.refreshToken));
        await sessions.setBanned(user.id, false, user.id + 1);
        await assert.rejects(sessions.refresh(a.refreshToken));
      },
    );
    await check(
      'concurrent rotation cannot mint two valid successors',
      async () => {
        const a = await sessions.create(user.id);
        const results = await Promise.allSettled([
          sessions.refresh(a.refreshToken),
          sessions.refresh(a.refreshToken),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
        assert.ok(
          (await prisma.authSession.findUnique({ where: { id: a.sessionId } }))
            .revokedAt,
        );
      },
    );
    await check(
      'rate limiting is atomic and every auth key has a TTL',
      async () => {
        for (let i = 0; i < 3; i++)
          assert.equal(
            await authRedis.takeRateLimit('integration', 2, 10000),
            i < 2,
          );
        const keys = [];
        for await (const batch of raw.scanIterator({ MATCH: 'auth:*' }))
          keys.push(...(Array.isArray(batch) ? batch : [batch]));
        assert.ok(keys.length > 0);
        for (const key of keys)
          assert.ok((await raw.pTTL(key)) > 0, `Missing TTL: ${key}`);
      },
    );
    await check(
      'real Nest HTTP guards, scoped cookies and realtime revocation work together',
      async () => {
        process.env.JWT_SECRET = 'isolated-auth-secret-not-a-production-secret';
        process.env.JWT_ISSUER = 'jobaura';
        process.env.JWT_AUDIENCE = 'jobaura-api';
        process.env.JWT_EXPIRES_IN = '10m';
        process.env.NODE_ENV = 'test';
        process.env.GLOBAL_PREFIX = 'api';
        process.env.FRONTEND_URL = 'http://auth.test';
        delete process.env.REDIS_URL;
        const { Test } = require('@nestjs/testing');
        const { ValidationPipe } = require('@nestjs/common');
        const { Reflector } = require('@nestjs/core');
        const { ConfigModule } = require('@nestjs/config');
        const { DatabaseModule } = require('../src/database/database.module');
        const { PrismaService } = require('../src/prisma.service');
        const { AuthModule } = require('../src/modules/auth/auth.module');
        const { ChatModule } = require('../src/modules/chat/chat.module');
        const { RedisModule } = require('../src/modules/redis/redis.module');
        const { JwtAuthGuard } = require('../src/common/guards/jwt-auth.guard');
        const { RolesGuard } = require('../src/common/guards/roles.guard');
        const { CsrfGuard } = require('../src/common/guards/csrf.guard');
        const values = {
          GOOGLE_CLIENT_ID: 'fixture',
          GOOGLE_CLIENT_SECRET: 'fixture',
          GOOGLE_CALLBACK_URL: 'http://auth.test/api/auth/google/callback',
          AUTH_REDIS_URL: redisUrl,
          AUTH_REDIS_PASSWORD: password,
        };
        const module = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
              load: [() => values],
            }),
            DatabaseModule,
            RedisModule,
            AuthModule,
            ChatModule,
          ],
        })
          .overrideProvider(PrismaService)
          .useValue(prisma)
          .overrideProvider(AuthRedisService)
          .useValue(authRedis)
          .compile();
        app = module.createNestApplication({ logger: false });
        app.setGlobalPrefix('api');
        app.use(require('cookie-parser')());
        app.useGlobalPipes(
          new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
          }),
        );
        const reflector = app.get(Reflector);
        app.useGlobalGuards(
          new JwtAuthGuard(reflector),
          new RolesGuard(reflector),
          new CsrfGuard(app.get(ConfigService)),
        );
        await app.listen(0, '127.0.0.1');
        const request = require('supertest');
        const agent = request.agent(app.getHttpServer());
        await request(app.getHttpServer()).get('/api/auth/me').expect(401);
        const login = await agent
          .post('/api/auth/signin')
          .set('Origin', 'http://auth.test')
          .send({ email: user.email, password: 'NewPassword123' })
          .expect(201);
        const cookies = login.headers['set-cookie'];
        assert.ok(
          cookies.some(
            (v) =>
              v.startsWith('refresh_token=') &&
              v.includes('Path=/api/auth/refresh') &&
              v.includes('HttpOnly'),
          ),
        );
        assert.equal(login.body.content.token, undefined);
        let csrf = cookies
          .find((v) => v.startsWith('csrf_token='))
          .split(';')[0]
          .slice('csrf_token='.length);
        await agent.get('/api/auth/me').expect(200);
        await agent
          .post('/api/auth/refresh')
          .set('Origin', 'http://evil.test')
          .set('X-CSRF-Token', csrf)
          .expect(403);
        await agent
          .patch(`/api/auth/users/${user.id + 1}/ban`)
          .set('Origin', 'http://auth.test')
          .set('X-CSRF-Token', csrf)
          .send({ banned: true })
          .expect(403);
        const refreshed = await agent
          .post('/api/auth/refresh')
          .set('Origin', 'http://auth.test')
          .set('X-CSRF-Token', csrf)
          .expect(201);
        csrf = refreshed.headers['set-cookie']
          .find((v) => v.startsWith('csrf_token='))
          .split(';')[0]
          .slice('csrf_token='.length);
        const ticket = await agent.get('/api/auth/realtime-ticket').expect(200);
        const ws = new WebSocket(
          `ws://127.0.0.1:${app.getHttpServer().address().port}/socket.io/?EIO=4&transport=websocket`,
        );
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error('Namespace handshake timeout'));
          }, 5000);
          let joined = 0;
          ws.onmessage = (event) => {
            const packet = String(event.data);
            if (packet.startsWith('0')) {
              ws.send(
                `40/chat,${JSON.stringify({ token: ticket.body.content.token })}`,
              );
              ws.send(
                `40/notifications,${JSON.stringify({ token: ticket.body.content.token })}`,
              );
            }
            if (packet === '2') ws.send('3');
            if (packet.startsWith('44/')) {
              clearTimeout(timer);
              ws.close();
              reject(new Error(`Namespace rejected: ${packet}`));
            }
            if (packet.startsWith('40/')) {
              joined++;
              if (joined === 2) {
                clearTimeout(timer);
                resolve();
              }
            }
          };
          ws.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Websocket failed'));
          };
        });
        const disconnected = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error('Revoked socket remained connected'));
          }, 5000);
          ws.onclose = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        await agent
          .post('/api/auth/refresh/logout')
          .set('Origin', 'http://auth.test')
          .set('X-CSRF-Token', csrf)
          .expect(201);
        await disconnected;
        await agent.get('/api/auth/me').expect(401);
      },
    );
    const outageSession = await sessions.create(user.id);
    await check(
      'Redis outage keeps access available and refresh rotates using PostgreSQL',
      async () => {
        await raw.close();
        docker('stop', redisName);
        await delay(100);
        const started = Date.now();
        await sessions.assertAccessSession(
          outageSession.sessionId,
          user.id,
          jwt.decode(outageSession.token).jti,
        );
        await sessions.refresh(outageSession.refreshToken);
        assert.ok(Date.now() - started < 3000);
      },
    );
    console.log(JSON.stringify({ passed, productionChanged: false }));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    authRedis?.onModuleDestroy();
    if (raw?.isOpen) raw.destroy();
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
    for (const name of [redisName, pgName]) {
      try {
        docker('rm', '-f', '-v', name);
      } catch {
        /* Cleanup also handles a fixture that failed to start. */
      }
    }
  }
})();
