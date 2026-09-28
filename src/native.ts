import { requireNativeModule, type NativeModule, type SharedObject } from 'expo';

export type NativeHeaderPairs = [string, string][];

export interface NativeSessionConfig {
  idleTimeout: number;
  maxConnectionsPerHost: number;
  cookies: boolean;
  pins: { host: string; hashes: string[] }[];
  waitsForConnectivity: boolean;
}

export interface NativeRequestInit {
  method: string;
  headers: NativeHeaderPairs;
  redirect: 'follow' | 'error' | 'manual';
  credentials: 'include' | 'omit';
  cache: 'default' | 'no-store' | 'reload' | 'no-cache' | 'force-cache' | 'only-if-cached';
  reportUploadProgress: boolean;
  reportDownloadProgress: boolean;
}

export interface NativeBodyPart {
  data?: Uint8Array;
  uri?: string;
}

export interface NativeParts {
  layout: string[];
  chunks: Uint8Array[];
}

export function toNativeParts(parts: NativeBodyPart[] | null): NativeParts | null {
  if (!parts) {
    return null;
  }
  const layout: string[] = [];
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    if (part.uri !== undefined) {
      layout.push(part.uri);
    } else if (part.data) {
      layout.push('');
      chunks.push(part.data);
    }
  }
  return { layout, chunks };
}

export type NativeResponseEvents = {
  didReceiveResponseData(data: Uint8Array): void;
  didComplete(): void;
  didFailWithError(message: string, code: string): void;
  uploadProgress(sent: number, total: number): void;
  downloadProgress(received: number, total: number): void;
  readyForJSFinalization(): void;
};

export declare class NativeSession extends SharedObject {
  constructor(config: NativeSessionConfig);
}

export declare class NativeResponse extends SharedObject<NativeResponseEvents> {
  constructor();
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly redirected: boolean;
  readonly _rawHeaders: NativeHeaderPairs;
  startStreaming(): Promise<Uint8Array | null>;
  cancelStreaming(): Promise<void>;
  arrayBuffer(): Promise<ArrayBuffer | Uint8Array>;
  text(): Promise<string>;
}

export declare class NativeRequest extends SharedObject {
  constructor(response: NativeResponse);
  start(
    session: NativeSession,
    url: string,
    init: NativeRequestInit,
    body: Uint8Array | null,
    partLayout: string[] | null,
    partChunks: Uint8Array[] | null
  ): Promise<void>;
  cancel(): Promise<void>;
}

export interface NativeCookie {
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
}

declare class ExpoFetcherNativeModule extends NativeModule {
  NativeSession: typeof NativeSession;
  NativeRequest: typeof NativeRequest;
  NativeResponse: typeof NativeResponse;
  getCookies(url: string): Promise<NativeCookie[]>;
  setCookie(url: string, setCookieHeader: string): Promise<void>;
  clearCookies(): Promise<void>;
  clearCache(): Promise<void>;
}

let cached: ExpoFetcherNativeModule | null = null;

export function getNativeModule(): ExpoFetcherNativeModule {
  if (!cached) {
    cached = requireNativeModule<ExpoFetcherNativeModule>('ExpoFetcher');
  }
  return cached;
}
