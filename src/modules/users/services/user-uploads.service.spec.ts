import { BadRequestException } from '@nestjs/common';
import { UserUploadsService } from './user-uploads.service';

const storage = {
  uploadDocument: jest.fn(),
  uploadImage: jest.fn(),
  deleteDocument: jest.fn(),
  deleteImage: jest.fn(),
  extractKey: jest.fn(),
};

const profile = {
  getUploadReferences: jest.fn(),
  uploadAvatar: jest.fn(),
  uploadCover: jest.fn(),
};

const resume = {
  getResumeFilePublicId: jest.fn(),
  uploadResumeFile: jest.fn(),
};

function createService() {
  return new UserUploadsService(
    storage as never,
    profile as never,
    resume as never,
  );
}

function file(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    originalname: 'resume.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('test'),
    fieldname: 'file',
    encoding: '7bit',
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
    ...overrides,
  };
}

describe('UserUploadsService', () => {
  const docKey = 'documents/resumes/550e8400-e29b-41d4-a716-446655440000.pdf';
  const oldDocKey =
    'documents/resumes/11111111-1111-4111-8111-111111111111.pdf';
  const avatarKey = 'images/avatars/550e8400-e29b-41d4-a716-446655440000.webp';
  const oldAvatarKey =
    'images/avatars/22222222-2222-4222-8222-222222222222.webp';

  beforeEach(() => {
    jest.clearAllMocks();
    storage.uploadDocument.mockResolvedValue({
      url: docKey,
      key: docKey,
      mimeType: 'application/pdf',
      size: 1024,
    });
    storage.uploadImage.mockResolvedValue({
      url: `/uploads/${avatarKey}`,
      key: avatarKey,
      mimeType: 'image/webp',
      size: 512,
    });
    storage.deleteDocument.mockResolvedValue(undefined);
    storage.deleteImage.mockResolvedValue(undefined);
    storage.extractKey.mockReturnValue(null);
    resume.getResumeFilePublicId.mockResolvedValue(null);
    profile.getUploadReferences.mockResolvedValue({
      avatar: null,
      coverImage: null,
    });
    resume.uploadResumeFile.mockResolvedValue({ content: { id: 1 } });
    profile.uploadAvatar.mockResolvedValue({
      content: { avatar: `/uploads/${avatarKey}` },
    });
    profile.uploadCover.mockResolvedValue({
      content: { coverImage: `/uploads/${avatarKey}` },
    });
  });

  it('requires a resume file before uploading to storage', async () => {
    await expect(createService().uploadResumeFile(1)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(storage.uploadDocument).not.toHaveBeenCalled();
  });

  it('deletes uploaded resume document when database persistence fails', async () => {
    resume.uploadResumeFile.mockRejectedValue(new Error('db failed'));

    await expect(createService().uploadResumeFile(1, file())).rejects.toThrow(
      'db failed',
    );

    expect(storage.deleteDocument).toHaveBeenCalledWith(docKey);
  });

  it('deletes uploaded avatar image when profile update fails', async () => {
    profile.uploadAvatar.mockRejectedValue(new Error('db failed'));

    await expect(
      createService().uploadAvatar(1, file({ mimetype: 'image/png' })),
    ).rejects.toThrow('db failed');

    expect(storage.deleteImage).toHaveBeenCalledWith(avatarKey);
  });

  it('deletes uploaded cover image when profile update fails', async () => {
    profile.uploadCover.mockRejectedValue(new Error('db failed'));

    await expect(
      createService().uploadCover(1, file({ mimetype: 'image/png' })),
    ).rejects.toThrow('db failed');

    expect(storage.deleteImage).toHaveBeenCalledWith(avatarKey);
  });

  it('deletes the previous resume only after its replacement is saved', async () => {
    resume.getResumeFilePublicId.mockResolvedValue(oldDocKey);

    await createService().uploadResumeFile(1, file());

    expect(resume.uploadResumeFile).toHaveBeenCalledWith(1, {
      originalName: 'resume.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      url: docKey,
      publicId: docKey,
    });
    expect(storage.deleteDocument).toHaveBeenCalledWith(oldDocKey);
  });

  it('deletes the previous avatar only after its replacement is saved', async () => {
    profile.getUploadReferences.mockResolvedValue({
      avatar: `/uploads/${oldAvatarKey}`,
      coverImage: null,
    });
    storage.extractKey.mockReturnValue(oldAvatarKey);

    await createService().uploadAvatar(1, file({ mimetype: 'image/png' }));

    expect(storage.deleteImage).toHaveBeenCalledWith(oldAvatarKey);
  });
});
