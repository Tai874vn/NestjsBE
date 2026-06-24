import { ROLES_KEY, Role } from '../../../common/constants/roles';
import { JobsController } from './jobs.controller';

describe('JobsController service publishing policy', () => {
  it('allows only worker accounts to create new freelance services', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JobsController.prototype.create)).toEqual([Role.USER]);
  });
});
