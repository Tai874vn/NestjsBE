import { ForbiddenException } from '@nestjs/common';
import { ROLES_KEY, Role } from '../../../common/constants/roles';
import { JobsController } from './jobs.controller';

describe('JobsController service publishing policy', () => {
  it('allows only worker accounts to create new freelance services', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JobsController.prototype.create)).toEqual([Role.USER]);
  });

  it('checks job ownership before uploading images to Cloudinary', async () => {
    const jobsService = {
      ensureCanManageJob: jest.fn().mockRejectedValue(new ForbiddenException()),
      uploadImage: jest.fn(),
    };
    const cloudinaryService = {
      uploadImage: jest.fn(),
      deleteImage: jest.fn(),
    };
    const controller = new JobsController(
      jobsService as never,
      cloudinaryService as never,
    );

    await expect(
      controller.uploadImage(
        42,
        { mimetype: 'image/png' } as Express.Multer.File,
        { id: 7, role: Role.USER } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(jobsService.ensureCanManageJob).toHaveBeenCalledWith(
      42,
      7,
      Role.USER,
    );
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });
});
