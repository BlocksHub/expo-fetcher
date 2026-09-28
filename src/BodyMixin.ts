import {
  concatBytes,
  decodeUtf8,
  encodeBody,
  stripBom,
  toArrayBuffer,
  toUint8Array,
} from './encoding';
import { FetchError } from './errors';
import type { NativeResponse } from './native';

export interface BodySource {
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  chunks(): AsyncIterableIterator<Uint8Array>;
  cancel(): void;
}

export class BytesSource implements BodySource {
  constructor(private readonly data: Promise<Uint8Array>) {}

  bytes(): Promise<Uint8Array> {
    return this.data;
  }

  async text(): Promise<string> {
    return decodeUtf8(await this.data);
  }

  async *chunks(): AsyncIterableIterator<Uint8Array> {
    const data = await this.data;
    if (data.byteLength > 0) {
      yield data;
    }
  }

  cancel(): void {}
}

export class InitSource implements BodySource {
  private encoded: Promise<Uint8Array> | null = null;

  constructor(
    private readonly init: unknown,
    private readonly boundary: string
  ) {}

  bytes(): Promise<Uint8Array> {
    if (!this.encoded) {
      this.encoded = encodeBody(this.init, this.boundary).then((body) => {
        if (body.parts) {
          throw new FetchError(
            'ERR_BODY_READ',
            'A body that references local files can only be sent, not read back in JavaScript.'
          );
        }
        return body.bytes ?? new Uint8Array(0);
      });
    }
    return this.encoded;
  }

  async text(): Promise<string> {
    if (typeof this.init === 'string') {
      return this.init;
    }
    return decodeUtf8(await this.bytes());
  }

  async *chunks(): AsyncIterableIterator<Uint8Array> {
    const data = await this.bytes();
    if (data.byteLength > 0) {
      yield data;
    }
  }

  cancel(): void {}
}

type Waiter = {
  resolve: (result: IteratorResult<Uint8Array>) => void;
  reject: (error: unknown) => void;
};

export class NativeSource implements BodySource {
  private abortReason: unknown = undefined;
  private finished = false;

  constructor(
    private readonly response: NativeResponse,
    private readonly onFinish: () => void
  ) {}

  abort(reason: unknown): void {
    this.abortReason = reason;
  }

  private rethrow(error: unknown): never {
    if (this.abortReason !== undefined) {
      throw this.abortReason;
    }
    throw new FetchError('ERR_BODY_READ', `Could not read the response body: ${String(error)}`, {
      cause: error,
    });
  }

  async bytes(): Promise<Uint8Array> {
    try {
      const result = await this.response.arrayBuffer();
      return toUint8Array(result as ArrayBuffer);
    } catch (error) {
      this.rethrow(error);
    } finally {
      this.finish();
    }
  }

  async text(): Promise<string> {
    try {
      return stripBom(await this.response.text());
    } catch (error) {
      this.rethrow(error);
    } finally {
      this.finish();
    }
  }

  chunks(): AsyncIterableIterator<Uint8Array> {
    const response = this.response;
    const queue: Uint8Array[] = [];
    const waiters: Waiter[] = [];
    let done = false;
    let failure: unknown = null;
    let started = false;

    const settle = () => {
      while (waiters.length > 0) {
        if (queue.length > 0) {
          waiters.shift()!.resolve({ value: queue.shift()!, done: false });
        } else if (failure !== null) {
          waiters.shift()!.reject(failure);
        } else if (done) {
          waiters.shift()!.resolve({ value: undefined, done: true });
        } else {
          return;
        }
      }
    };

    const subscriptions = [
      response.addListener('didReceiveResponseData', (data) => {
        if (!done && data.byteLength > 0) {
          queue.push(toUint8Array(data));
          settle();
        }
      }),
      response.addListener('didComplete', () => {
        done = true;
        cleanup();
        settle();
      }),
      response.addListener('didFailWithError', (message) => {
        failure =
          this.abortReason !== undefined
            ? this.abortReason
            : new FetchError('ERR_BODY_READ', `Could not read the response body: ${message}`);
        done = true;
        cleanup();
        settle();
      }),
    ];

    const cleanup = () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
      this.finish();
    };

    const start = async () => {
      started = true;
      try {
        const completed = await response.startStreaming();
        if (completed != null) {
          if (completed.byteLength > 0) {
            queue.push(toUint8Array(completed));
          }
          done = true;
          cleanup();
        }
      } catch (error) {
        failure = this.abortReason !== undefined ? this.abortReason : error;
        done = true;
        cleanup();
      }
      settle();
    };

    const iterator: AsyncIterableIterator<Uint8Array> = {
      next: () => {
        if (!started) {
          void start();
        }
        return new Promise((resolve, reject) => {
          waiters.push({ resolve, reject });
          settle();
        });
      },
      return: async () => {
        if (!done) {
          done = true;
          queue.length = 0;
          cleanup();
          void response.cancelStreaming().catch(() => {});
          settle();
        }
        return { value: undefined, done: true };
      },
      [Symbol.asyncIterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  cancel(): void {
    void this.response.cancelStreaming().catch(() => {});
    this.finish();
  }

  private finish(): void {
    if (!this.finished) {
      this.finished = true;
      this.onFinish();
    }
  }
}

export async function readAll(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const list: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    list.push(chunk);
    length += chunk.byteLength;
  }
  return list.length === 0 ? new Uint8Array(0) : concatBytes(list, length);
}

export abstract class Body {
  _source: BodySource | null;
  private used = false;
  private readable: ReadableStream<Uint8Array> | null = null;

  protected constructor(source: BodySource | null) {
    this._source = source;
  }

  get bodyUsed(): boolean {
    return this.used;
  }

  get body(): ReadableStream<Uint8Array> | null {
    if (!this._source) {
      return null;
    }
    if (this.readable) {
      return this.readable;
    }
    if (typeof ReadableStream !== 'function') {
      throw new TypeError(
        'ReadableStream is not available. Install a polyfill (web-streams-polyfill) or iterate `response.stream()` instead.'
      );
    }
    const iterator = this.take().chunks();
    this.readable = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });
    return this.readable;
  }

  stream(): AsyncIterableIterator<Uint8Array> {
    if (!this._source) {
      return (async function* () {})();
    }
    return this.take().chunks();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return toArrayBuffer(await this.bytes());
  }

  async bytes(): Promise<Uint8Array> {
    if (!this._source) {
      this.markUsed();
      return new Uint8Array(0);
    }
    return this.take().bytes();
  }

  async text(): Promise<string> {
    if (!this._source) {
      this.markUsed();
      return '';
    }
    return this.take().text();
  }

  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new SyntaxError(
        `Response body is not valid JSON (${(error as Error).message}). Starts with: ${JSON.stringify(text.slice(0, 80))}`
      );
    }
  }

  async blob(): Promise<Blob> {
    const bytes = await this.bytes();
    const type = this.contentType() ?? '';
    return new Blob([toArrayBuffer(bytes)], { type });
  }

  async formData(): Promise<FormData> {
    const type = this.contentType() ?? '';
    if (!/application\/x-www-form-urlencoded/i.test(type)) {
      throw new TypeError(
        'formData() only supports application/x-www-form-urlencoded bodies in React Native.'
      );
    }
    const params = new URLSearchParams(await this.text());
    const form = new FormData();
    params.forEach((value, key) => form.append(key, value));
    return form;
  }

  protected abstract contentType(): string | null;

  private markUsed(): void {
    if (this.used) {
      throw new FetchError('ERR_BODY_USED', 'Body has already been consumed.');
    }
    this.used = true;
  }

  private take(): BodySource {
    this.markUsed();
    return this._source!;
  }

  protected cloneSource(): BodySource | null {
    if (this.used) {
      throw new FetchError('ERR_BODY_USED', 'Cannot clone a body that has already been consumed.');
    }
    if (!this._source) {
      return null;
    }
    const shared = this._source.bytes();
    shared.catch(() => {});
    this._source = new BytesSource(shared);
    return new BytesSource(shared);
  }
}
