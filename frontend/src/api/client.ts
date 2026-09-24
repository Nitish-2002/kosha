const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export class ApiError extends Error {
  status = 0;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ErrorBody {
  message?: string | string[];
}

async function rawRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Nest returns an empty body for some 200s (e.g. DELETE) and every 204 —
  // response.json() throws on that, so parse text and only JSON.parse if non-empty.
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const errorMessage = (data as ErrorBody | undefined)?.message;
    const message = Array.isArray(errorMessage) ? errorMessage.join(', ') : errorMessage;
    throw new ApiError(response.status, message ?? `${method} ${path} failed`);
  }
  return data as T;
}

// The access token is only good for 15 minutes (see backend AuthService) but
// nothing was ever calling /auth/refresh — every request just started failing
// with 401 once it expired, even for a genuinely-signed-in Admin. On a 401,
// try refreshing the access token once and replay the original request;
// only give up (and let the caller redirect to /login) if the refresh itself
// fails, which means the session is actually gone.
let refreshInFlight: Promise<void> | null = null;

function refreshAccessToken(): Promise<void> {
  refreshInFlight ??= rawRequest<void>('/auth/refresh', 'POST').finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  try {
    return await rawRequest<T>(path, method, body);
  } catch (error) {
    const canRetry = error instanceof ApiError && error.status === 401 && path !== '/auth/refresh';
    if (!canRetry) {
      throw error;
    }
    await refreshAccessToken();
    return rawRequest<T>(path, method, body);
  }
}

export const apiGet = <T>(path: string) => request<T>(path, 'GET');
export const apiPost = <T = void>(path: string, body?: unknown) => request<T>(path, 'POST', body);
export const apiPatch = <T>(path: string, body?: unknown) => request<T>(path, 'PATCH', body);
export const apiDelete = <T = void>(path: string) => request<T>(path, 'DELETE');

export function googleSignInUrl(): string {
  return `${API_BASE_URL}/auth/google`;
}
