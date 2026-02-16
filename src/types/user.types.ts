export interface JwtPayload {
  sub: number;
  email: string;
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
  email: string;
  role: string;
}
