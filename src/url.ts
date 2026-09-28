import { FetchError } from './errors';

const ABSOLUTE_HTTP = /^https?:\/\/[^\s/?#]+/i;

export function encodeUnsafeCharacters(url: string): string {
  return url.replace(/[^\x21-\x7E]+/g, (match) => encodeURIComponent(match));
}

export function normalizeUrl(input: string): string {
  const url = encodeUnsafeCharacters(String(input).trim());
  if (!ABSOLUTE_HTTP.test(url)) {
    throw new FetchError(
      'ERR_INVALID_URL',
      `Invalid URL "${String(input)}": only absolute http:// and https:// URLs are supported.`
    );
  }
  return url;
}

export function resolveUrl(input: string, baseURL: string | undefined): string {
  if (!baseURL || ABSOLUTE_HTTP.test(input)) {
    return input;
  }
  const base = baseURL.replace(/\/+$/, '');
  const path = input.replace(/^\/+/, '');
  return path ? `${base}/${path}` : base;
}

export function appendSearchParams(
  url: string,
  params: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>
): string {
  let query: string;
  if (typeof params === 'string') {
    query = params.replace(/^\?/, '');
  } else if (typeof URLSearchParams === 'function' && params instanceof URLSearchParams) {
    query = params.toString();
  } else {
    query = Object.entries(params as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }
  if (!query) {
    return url;
  }
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${query}${hash}`;
}

export function redactUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/^(https?:\/\/)[^@/]*@/i, '$1');
}

export function hostOf(url: string): string {
  const match = /^https?:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : '';
}
