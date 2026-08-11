import { BadRequestException } from '@nestjs/common';
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
});
