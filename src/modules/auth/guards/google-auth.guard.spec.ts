import { ExecutionContext } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { GoogleAuthGuard } from './google-auth.guard';

describe('GoogleAuthGuard', () => {
  function createContext(role?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ query: role ? { role } : {} }),
      }),
    } as ExecutionContext;
  }

  it('passes employer signup role through Google OAuth state', () => {
    const guard = new GoogleAuthGuard();

    expect(guard.getAuthenticateOptions(createContext(Role.EMPLOYER))).toEqual({
      state: Role.EMPLOYER,
    });
  });

  it('does not pass OAuth state for missing or unsupported signup roles', () => {
    const guard = new GoogleAuthGuard();

    expect(guard.getAuthenticateOptions(createContext())).toEqual({});
    expect(guard.getAuthenticateOptions(createContext(Role.ADMIN))).toEqual({});
  });
});
