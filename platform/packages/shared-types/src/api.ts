export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface IdParam {
  id: string;
}

export interface CreatedResponse {
  id: string;
  createdAt: string;
}

export interface UpdatedResponse {
  updatedAt: string;
}

export interface DeletedResponse {
  deleted: boolean;
}
