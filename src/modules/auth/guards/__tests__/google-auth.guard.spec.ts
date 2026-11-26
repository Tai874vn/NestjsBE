import { ExecutionContext } from '@nestjs/common';
import { Role } from '../../../../common/constants/roles';
import { GoogleAuthGuard } from '../google-auth.guard';

describe('GoogleAuthGuard', () => {
  function createContext(role?: string): ExecutionContext {
    const response = {};
    return {
      switchToHttp: () => ({
        getRequest: () => ({ query: role ? { role } : {} }),
        getResponse: () => response,
      }),
    } as ExecutionContext;
  }

  const stateService = {
    issue: jest.fn().mockReturnValue('signed-state'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('passes employer signup role through Google OAuth state', () => {
    const guard = new GoogleAuthGuard(stateService as any);

    expect(guard.getAuthenticateOptions(createContext(Role.EMPLOYER))).toEqual({
      state: 'signed-state',
    });
    expect(stateService.issue).toHaveBeenCalledWith(
      expect.anything(),
      Role.EMPLOYER,
    );
  });

  it('does not pass OAuth state for missing or unsupported signup roles', () => {
    const guard = new GoogleAuthGuard(stateService as any);

    expect(guard.getAuthenticateOptions(createContext())).toEqual({
      state: 'signed-state',
    });
    expect(guard.getAuthenticateOptions(createContext(Role.ADMIN))).toEqual({
      state: 'signed-state',
    });
    expect(stateService.issue).toHaveBeenNthCalledWith(1, expect.anything(), undefined);
    expect(stateService.issue).toHaveBeenNthCalledWith(2, expect.anything(), undefined);
  });
});
