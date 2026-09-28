import { Headers } from '../Headers';

describe('Headers', () => {
  it('is case-insensitive and joins repeated values', () => {
    const headers = new Headers({ 'Content-Type': 'text/plain' });
    headers.append('accept', 'a');
    headers.append('Accept', 'b');
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('ACCEPT')).toBe('a, b');
  });

  it('keeps Set-Cookie values separate', () => {
    const headers = Headers.fromPairs([
      ['Set-Cookie', 'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT'],
      ['Set-Cookie', 'b=2'],
    ]);
    expect(headers.getSetCookie()).toEqual(['a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2']);
    expect(Array.from(headers).filter(([name]) => name === 'set-cookie')).toHaveLength(2);
  });

  it('iterates in sorted order', () => {
    const headers = new Headers([
      ['z', '1'],
      ['a', '2'],
    ]);
    expect(Array.from(headers.keys())).toEqual(['a', 'z']);
  });

  it('rejects invalid names and values', () => {
    expect(() => new Headers({ 'bad name': 'x' })).toThrow(TypeError);
    expect(() => new Headers({ ok: 'line\r\nbreak' })).toThrow(TypeError);
  });

  it('trims surrounding whitespace', () => {
    expect(new Headers({ a: '  v \t' }).get('a')).toBe('v');
  });

  it('copies from another Headers', () => {
    const source = new Headers({ a: '1' });
    const copy = new Headers(source);
    source.set('a', '2');
    expect(copy.get('a')).toBe('1');
  });
});
