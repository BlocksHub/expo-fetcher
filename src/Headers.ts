export type HeadersInit =
  | Headers
  | globalThis.Headers
  | Record<string, string>
  | ReadonlyArray<readonly [string, string]>
  | Iterable<readonly [string, string]>;

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_VALUE = /[\0\r\n]/;

function normalizeName(name: string): string {
  const str = String(name);
  if (!TOKEN.test(str)) {
    throw new TypeError(`Invalid header name: "${str}"`);
  }
  return str.toLowerCase();
}

function normalizeValue(value: string): string {
  const str = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (INVALID_VALUE.test(str)) {
    throw new TypeError(`Invalid header value for: "${str}"`);
  }
  return str;
}

export class Headers implements Iterable<[string, string]> {
  private readonly map = new Map<string, string[]>();

  constructor(init?: HeadersInit | null) {
    if (init == null) {
      return;
    }
    if (init instanceof Headers) {
      for (const [name, values] of init.map) {
        this.map.set(name, values.slice());
      }
      return;
    }
    if (typeof (init as Iterable<unknown>)[Symbol.iterator] === 'function') {
      for (const pair of init as Iterable<readonly [string, string]>) {
        if (pair.length !== 2) {
          throw new TypeError('Each header pair must be [name, value]');
        }
        this.append(pair[0], pair[1]);
      }
      return;
    }
    for (const name of Object.keys(init)) {
      this.append(name, (init as Record<string, string>)[name]);
    }
  }

  append(name: string, value: string): void {
    const key = normalizeName(name);
    const val = normalizeValue(value);
    const existing = this.map.get(key);
    if (existing) {
      existing.push(val);
    } else {
      this.map.set(key, [val]);
    }
  }

  set(name: string, value: string): void {
    this.map.set(normalizeName(name), [normalizeValue(value)]);
  }

  delete(name: string): void {
    this.map.delete(normalizeName(name));
  }

  has(name: string): boolean {
    return this.map.has(normalizeName(name));
  }

  get(name: string): string | null {
    const values = this.map.get(normalizeName(name));
    if (!values) {
      return null;
    }
    return values.join(', ');
  }

  getSetCookie(): string[] {
    return this.map.get('set-cookie')?.slice() ?? [];
  }

  forEach(
    callback: (value: string, name: string, parent: Headers) => void,
    thisArg?: unknown
  ): void {
    for (const [name, value] of this) {
      callback.call(thisArg, value, name, this);
    }
  }

  *entries(): IterableIterator<[string, string]> {
    const names = Array.from(this.map.keys()).sort();
    for (const name of names) {
      const values = this.map.get(name)!;
      if (name === 'set-cookie') {
        for (const value of values) {
          yield [name, value];
        }
      } else {
        yield [name, values.join(', ')];
      }
    }
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.entries()) {
      yield name;
    }
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.entries()) {
      yield value;
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'Headers';
  }

  toPairs(): [string, string][] {
    const pairs: [string, string][] = [];
    for (const [name, values] of this.map) {
      for (const value of values) {
        pairs.push([name, value]);
      }
    }
    return pairs;
  }

  static fromPairs(pairs: ReadonlyArray<readonly [string, string]>): Headers {
    const headers = new Headers();
    for (const [name, value] of pairs) {
      const key = name.toLowerCase();
      const existing = headers.map.get(key);
      if (existing) {
        existing.push(value);
      } else {
        headers.map.set(key, [value]);
      }
    }
    return headers;
  }
}
