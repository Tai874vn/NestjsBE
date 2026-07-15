import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const role =
      request.query.role === Role.EMPLOYER || request.query.role === Role.USER
        ? request.query.role
        : undefined;

    return role ? { state: role } : {};
  }
}
