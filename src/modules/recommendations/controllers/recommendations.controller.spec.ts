import 'reflect-metadata';
import { ROLES_KEY, Role } from '../../../common/constants/roles';
import { RecommendationsController } from './recommendations.controller';

describe('RecommendationsController candidate recommendations', () => {
  it('limits candidate recommendations to employers and admins', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      RecommendationsController.prototype.recommendCandidates,
    );

    expect(roles).toEqual([Role.EMPLOYER, Role.ADMIN]);
  });
});
