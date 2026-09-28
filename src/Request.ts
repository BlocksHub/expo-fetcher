import { Body, InitSource } from './BodyMixin';
import {
  createBoundary,
  encodeBody,
  impliedContentType,
  type BodyInit,
  type EncodedBody,
} from './encoding';
import { Headers, type HeadersInit } from './Headers';
import { normalizeUrl } from './url';

export type RequestRedirect = 'follow' | 'error' | 'manual';
export type RequestCredentials = 'include' | 'same-origin' | 'omit';
export type RequestCache =
  | 'default'
  | 'no-store'
  | 'reload'
  | 'no-cache'
  | 'force-cache'
  | 'only-if-cached';

export interface ProgressEvent {
  loaded: number;
  total: number | null;
}

export interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  signal?: AbortSignal | null;
  timeout?: number;
  onUploadProgress?: (event: ProgressEvent) => void;
  onDownloadProgress?: (event: ProgressEvent) => void;
}

const STANDARD_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH']);
const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizeMethod(method: string): string {
  if (!METHOD_TOKEN.test(method)) {
    throw new TypeError(`Invalid HTTP method: "${method}"`);
  }
  const upper = method.toUpperCase();
  if (upper === 'CONNECT' || upper === 'TRACE' || upper === 'TRACK') {
    throw new TypeError(`HTTP method "${method}" is not allowed.`);
  }
  return STANDARD_METHODS.has(upper) ? upper : method;
}

export class Request extends Body {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly redirect: RequestRedirect;
  readonly credentials: RequestCredentials;
  readonly cache: RequestCache;
  readonly signal: AbortSignal | null;
  readonly timeout: number | undefined;
  readonly onUploadProgress: RequestInit['onUploadProgress'];
  readonly onDownloadProgress: RequestInit['onDownloadProgress'];

  readonly _bodyInit: BodyInit | null;
  private readonly boundary: string;
  private encoded: Promise<EncodedBody> | null = null;

  constructor(input: string | URL | Request, init: RequestInit = {}) {
    const parent = input instanceof Request ? input : null;
    const bodyInit: BodyInit | null =
      init.body !== undefined ? init.body : (parent?._bodyInit ?? null);
    const boundary = parent && init.body === undefined ? parent.boundary : createBoundary();
    super(bodyInit == null ? null : new InitSource(bodyInit, boundary));

    this.url = parent ? parent.url : normalizeUrl(typeof input === 'string' ? input : String(input));
    this.method = normalizeMethod(init.method ?? parent?.method ?? 'GET');
    this.headers = new Headers(init.headers ?? parent?.headers);
    this.redirect = init.redirect ?? parent?.redirect ?? 'follow';
    this.credentials = init.credentials ?? parent?.credentials ?? 'include';
    this.cache = init.cache ?? parent?.cache ?? 'default';
    this.signal = init.signal !== undefined ? init.signal : (parent?.signal ?? null);
    this.timeout = init.timeout ?? parent?.timeout;
    this.onUploadProgress = init.onUploadProgress ?? parent?.onUploadProgress;
    this.onDownloadProgress = init.onDownloadProgress ?? parent?.onDownloadProgress;
    this._bodyInit = bodyInit;
    this.boundary = boundary;

    if (bodyInit != null && (this.method === 'GET' || this.method === 'HEAD')) {
      throw new TypeError(`Request with ${this.method} method cannot have a body.`);
    }
    if (parent && init.body === undefined) {
      if (parent.bodyUsed) {
        throw new TypeError('Cannot construct a Request from one whose body was already used.');
      }
      this.encoded = parent._encode();
    }
    if (bodyInit != null && !this.headers.has('content-type')) {
      const type = impliedContentType(bodyInit, boundary);
      if (type) {
        this.headers.set('content-type', type);
      }
    }
  }

  clone(): Request {
    if (this.bodyUsed) {
      throw new TypeError('Cannot clone a Request whose body was already used.');
    }
    return new Request(this);
  }

  _encode(): Promise<EncodedBody> {
    if (!this.encoded) {
      this.encoded = encodeBody(this._bodyInit, this.boundary);
    }
    return this.encoded;
  }

  protected contentType(): string | null {
    return this.headers.get('content-type');
  }

  get [Symbol.toStringTag](): string {
    return 'Request';
  }
}
