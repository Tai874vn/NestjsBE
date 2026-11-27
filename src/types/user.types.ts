/**
 * Shared user and authentication type definitions for the auth feature.
 * Declares JwtPayload, GoogleProfile, and ValidatedUser used across auth services and Passport strategies.
 *
 * Calls: Role (common/constants/roles)
 * Used by:
 *   - src/types/index.ts
 */

import { Role } from '../common/constants/roles';

export interface JwtPayload {
  sub: number;
  email?: string;
  role?: string;
  sid?: string;
  ver?: number;
  type: 'access' | 'refresh' | 'socket';
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface GoogleProfile {
  id: string;
  displayName: string;
  emails: Array<{ value: string; verified: boolean }>;
  photos?: Array<{ value: string }>;
  provider: string;
  _json: any;
}

export class ValidatedUser {
  id: number;
  email?: string;
  role: Role;
  sessionId?: string;
}
