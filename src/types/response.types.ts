export interface ApiResponse<T = any> {
  message: string;
  content?: T;
}

export interface PaginatedResponse<T = any> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
