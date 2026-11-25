import {
  ExecutionContext,
  INestApplication,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HiringApplicationStatus } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import request from 'supertest';
import { Role } from '../../common/constants/roles';
import {
  AllExceptionsFilter,
  GENERIC_SERVER_ERROR_MESSAGE,
} from '../../common/errors/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma.service';
import { FilesController } from './files.controller';
import { StorageService } from './storage.service';

describe('FilesController private document downloads', () => {
  let app: INestApplication;
  let server: Server;
  let rootDir: string;
  let storage: StorageService;
  let storedKey: string;
  const pdfBytes = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
    'ascii',
  );

  const prisma = {
    userResume: {
      findFirst: jest.fn(),
    },
    hiringApplication: {
      findFirst: jest.fn(),
    },
  };

  const authHeader = (id: number, role: Role) => JSON.stringify({ id, role });

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'jobaura-files-ctrl-'));
    storage = new StorageService({
      get: (key: string) => {
        if (key === 'UPLOADS_DIR') return rootDir;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      },
    } as never);
    const saved = await storage.saveDocumentBuffer(pdfBytes, 'resumes');
    storedKey = saved.key;

    const module = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          const raw = req.headers['x-test-user'];
          if (typeof raw !== 'string') {
            throw new UnauthorizedException({
              statusCode: 401,
              code: 'ACCESS_TOKEN_MISSING',
              message: 'Access token is missing, invalid or expired',
            });
          }
          req.user = JSON.parse(raw);
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userResume.findFirst.mockResolvedValue({ userId: 10 });
    prisma.hiringApplication.findFirst.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('rejects anonymous callers with 401', async () => {
    await request(server).get(`/api/files/${storedKey}`).expect(401);
    expect(prisma.userResume.findFirst).not.toHaveBeenCalled();
  });

  it('streams the document to the owner with safe download headers and sandbox CSP', async () => {
    const response = await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(10, Role.USER))
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="resume.pdf"',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(Buffer.from(response.body as Uint8Array)).toEqual(pdfBytes);
  });

  it('allows an admin to download any user document', async () => {
    await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(1, Role.ADMIN))
      .expect(200);
  });

  it('allows an employer only when they have a non-WITHDRAWN application from that user', async () => {
    prisma.hiringApplication.findFirst.mockResolvedValue({ id: 77 });

    await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(20, Role.EMPLOYER))
      .expect(200);

    expect(prisma.hiringApplication.findFirst).toHaveBeenCalledWith({
      where: {
        applicantId: 10,
        status: { not: HiringApplicationStatus.WITHDRAWN },
        hiringPost: {
          recruiterId: 20,
        },
      },
      select: { id: true },
    });
  });

  it('returns 404 to another employer without an active (non-WITHDRAWN) application', async () => {
    prisma.hiringApplication.findFirst.mockResolvedValue(null);

    await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(21, Role.EMPLOYER))
      .expect(404);
  });

  it('returns 404 to another regular user', async () => {
    await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(11, Role.USER))
      .expect(404);
    expect(prisma.hiringApplication.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the key is not stored in the database', async () => {
    prisma.userResume.findFirst.mockResolvedValue(null);

    await request(server)
      .get(`/api/files/${storedKey}`)
      .set('x-test-user', authHeader(10, Role.USER))
      .expect(404);
  });

  it('returns 404 on traversal or non-allowlisted paths', async () => {
    await request(server)
      .get('/api/files/documents/resumes/..%2F..%2Fetc%2Fpasswd')
      .set('x-test-user', authHeader(1, Role.ADMIN))
      .expect(404);
    expect(prisma.userResume.findFirst).not.toHaveBeenCalled();
  });

  it('clears Content-Disposition and sends JSON with requestId when stream fails before headers are sent (Finding 7)', async () => {
    const errorLoggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const brokenStream = new Readable({
      read() {
        this.destroy(new Error('EIO: /secret/disk/path failed'));
      },
    });
    const openSpy = jest.spyOn(storage, 'openDocumentStream').mockResolvedValue({
      stream: brokenStream as never,
      contentType: 'application/pdf',
      extension: '.pdf',
      size: pdfBytes.length,
    });

    try {
      const response = await request(server)
        .get(`/api/files/${storedKey}`)
        .set('x-test-user', authHeader(10, Role.USER))
        .set('x-request-id', 'req-stream-fail-1')
        .expect(500);

      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['x-request-id']).toBe('req-stream-fail-1');
      expect(response.body).toEqual({
        statusCode: 500,
        message: GENERIC_SERVER_ERROR_MESSAGE,
        error: 'Internal Server Error',
        requestId: 'req-stream-fail-1',
      });
    } finally {
      openSpy.mockRestore();
      errorLoggerSpy.mockRestore();
    }
  });

  it('destroys the response instead of ending cleanly when stream fails after headers are sent (Finding 7)', async () => {
    const errorLoggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const controller = new FilesController(prisma as never, storage);
    const dummyStream = new Readable({ read() {} });
    const openSpy = jest.spyOn(storage, 'openDocumentStream').mockResolvedValue({
      stream: dummyStream as never,
      contentType: 'application/pdf',
      extension: '.pdf',
      size: pdfBytes.length,
    });

    const res = {
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const fakeResponse = {
      destroyed: false,
      headersSent: true,
      destroy: jest.fn(),
      end: jest.fn(),
    };

    try {
      const streamable = await controller.downloadDocument(
        storedKey.replace(/^documents\//, ''),
        { id: 10, role: Role.USER } as never,
        { requestId: 'req-mid-stream' } as never,
        res as never,
      );
      streamable.errorHandler(
        new Error('disk read interrupted'),
        fakeResponse as never,
      );

      expect(fakeResponse.destroy).toHaveBeenCalledTimes(1);
      expect(fakeResponse.end).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      errorLoggerSpy.mockRestore();
    }
  });
});
