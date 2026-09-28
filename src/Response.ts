import { Body, InitSource, type BodySource } from './BodyMixin';
import { createBoundary, impliedContentType, type BodyInit } from './encoding';
import { Headers, type HeadersInit } from './Headers';
import { normalizeUrl } from './url';

export type ResponseType = 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect';

export interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface NetworkResponseInit {
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  redirected: boolean;
  type: ResponseType;
  source: BodySource | null;
}

let internalInit: NetworkResponseInit | null = null;

function construct(init: NetworkResponseInit): Response {
  internalInit = init;
  try {
    return new Response();
  } finally {
    internalInit = null;
  }
}

export class Response extends Body {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly type: ResponseType;
  readonly url: string;
  readonly redirected: boolean;

  constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
    const internal = internalInit;
    if (internal) {
      internalInit = null;
      super(internal.source);
      this.status = internal.status;
      this.statusText = internal.statusText;
      this.headers = internal.headers;
      this.type = internal.type;
      this.url = internal.url;
      this.redirected = internal.redirected;
      return;
    }
    const status = init.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw new RangeError(`Response status must be between 200 and 599, got ${status}.`);
    }
    if (body != null && NULL_BODY_STATUSES.has(status)) {
      throw new TypeError(`Response with status ${status} cannot have a body.`);
    }
    const boundary = createBoundary();
    super(body == null ? null : new InitSource(body, boundary));
    this.status = status;
    this.statusText = init.statusText ?? '';
    this.headers = new Headers(init.headers);
    this.type = 'default';
    this.url = '';
    this.redirected = false;
    if (body != null && !this.headers.has('content-type')) {
      const type = impliedContentType(body, boundary);
      if (type) {
        this.headers.set('content-type', type);
      }
    }
  }

  get ok(): boolean {
    return this.status >= 200 && this.status <= 299;
  }

  clone(): Response {
    return construct({
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      type: this.type,
      url: this.url,
      redirected: this.redirected,
      source: this.cloneSource(),
    });
  }

  protected contentType(): string | null {
    return this.headers.get('content-type');
  }

  _discard(): void {
    if (!this.bodyUsed) {
      this._source?.cancel();
    }
  }

  toJSON(): object {
    return {
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      redirected: this.redirected,
    };
  }

  get [Symbol.toStringTag](): string {
    return 'Response';
  }

  static json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new Response(JSON.stringify(data), { ...init, headers });
  }

  static error(): Response {
    return construct({
      status: 0,
      statusText: '',
      headers: new Headers(),
      type: 'error',
      url: '',
      redirected: false,
      source: null,
    });
  }

  static redirect(url: string, status = 302): Response {
    if (!REDIRECT_STATUSES.has(status)) {
      throw new RangeError(`Invalid redirect status: ${status}`);
    }
    return new Response(null, { status, headers: { location: normalizeUrl(url) } });
  }

  static _fromNetwork(init: NetworkResponseInit): Response {
    return construct(init);
  }
}
