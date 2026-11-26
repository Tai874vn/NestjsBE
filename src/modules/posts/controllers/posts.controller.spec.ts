import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { StorageService } from '../../storage/services/storage.service';
import { PostsService } from '../services/posts.service';
import { PostsController } from './posts.controller';

describe('PostsController comment replies', () => {
  let app: INestApplication;
  let server: Server;
  const service = {
    createReply: jest.fn(),
    getReplies: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PostsController],
      providers: [
        { provide: PostsService, useValue: service },
        { provide: StorageService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = { id: 6, role: 'user' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }));
    await app.init();
    server = app.getHttpServer<Server>();
  });

  beforeEach(() => jest.resetAllMocks());
  afterAll(async () => app.close());

  it('creates a reply using the authenticated user and trimmed content', async () => {
    service.createReply.mockResolvedValue({
      message: 'Reply created successfully',
      content: { id: 8, postId: 10, parentId: 4, content: 'Thanks' },
    });

    const response = await request(server)
      .post('/api/posts/10/comments/4/replies')
      .send({ content: '  Thanks  ' })
      .expect(201);

    expect(service.createReply).toHaveBeenCalledWith(10, 4, 6, { content: 'Thanks' });
    expect(response.body.content.parentId).toBe(4);
  });

  it('lists replies with validated cursor pagination', async () => {
    service.getReplies.mockResolvedValue({ content: { data: [], nextCursor: null } });

    await request(server)
      .get('/api/posts/10/comments/4/replies?cursor=20&limit=5')
      .expect(200);

    expect(service.getReplies).toHaveBeenCalledWith(10, 4, { cursor: 20, limit: 5 });
  });

  it.each([
    {},
    { content: '' },
    { content: '   ' },
    { content: 42 },
    { content: 'a'.repeat(1001) },
    { content: 'Hello', authorId: 7 },
    { content: 'Hello', parentId: 99 },
  ])('rejects invalid reply bodies: %j', async (body) => {
    await request(server)
      .post('/api/posts/10/comments/4/replies')
      .send(body)
      .expect(400);
    expect(service.createReply).not.toHaveBeenCalled();
  });

  it.each(['limit=0', 'limit=21', 'cursor=-1', 'cursor=abc'])('rejects invalid pagination: %s', async (query) => {
    await request(server)
      .get(`/api/posts/10/comments/4/replies?${query}`)
      .expect(400);
    expect(service.getReplies).not.toHaveBeenCalled();
  });

  it('rejects a non-integer parent comment ID', async () => {
    await request(server)
      .post('/api/posts/10/comments/invalid/replies')
      .send({ content: 'Hello' })
      .expect(400);
    expect(service.createReply).not.toHaveBeenCalled();
  });
});
