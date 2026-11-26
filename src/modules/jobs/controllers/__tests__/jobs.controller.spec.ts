import { ForbiddenException } from '@nestjs/common';
import { ROLES_KEY, Role } from '../../../../common/constants/roles';
import { JobsController } from '../jobs.controller';

describe('JobsController service publishing policy', () => {
  it('allows worker and admin accounts to create new freelance services', () => {
    const createHandler = Object.getOwnPropertyDescriptor(
      JobsController.prototype,
      'create',
    )?.value;

    expect(Reflect.getMetadata(ROLES_KEY, createHandler)).toEqual([
      Role.USER,
      Role.ADMIN,
    ]);
  });

  it('checks job ownership before uploading images to local storage', async () => {
    const jobsService = {
      ensureCanManageJob: jest.fn().mockRejectedValue(new ForbiddenException()),
      uploadImage: jest.fn(),
    };
    const storageService = {
      uploadImage: jest.fn(),
      deleteImage: jest.fn(),
    };
    const controller = new JobsController(
      jobsService as never,
      storageService as never,
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
    expect(storageService.uploadImage).not.toHaveBeenCalled();
  });
});
