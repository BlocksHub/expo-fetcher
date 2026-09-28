export type FetchErrorCode =
  | 'ERR_NETWORK'
  | 'ERR_TIMEOUT'
  | 'ERR_ABORTED'
  | 'ERR_PINNING'
  | 'ERR_TLS'
  | 'ERR_REDIRECT'
  | 'ERR_INVALID_URL'
  | 'ERR_BODY_USED'
  | 'ERR_BODY_READ'
  | 'ERR_FILE'
  | 'ERR_HTTP';

export interface FetchErrorRequestInfo {
  method: string;
  url: string;
}

export class FetchError extends TypeError {
  readonly code: FetchErrorCode;
  readonly request?: FetchErrorRequestInfo;
  readonly status?: number;
  readonly response?: import('./Response').Response;
  readonly cause?: unknown;

  constructor(
    code: FetchErrorCode,
    message: string,
    options: {
      request?: FetchErrorRequestInfo;
      cause?: unknown;
      status?: number;
      response?: import('./Response').Response;
    } = {}
  ) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.request = options.request;
    this.cause = options.cause;
    this.status = options.status;
    this.response = options.response;
  }
}

export function createAbortError(message = 'The operation was aborted.'): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function createTimeoutError(ms: number): Error {
  const message = `The request timed out after ${ms} ms.`;
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'TimeoutError');
  }
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as FetchError).code === 'ERR_ABORTED')
  );
}

const NATIVE_CODES: Record<string, FetchErrorCode> = {
  ERR_FETCHER_NETWORK: 'ERR_NETWORK',
  ERR_FETCHER_TIMEOUT: 'ERR_TIMEOUT',
  ERR_FETCHER_CANCELED: 'ERR_ABORTED',
  ERR_FETCHER_PINNING: 'ERR_PINNING',
  ERR_FETCHER_TLS: 'ERR_TLS',
  ERR_FETCHER_REDIRECT: 'ERR_REDIRECT',
  ERR_FETCHER_INVALID_URL: 'ERR_INVALID_URL',
  ERR_FETCHER_FILE: 'ERR_FILE',
};

export function fromNativeError(error: unknown, request: FetchErrorRequestInfo): FetchError {
  if (error instanceof FetchError) {
    return error;
  }
  const nativeCode = (error as { code?: string } | null)?.code;
  const code = (nativeCode && NATIVE_CODES[nativeCode]) || 'ERR_NETWORK';
  const reason = error instanceof Error ? error.message : String(error);
  return new FetchError(code, `${request.method} ${request.url} failed: ${reason}`, {
    request,
    cause: error,
  });
}
