export type ApiMeta = {
  requestId: string;
};

export type ApiSuccess<T> = {
  data: T;
  meta: ApiMeta;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
};

export function apiSuccess<T>(data: T, requestId: string): ApiSuccess<T> {
  return { data, meta: { requestId } };
}

export function apiError(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ApiErrorBody {
  const error: ApiErrorBody['error'] = { code, message };
  if (details !== undefined) error.details = details;
  return { error, meta: { requestId } };
}
