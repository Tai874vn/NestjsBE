export interface ApiResponse<T = any> {
  message: string;
  content?: T;
}
