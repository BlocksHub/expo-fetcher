import { getNativeModule, type NativeSession, type NativeSessionConfig } from './native';

export interface SessionOptions {
  idleTimeout?: number;
  maxConnectionsPerHost?: number;
  cookies?: boolean;
  pinning?: Record<string, string[]>;
  waitsForConnectivity?: boolean;
}

const PIN_FORMAT = /^sha256\/[A-Za-z0-9+/]{43}=$/;

export function toNativeConfig(options: SessionOptions = {}): NativeSessionConfig {
  const pins = Object.entries(options.pinning ?? {}).map(([host, hashes]) => {
    if (!Array.isArray(hashes) || hashes.length === 0) {
      throw new TypeError(`pinning["${host}"] must list at least one hash.`);
    }
    for (const hash of hashes) {
      if (!PIN_FORMAT.test(hash)) {
        throw new TypeError(
          `Invalid pin "${hash}" for ${host}: expected "sha256/" followed by a base64 SHA-256 hash.`
        );
      }
    }
    return { host: host.toLowerCase(), hashes };
  });
  return {
    idleTimeout: options.idleTimeout ?? 60_000,
    maxConnectionsPerHost: options.maxConnectionsPerHost ?? 6,
    cookies: options.cookies ?? true,
    pins,
    waitsForConnectivity: options.waitsForConnectivity ?? false,
  };
}

const sessions = new Map<string, NativeSession>();

export function getSession(config: NativeSessionConfig): NativeSession {
  const key = JSON.stringify(config);
  let session = sessions.get(key);
  if (!session) {
    const { NativeSession } = getNativeModule();
    session = new NativeSession(config);
    sessions.set(key, session);
  }
  return session;
}

export function resetSessions(): void {
  sessions.clear();
}
