type HeadersInit = Headers | Record<string, string> | [string, string][];

export class Headers {
  private _headers: Map<string, string>;

  constructor(init?: HeadersInit) {
    this._headers = new Map();
    
    if (init) {
      if (init instanceof Headers) {
        init.forEach((value, key) => {
          this.append(key, value);
        });
      } else if (Array.isArray(init)) {
        for (const [key, value] of init) {
          this.append(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(init)) {
          this.append(key, value);
        }
      }
    }
  }

  append(name: string, value: string): void {
    const normalizedName = name.toLowerCase();
    const existingValue = this._headers.get(normalizedName);
    
    if (existingValue) {
      this._headers.set(normalizedName, `${existingValue}, ${value}`);
    } else {
      this._headers.set(normalizedName, value);
    }
  }

  delete(name: string): void {
    this._headers.delete(name.toLowerCase());
  }

  get(name: string): string | null {
    return this._headers.get(name.toLowerCase()) ?? null;
  }

  has(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }

  set(name: string, value: string): void {
    this._headers.set(name.toLowerCase(), value);
  }

  forEach(callback: (value: string, key: string, parent: Headers) => void): void {
    this._headers.forEach((value, key) => {
      callback(value, key, this);
    });
  }

  entries(): IterableIterator<[string, string]> {
    return this._headers.entries();
  }

  keys(): IterableIterator<string> {
    return this._headers.keys();
  }

  values(): IterableIterator<string> {
    return this._headers.values();
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this._headers.entries();
  }
}
