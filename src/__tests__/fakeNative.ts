
type Listener = (...args: any[]) => void;

export interface FakeReply {
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  url?: string;
  redirected?: boolean;
  chunks?: (string | Uint8Array)[];
  delay?: number;
  chunkDelay?: number;
  errorCode?: string;
  bodyError?: string;
}

export interface FakeCall {
  url: string;
  init: any;
  body: Uint8Array | null;
  parts: any[] | null;
  session: FakeSession;
}

type Handler = (call: FakeCall) => FakeReply | Promise<FakeReply>;

let handler: Handler = () => ({ status: 200, chunks: [] });
export const calls: FakeCall[] = [];

export function setHandler(next: Handler): void {
  handler = next;
}

export function reset(): void {
  calls.length = 0;
  handler = () => ({ status: 200, chunks: [] });
}

const encoder = new TextEncoder();
const toBytes = (chunk: string | Uint8Array) =>
  typeof chunk === 'string' ? encoder.encode(chunk) : chunk;

class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  addListener(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return { remove: () => this.listeners.get(event)?.delete(listener) };
  }
  emit(event: string, ...args: any[]) {
    for (const listener of Array.from(this.listeners.get(event) ?? [])) listener(...args);
  }
  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export class FakeSession {
  constructor(public config: any) {}
}

export class FakeResponse extends Emitter {
  status = -1;
  statusText = '';
  url = '';
  redirected = false;
  _rawHeaders: [string, string][] = [];
  state: 'init' | 'head' | 'streaming' | 'done' | 'error' | 'canceled' = 'init';
  sink: Uint8Array[] = [];
  error: Error | null = null;
  private waiters: (() => void)[] = [];

  notify() {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  waitDone(): Promise<void> {
    if (this.state === 'done' || this.state === 'error') return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  drain(): Uint8Array {
    const total = this.sink.reduce((n, c) => n + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.sink) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    this.sink = [];
    return out;
  }

  async startStreaming(): Promise<Uint8Array | null> {
    if (this.state === 'done') return this.drain();
    if (this.state === 'head') {
      this.state = 'streaming';
      this.emit('didReceiveResponseData', this.drain());
    }
    return null;
  }

  async cancelStreaming(): Promise<void> {
    this.state = 'canceled';
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    await this.waitDone();
    if (this.error) throw this.error;
    const bytes = this.drain();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  async text(): Promise<string> {
    await this.waitDone();
    if (this.error) throw this.error;
    return new TextDecoder().decode(this.drain());
  }
}

function nativeError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export class FakeRequest {
  canceled = false;
  constructor(public response: FakeResponse) {}

  async start(session: FakeSession, url: string, init: any, body: Uint8Array | null, parts: any[] | null) {
    const call = { url, init, body, parts, session };
    calls.push(call);
    const reply = await handler(call);
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    if (this.canceled) throw nativeError('ERR_FETCHER_CANCELED', 'canceled');
    if (reply.errorCode) throw nativeError(reply.errorCode, 'native failure');

    const res = this.response;
    res.status = reply.status ?? 200;
    res.statusText = reply.statusText ?? '';
    res.url = reply.url ?? url;
    res.redirected = reply.redirected ?? false;
    res._rawHeaders = reply.headers ?? [];
    res.state = 'head';
    this.pump(reply);
  }

  private async pump(reply: FakeReply) {
    const res = this.response;
    const chunks = (reply.chunks ?? []).map(toBytes);
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    let received = 0;
    for (const chunk of chunks) {
      await new Promise((r) => setTimeout(r, reply.chunkDelay ?? 0));
      if (this.canceled || res.state === 'canceled') return;
      received += chunk.byteLength;
      if (res.state === 'streaming') res.emit('didReceiveResponseData', chunk);
      else res.sink.push(chunk);
      res.emit('downloadProgress', received, total);
    }
    await new Promise((r) => setTimeout(r, 0));
    if (this.canceled) return;
    if (reply.bodyError) {
      res.error = new Error(reply.bodyError);
      if (res.state === 'streaming') res.emit('didFailWithError', reply.bodyError, 'ERR_FETCHER_NETWORK');
      res.state = 'error';
    } else {
      if (res.state === 'streaming') res.emit('didComplete');
      res.state = 'done';
    }
    res.notify();
    res.emit('readyForJSFinalization');
  }

  async cancel() {
    this.canceled = true;
    const res = this.response;
    res.error = nativeError('ERR_FETCHER_CANCELED', 'canceled');
    if (res.state === 'streaming') res.emit('didFailWithError', 'canceled', 'ERR_FETCHER_CANCELED');
    res.state = 'error';
    res.notify();
    res.emit('readyForJSFinalization');
  }
}

export const cookieStore = new Map<string, string[]>();

export const fakeModule = {
  NativeSession: FakeSession,
  NativeRequest: FakeRequest,
  NativeResponse: FakeResponse,
  async getCookies(url: string) {
    return (cookieStore.get(url) ?? []).map((header) => {
      const [pair] = header.split(';');
      const [name, value] = pair.split('=');
      return { name, value, domain: null, path: null, expires: null, secure: false, httpOnly: false };
    });
  },
  async setCookie(url: string, header: string) {
    cookieStore.set(url, [...(cookieStore.get(url) ?? []), header]);
  },
  async clearCookies() {
    cookieStore.clear();
  },
  async clearCache() {},
};
