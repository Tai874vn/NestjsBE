import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('CloudinaryService upload validation', () => {
  const service = new CloudinaryService({
    get: jest.fn(),
  } as never);

  const file = (
    mimetype: string,
    buffer: Buffer,
  ): Express.Multer.File =>
    ({
      mimetype,
      buffer,
      originalname: 'upload.bin',
      fieldname: 'file',
      encoding: '7bit',
      size: buffer.length,
      stream: undefined as never,
      destination: '',
      filename: '',
      path: '',
    }) as Express.Multer.File;

  it('rejects image uploads with invalid file signatures', async () => {
    await expect(
      service.uploadImage(file('image/png', Buffer.from('not an image')), 'test'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects resume uploads with invalid document signatures', async () => {
    await expect(
      service.uploadDocument(file('application/pdf', Buffer.from('not a pdf')), 'test'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  function mockCloudinaryUploadError(error: unknown) {
    (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
      (_options, callback: (err: unknown, result?: unknown) => void) => {
        callback(error);
        return {
          on: jest.fn(),
          once: jest.fn(),
          emit: jest.fn(),
          write: jest.fn(),
          end: jest.fn(),
        };
      },
    );
  }

  it.each([400, 413, 415, 422])(
    'maps user-file Cloudinary rejection (%i) to BadRequestException',
    async (httpCode) => {
      mockCloudinaryUploadError({
        message: 'Unsupported image format',
        http_code: httpCode,
      });

      await expect(
        service.uploadImage(file('image/png', pngHeader), 'test'),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([
    ['401 invalid credentials', { message: 'Invalid signature', http_code: 401 }],
    ['403 forbidden account', { message: 'Account disabled', http_code: 403 }],
    ['404 bad cloud_name', { message: 'Cloud not found', http_code: 404 }],
    ['420 rate limit', { message: 'Rate Limit Exceeded', http_code: 420 }],
    ['429 too many requests', { message: 'Too Many Requests', http_code: 429 }],
    ['500 server error', { message: 'Internal storage timeout', http_code: 500 }],
    ['network error without http_code', new Error('ECONNRESET')],
  ])(
    'maps upstream Cloudinary failure (%s) to ServiceUnavailableException with cause attached',
    async (_label, upstreamError) => {
      mockCloudinaryUploadError(upstreamError);

      let caught: unknown;
      try {
        await service.uploadImage(file('image/png', pngHeader), 'test');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceUnavailableException);
      expect((caught as ServiceUnavailableException).cause).toBe(upstreamError);
    },
  );
});
