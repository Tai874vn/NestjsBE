/**
 * Passport guard in the auth module that starts Google OAuth login. It reads an optional role query parameter and creates a signed state value for the redirect to Google.
 *
 * Calls: GoogleOAuthStateService; Role; Google OAuth (Passport)
 * Used by:
 *   - src/modules/auth/auth.module.ts
 *   - src/modules/auth/controllers/auth.controller.ts
 */

import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { Role } from '../../../common/constants/roles';
import { GoogleOAuthStateService } from '../services/google-oauth-state.service';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly stateService: GoogleOAuthStateService) {
    super();
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const role =
      request.query.role === Role.EMPLOYER || request.query.role === Role.USER
        ? request.query.role
        : undefined;

    return { state: this.stateService.issue(response, role) };
  }
}
