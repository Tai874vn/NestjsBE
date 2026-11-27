/**
 * Shared HTTP response type definitions for the backend API.
 * Defines the generic ApiResponse envelope carrying a message and an optional content payload.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/types/index.ts
 */

export interface ApiResponse<T = any> {
  message: string;
  content?: T;
}
