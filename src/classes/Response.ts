import { Headers } from './Headers';
import { decoder, decodeBase64, zipPairs } from '../utils/encoding';

export class Response {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly type: string;
  
  private _bodyBase64: string;
  private _bodyUsed: boolean = false;

  constructor(
    status: number,
    statusText: string,
    headers: string[],
    bodyBase64: string,
    url: string,
    ok: boolean,
    redirected: boolean,
    type: string
  ) {
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.ok = ok;
    this.redirected = redirected;
    this.type = type;
    this._bodyBase64 = bodyBase64;

    this.headers = new Headers(zipPairs(headers));
  }

  get bodyUsed(): boolean {
    return this._bodyUsed;
  }

  private _ensureBodyNotUsed(): void {
    if (this._bodyUsed) {
      throw new TypeError('Body has already been consumed');
    }
    this._bodyUsed = true;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this._ensureBodyNotUsed();
    const bytes = decodeBase64(this._bodyBase64);
    return bytes.buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    this._ensureBodyNotUsed();
    const bytes = decodeBase64(this._bodyBase64);
    return decoder.decode(bytes);
  }

  async json<T = any>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async bytes(): Promise<Uint8Array> {
    this._ensureBodyNotUsed();
    return decodeBase64(this._bodyBase64);
  }

  clone(): Response {
    if (this._bodyUsed) {
      throw new TypeError('Cannot clone a Response whose body has been consumed');
    }
    
    const headersCopy = new Headers(this.headers);
    
    return new Response(
      this.status,
      this.statusText,
      ([] as string[]).concat(...Array.from(headersCopy.entries())),
      this._bodyBase64,
      this.url,
      this.ok,
      this.redirected,
      this.type
    );
  }
}
