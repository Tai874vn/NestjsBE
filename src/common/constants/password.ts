/**
 * Common password rule constant exporting `PASSWORD_MIN_LENGTH` (10 characters).
 * Sets the minimum length for a new password during sign up, password reset, password change, and admin user creation.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/auth/dto/email-flows.dto.ts
 *   - src/modules/auth/dto/session.dto.ts
 *   - src/modules/auth/dto/signup.dto.ts
 *   - src/modules/users/dto/create-user.dto.ts
 */

export const PASSWORD_MIN_LENGTH = 10;
