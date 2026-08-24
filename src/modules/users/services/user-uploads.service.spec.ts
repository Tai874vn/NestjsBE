import { BadRequestException } from '@nestjs/common';
import { UserUploadsService } from './user-uploads.service';

const cloudinary = {
  uploadDocument: jest.fn(),
  uploadImage: jest.fn(),
  deleteDocument: jest.fn(),
  deleteImage: jest.fn(),
  extractPublicId: jest.fn(),
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
    cloudinary as never,
    profile as never,
    resume as never,
  );
}

function file(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
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
  beforeEach(() => {
    jest.clearAllMocks();
    cloudinary.uploadDocument.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
      public_id: 'resumes/resume',
    });
    cloudinary.uploadImage.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/demo/image/upload/avatars/user.png',
      public_id: 'avatars/user',
    });
    cloudinary.deleteDocument.mockResolvedValue(undefined);
    cloudinary.deleteImage.mockResolvedValue(undefined);
    cloudinary.extractPublicId.mockReturnValue(null);
    resume.getResumeFilePublicId.mockResolvedValue(null);
    profile.getUploadReferences.mockResolvedValue({
      avatar: null,
      coverImage: null,
    });
    resume.uploadResumeFile.mockResolvedValue({ content: { id: 1 } });
    profile.uploadAvatar.mockResolvedValue({ content: { avatar: 'url' } });
    profile.uploadCover.mockResolvedValue({ content: { coverImage: 'url' } });
  });

  it('requires a resume file before uploading to Cloudinary', async () => {
    await expect(createService().uploadResumeFile(1)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(cloudinary.uploadDocument).not.toHaveBeenCalled();
  });

  it('deletes uploaded resume document when database persistence fails', async () => {
    resume.uploadResumeFile.mockRejectedValue(new Error('db failed'));

    await expect(createService().uploadResumeFile(1, file())).rejects.toThrow(
      'db failed',
    );

    expect(cloudinary.deleteDocument).toHaveBeenCalledWith('resumes/resume');
  });

  it('deletes uploaded avatar image when profile update fails', async () => {
    profile.uploadAvatar.mockRejectedValue(new Error('db failed'));

    await expect(
      createService().uploadAvatar(1, file({ mimetype: 'image/png' })),
    ).rejects.toThrow('db failed');

    expect(cloudinary.deleteImage).toHaveBeenCalledWith('avatars/user');
  });

  it('deletes uploaded cover image when profile update fails', async () => {
    profile.uploadCover.mockRejectedValue(new Error('db failed'));

    await expect(
      createService().uploadCover(1, file({ mimetype: 'image/png' })),
    ).rejects.toThrow('db failed');

    expect(cloudinary.deleteImage).toHaveBeenCalledWith('avatars/user');
  });

  it('deletes the previous resume only after its replacement is saved', async () => {
    resume.getResumeFilePublicId.mockResolvedValue('resumes/old');

    await createService().uploadResumeFile(1, file());

    expect(cloudinary.deleteDocument).toHaveBeenCalledWith('resumes/old');
  });

  it('deletes the previous avatar only after its replacement is saved', async () => {
    profile.getUploadReferences.mockResolvedValue({
      avatar: 'https://res.cloudinary.com/demo/image/upload/v1/avatars/old.png',
      coverImage: null,
    });
    cloudinary.extractPublicId.mockReturnValue('avatars/old');

    await createService().uploadAvatar(1, file({ mimetype: 'image/png' }));

    expect(cloudinary.deleteImage).toHaveBeenCalledWith('avatars/old');
  });
});
