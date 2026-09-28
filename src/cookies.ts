import { getNativeModule, type NativeCookie } from './native';
import { normalizeUrl } from './url';

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
  expires: Date | null;
  secure: boolean;
  httpOnly: boolean;
}

function serialize(cookie: Cookie): string {
  const parts = [`${cookie.name}=${cookie.value}`];
  if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
  parts.push(`Path=${cookie.path ?? '/'}`);
  if (cookie.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(cookie.maxAge)}`);
  else if (cookie.expires) parts.push(`Expires=${cookie.expires.toUTCString()}`);
  if (cookie.secure) parts.push('Secure');
  if (cookie.httpOnly) parts.push('HttpOnly');
  if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`);
  return parts.join('; ');
}

function fromNative(cookie: NativeCookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires == null ? null : new Date(cookie.expires),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
}

export const cookies = {
  async get(url: string): Promise<StoredCookie[]> {
    const list = await getNativeModule().getCookies(normalizeUrl(url));
    return list.map(fromNative);
  },

  async set(url: string, cookie: Cookie | string): Promise<void> {
    const header = typeof cookie === 'string' ? cookie : serialize(cookie);
    await getNativeModule().setCookie(normalizeUrl(url), header);
  },

  async clear(): Promise<void> {
    await getNativeModule().clearCookies();
  },
};

export function clearCookies(): Promise<void> {
  return cookies.clear();
}

export async function clearCache(): Promise<void> {
  await getNativeModule().clearCache();
}
