import { FetchError, createAbortError, isAbortError } from './errors';
import { send } from './fetch';
import { Headers, type HeadersInit } from './Headers';
import type { NativeSession } from './native';
import { Request, type RequestInit } from './Request';
import { Response } from './Response';
import { getSession, toNativeConfig, type SessionOptions } from './session';
import { appendSearchParams, redactUrl, resolveUrl } from './url';

export interface RetryOptions {
  limit?: number;
  methods?: string[];
  statusCodes?: number[];
  afterStatusCodes?: number[];
  maxRetryAfter?: number;
  backoffLimit?: number;
  delay?: (attempt: number) => number;
}

export interface BeforeRetryState {
  request: Request;
  error: FetchError | null;
  response: Response | null;
  retryCount: number;
}

export interface Hooks {
  beforeRequest?: ((request: Request) => Request | Response | void | Promise<Request | Response | void>)[];
  afterResponse?: ((
    request: Request,
    response: Response
  ) => Response | void | Promise<Response | void>)[];
  beforeRetry?: ((state: BeforeRetryState) => void | Promise<void>)[];
  beforeError?: ((error: FetchError) => FetchError | Promise<FetchError>)[];
}

export interface ClientOptions extends SessionOptions {
  baseURL?: string;
  headers?: HeadersInit;
  timeout?: number;
  retry?: number | RetryOptions;
  hooks?: Hooks;
  dedupe?: boolean;
  throwHttpErrors?: boolean;
}

export interface ClientRequestInit extends RequestInit {
  json?: unknown;
  searchParams?: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  retry?: number | RetryOptions;
  throwHttpErrors?: boolean;
}

export interface Client {
  (input: string | URL | Request, init?: ClientRequestInit): Promise<Response>;
  get(input: string, init?: ClientRequestInit): Promise<Response>;
  head(input: string, init?: ClientRequestInit): Promise<Response>;
  delete(input: string, init?: ClientRequestInit): Promise<Response>;
  post(input: string, init?: ClientRequestInit): Promise<Response>;
  put(input: string, init?: ClientRequestInit): Promise<Response>;
  patch(input: string, init?: ClientRequestInit): Promise<Response>;
  json<T = unknown>(input: string | URL | Request, init?: ClientRequestInit): Promise<T>;
  extend(options: ClientOptions): Client;
  readonly options: Readonly<ClientOptions>;
}

const RETRY_DEFAULTS: Required<Omit<RetryOptions, 'maxRetryAfter' | 'delay'>> = {
  limit: 2,
  methods: ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'],
  statusCodes: [408, 413, 429, 500, 502, 503, 504],
  afterStatusCodes: [413, 429, 503],
  backoffLimit: 30_000,
};

const NON_RETRYABLE_CODES = new Set([
  'ERR_ABORTED',
  'ERR_PINNING',
  'ERR_TLS',
  'ERR_INVALID_URL',
  'ERR_REDIRECT',
  'ERR_FILE',
]);

function normalizeRetry(retry: number | RetryOptions | undefined): RetryOptions & typeof RETRY_DEFAULTS {
  if (typeof retry === 'number') {
    return { ...RETRY_DEFAULTS, limit: retry };
  }
  return {
    ...RETRY_DEFAULTS,
    ...retry,
    methods: (retry?.methods ?? RETRY_DEFAULTS.methods).map((method) => method.toUpperCase()),
  };
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - now);
}

function defaultDelay(attempt: number): number {
  const ceiling = 300 * 2 ** (attempt - 1);
  return Math.random() * ceiling;
}

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  const reasonOf = (s: AbortSignal) => (s.reason !== undefined ? s.reason : createAbortError());
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(reasonOf(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(reasonOf(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function mergeHeaders(base: HeadersInit | undefined, override: HeadersInit | undefined): Headers {
  const headers = new Headers(base);
  if (override) {
    for (const [name, value] of new Headers(override)) {
      if (name === 'set-cookie') {
        headers.append(name, value);
      } else {
        headers.set(name, value);
      }
    }
  }
  return headers;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

function httpError(response: Response, request: Request): FetchError {
  return new FetchError(
    'ERR_HTTP',
    `${request.method} ${redactUrl(request.url)} responded ${response.status} ${response.statusText}`.trim(),
    { request: { method: request.method, url: redactUrl(request.url) }, status: response.status, response }
  );
}

export function createClient(options: ClientOptions = {}): Client {
  const nativeConfig = toNativeConfig(options);
  let session: NativeSession | null = null;
  const getClientSession = () => (session ??= getSession(nativeConfig));
  const inflight = new Map<string, Promise<Response>>();
  const hooks = options.hooks ?? {};

  function buildRequest(input: string | URL | Request, init: ClientRequestInit = {}): Request {
    const { json, searchParams, retry: _retry, throwHttpErrors: _throw, ...rest } = init;
    const base = input instanceof Request ? input : null;
    let url = resolveUrl(base ? base.url : String(input), options.baseURL);
    if (searchParams !== undefined) {
      url = appendSearchParams(url, searchParams);
    }
    const headers = mergeHeaders(options.headers, rest.headers ?? base?.headers);
    let body = rest.body !== undefined ? rest.body : base?._bodyInit;
    if (json !== undefined) {
      body = JSON.stringify(json);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      if (!headers.has('accept')) {
        headers.set('accept', 'application/json');
      }
    }
    const timeout = rest.timeout ?? base?.timeout ?? options.timeout ?? 30_000;
    return new Request(url, {
      method: base?.method,
      redirect: base?.redirect,
      credentials: base?.credentials,
      cache: base?.cache,
      signal: base?.signal,
      onUploadProgress: base?.onUploadProgress,
      onDownloadProgress: base?.onDownloadProgress,
      ...stripUndefined(rest),
      body,
      headers,
      timeout: timeout > 0 ? timeout : undefined,
    });
  }

  async function runHooksBefore(request: Request): Promise<Request | Response> {
    let current = request;
    for (const hook of hooks.beforeRequest ?? []) {
      const result = await hook(current);
      if (result instanceof Response) {
        return result;
      }
      if (result instanceof Request) {
        current = result;
      }
    }
    return current;
  }

  async function runHooksAfter(request: Request, response: Response): Promise<Response> {
    let current = response;
    for (const hook of hooks.afterResponse ?? []) {
      const result = await hook(request, current);
      if (result instanceof Response) {
        current = result;
      }
    }
    return current;
  }

  async function finalizeError(error: unknown): Promise<never> {
    if (error instanceof FetchError) {
      let current = error;
      for (const hook of hooks.beforeError ?? []) {
        current = await hook(current);
      }
      throw current;
    }
    throw error;
  }

  async function execute(request: Request, init: ClientRequestInit): Promise<Response> {
    const retry = normalizeRetry(init.retry ?? options.retry);
    const canRetryMethod = retry.methods.includes(request.method);
    const throwHttpErrors = init.throwHttpErrors ?? options.throwHttpErrors ?? false;
    let attempt = 0;

    for (;;) {
      attempt += 1;
      let response: Response | null = null;
      let error: FetchError | null = null;
      let current = request;

      try {
        const prepared = await runHooksBefore(request);
        if (prepared instanceof Response) {
          return prepared;
        }
        current = prepared;
        response = await runHooksAfter(current, await send(getClientSession(), current));
      } catch (caught) {
        if (isAbortError(caught) || !(caught instanceof FetchError)) {
          throw caught;
        }
        error = caught;
      }

      const retriesLeft = attempt <= retry.limit && canRetryMethod;
      let delay: number | null = null;

      if (error) {
        if (!retriesLeft || NON_RETRYABLE_CODES.has(error.code)) {
          return finalizeError(error);
        }
        delay = retry.delay ? retry.delay(attempt) : defaultDelay(attempt);
      } else if (response && retriesLeft && retry.statusCodes.includes(response.status)) {
        delay = retry.delay ? retry.delay(attempt) : defaultDelay(attempt);
        if (retry.afterStatusCodes.includes(response.status)) {
          const after = parseRetryAfter(response.headers.get('retry-after'));
          if (after !== null) {
            if (retry.maxRetryAfter !== undefined && after > retry.maxRetryAfter) {
              delay = null;
            } else {
              delay = after;
            }
          }
        }
      }

      if (delay === null) {
        if (response && throwHttpErrors && !response.ok) {
          const failure = httpError(response, current);
          return finalizeError(failure);
        }
        return response!;
      }

      try {
        for (const hook of hooks.beforeRetry ?? []) {
          await hook({ request: current, error, response, retryCount: attempt });
        }
      } catch {
        if (error) {
          return finalizeError(error);
        }
        return response!;
      }

      response?._discard();
      await sleep(Math.min(delay, retry.backoffLimit), request.signal);
    }
  }

  function dedupeKey(request: Request): string | null {
    if (!options.dedupe || request.signal || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return null;
    }
    return `${request.method} ${request.url} ${JSON.stringify(request.headers.toPairs())}`;
  }

  const client = ((input: string | URL | Request, init: ClientRequestInit = {}) => {
    let request: Request;
    try {
      request = buildRequest(input, init);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = dedupeKey(request);
    if (key === null) {
      return execute(request, init);
    }
    let shared = inflight.get(key);
    if (!shared) {
      const pending = execute(request, init).finally(() => inflight.delete(key));
      inflight.set(key, pending);
      shared = pending;
    }
    return shared.then((response) => response.clone());
  }) as Client;

  const withMethod =
    (method: string) =>
    (input: string, init: ClientRequestInit = {}) =>
      client(input, { ...init, method });

  client.get = withMethod('GET');
  client.head = withMethod('HEAD');
  client.delete = withMethod('DELETE');
  client.post = withMethod('POST');
  client.put = withMethod('PUT');
  client.patch = withMethod('PATCH');

  client.json = async <T>(input: string | URL | Request, init: ClientRequestInit = {}): Promise<T> => {
    const response = await client(input, { ...init, throwHttpErrors: true });
    const text = await response.text();
    return (text === '' ? undefined : JSON.parse(text)) as T;
  };

  client.extend = (extra: ClientOptions) =>
    createClient({
      ...options,
      ...extra,
      headers: mergeHeaders(options.headers, extra.headers),
      pinning: { ...options.pinning, ...extra.pinning },
      hooks: {
        beforeRequest: [...(options.hooks?.beforeRequest ?? []), ...(extra.hooks?.beforeRequest ?? [])],
        afterResponse: [...(options.hooks?.afterResponse ?? []), ...(extra.hooks?.afterResponse ?? [])],
        beforeRetry: [...(options.hooks?.beforeRetry ?? []), ...(extra.hooks?.beforeRetry ?? [])],
        beforeError: [...(options.hooks?.beforeError ?? []), ...(extra.hooks?.beforeError ?? [])],
      },
    });

  Object.defineProperty(client, 'options', { value: Object.freeze({ ...options }) });

  return client;
}
