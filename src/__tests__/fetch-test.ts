import { calls, setHandler } from './fakeNative';
import { FetchError } from '../errors';
import { fetch } from '../fetch';
import { Request } from '../Request';
import { Response } from '../Response';

describe('fetch', () => {
  it('sends method, headers and UTF-8 body, and exposes the response', async () => {
    setHandler(() => ({
      status: 201,
      statusText: 'Created',
      headers: [
        ['Content-Type', 'application/json'],
        ['Set-Cookie', 'a=1'],
        ['Set-Cookie', 'b=2'],
      ],
      chunks: ['{"ok":', 'true}'],
    }));
    const response = await fetch('https://api.test/items', {
      method: 'post',
      headers: { Authorization: 'Bearer secret' },
      body: 'héllo',
    });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toContainEqual(['authorization', 'Bearer secret']);
    expect(calls[0].init.headers).toContainEqual(['content-type', 'text/plain;charset=UTF-8']);
    expect(calls[0].body!.byteLength).toBe(6);
    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
    expect(response.type).toBe('basic');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toMatchObject({ code: 'ERR_BODY_USED' });
  });

  it('returns binary bodies byte for byte', async () => {
    setHandler(() => ({ chunks: [new Uint8Array([0, 255]), new Uint8Array([128])] }));
    const response = await fetch('https://api.test/bin');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 255, 128]);
  });

  it('streams chunks as they arrive', async () => {
    setHandler(() => ({ chunks: ['a', 'b', 'c'], chunkDelay: 5 }));
    const response = await fetch('https://api.test/stream');
    const seen: string[] = [];
    for await (const chunk of response.stream()) {
      seen.push(new TextDecoder().decode(chunk));
    }
    expect(seen.join('')).toBe('abc');
    expect(seen.length).toBeGreaterThan(1);
  });

  it('exposes a ReadableStream body when the runtime has one', async () => {
    setHandler(() => ({ chunks: ['x', 'y'] }));
    const response = await fetch('https://api.test/rs');
    const reader = response.body!.getReader();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out).toBe('xy');
  });

  it('rejects with the abort reason before the head arrives', async () => {
    setHandler(() => ({ delay: 50 }));
    const controller = new AbortController();
    const pending = fetch('https://api.test/slow', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(fetch('https://api.test', { signal: controller.signal })).rejects.toThrow('stop');
    expect(calls).toHaveLength(0);
  });

  it('aborts while the body is streaming', async () => {
    setHandler(() => ({ chunks: ['a', 'b', 'c', 'd'], chunkDelay: 10 }));
    const controller = new AbortController();
    const response = await fetch('https://api.test/stream', { signal: controller.signal });
    const iterator = response.stream();
    await iterator.next();
    controller.abort();
    await expect(
      (async () => {
        for (;;) {
          const { done } = await iterator.next();
          if (done) return;
        }
      })()
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out with ERR_TIMEOUT', async () => {
    setHandler(() => ({ delay: 100 }));
    await expect(fetch('https://api.test/slow', { timeout: 10 })).rejects.toMatchObject({
      code: 'ERR_TIMEOUT',
    });
  });

  it('maps native error codes and keeps secrets out of messages', async () => {
    setHandler(() => ({ errorCode: 'ERR_FETCHER_PINNING' }));
    const error = await fetch('https://user:pw@api.test/path?token=abc', {
      headers: { Authorization: 'Bearer secret' },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(FetchError);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe('ERR_PINNING');
    expect(error.message).not.toMatch(/secret|token|pw/);
    expect(error.request).toEqual({ method: 'GET', url: 'https://api.test/path' });
  });

  it('rejects invalid URLs', async () => {
    await expect(fetch('/relative')).rejects.toMatchObject({ code: 'ERR_INVALID_URL' });
    await expect(fetch('ftp://x.test')).rejects.toMatchObject({ code: 'ERR_INVALID_URL' });
  });

  it('percent-encodes spaces and non-ASCII characters', async () => {
    await fetch('https://api.test/a b/é?q=ü');
    expect(calls[0].url).toBe('https://api.test/a%20b/%C3%A9?q=%C3%BC');
  });

  it('reports download progress', async () => {
    setHandler(() => ({ chunks: ['aa', 'bb'] }));
    const events: number[] = [];
    const response = await fetch('https://api.test/p', {
      onDownloadProgress: ({ loaded }) => events.push(loaded),
    });
    await response.text();
    expect(calls[0].init.reportDownloadProgress).toBe(true);
    expect(events).toEqual([2, 4]);
  });

  it('gives HEAD and 204 responses a null body', async () => {
    setHandler(() => ({ status: 204 }));
    const response = await fetch('https://api.test/none', { method: 'DELETE' });
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('sends multipart file uploads as parts', async () => {
    const form = { _parts: [['f', { uri: 'file:///x.bin' }]] } as unknown as FormData;
    await fetch('https://api.test/upload', { method: 'POST', body: form });
    expect(calls[0].body).toBeNull();
    expect(calls[0].parts![1]).toEqual({ uri: 'file:///x.bin' });
    const type = calls[0].init.headers.find(([k]: string[]) => k === 'content-type')[1];
    expect(type).toMatch(/^multipart\/form-data; boundary=----ExpoFetcherBoundary/);
  });

  it('maps credentials to the native cookie flag', async () => {
    await fetch('https://api.test', { credentials: 'omit' });
    await fetch('https://api.test', { credentials: 'same-origin' });
    expect(calls.map((c) => c.init.credentials)).toEqual(['omit', 'include']);
  });

  it('accepts a Request object', async () => {
    const request = new Request('https://api.test/r', { method: 'PUT', body: 'x' });
    await fetch(request);
    expect(calls[0].init.method).toBe('PUT');
  });
});

describe('Response', () => {
  it('clones so both copies can be read', async () => {
    setHandler(() => ({ chunks: ['data'] }));
    const response = await fetch('https://api.test');
    const copy = response.clone();
    expect(await copy.text()).toBe('data');
    expect(await response.text()).toBe('data');
  });

  it('can be built in JS', async () => {
    const response = Response.json({ a: 1 }, { status: 202 });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ a: 1 });
    expect(Response.error().type).toBe('error');
    expect(Response.redirect('https://x.test', 301).headers.get('location')).toBe('https://x.test');
  });

  it('rejects bodies on null-body statuses', () => {
    expect(() => new Response('x', { status: 204 })).toThrow(TypeError);
  });
});

describe('Request', () => {
  it('forbids bodies on GET', () => {
    expect(() => new Request('https://a.test', { body: 'x' })).toThrow(TypeError);
  });

  it('reads its own body', async () => {
    const request = new Request('https://a.test', { method: 'POST', body: new URLSearchParams({ a: 'b' }) });
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8');
    expect(await request.clone().text()).toBe('a=b');
  });
});
