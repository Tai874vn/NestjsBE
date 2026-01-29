export interface UserResponse {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  birthDay?: string | null;
  gender?: string | null;
  role: string;
  skill?: string | null;
  certification?: string | null;
  avatar?: string | null;
  googleId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoogleUser {
  id: number;
  email: string;
  name: string;
  avatar?: string | null;
  googleId?: string | null;
  password?: string | null;
  role: string;
}

export interface AuthTokenPayload {
  sub: number;
  email: string;
}

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
