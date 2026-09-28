import { calls, setHandler } from './fakeNative';
import { createClient, parseRetryAfter } from '../client';
import { Request } from '../Request';
import { Response } from '../Response';

const noDelay = { delay: () => 0 };

describe('createClient', () => {
  it('resolves paths against baseURL and merges headers', async () => {
    const api = createClient({ baseURL: 'https://api.test/v1/', headers: { 'X-App': '1', Accept: 'a' } });
    await api.get('/users', { headers: { accept: 'b' }, searchParams: { page: 2, q: 'a b' } });
    expect(calls[0].url).toBe('https://api.test/v1/users?page=2&q=a%20b');
    expect(calls[0].init.headers).toEqual(expect.arrayContaining([['x-app', '1'], ['accept', 'b']]));
  });

  it('sends json bodies and parses json responses', async () => {
    setHandler((call) => ({ headers: [['content-type', 'application/json']], chunks: [new TextDecoder().decode(call.body!)] }));
    const api = createClient({ baseURL: 'https://api.test' });
    const result = await api.json<{ a: number }>('/echo', { method: 'POST', json: { a: 1 } });
    expect(result).toEqual({ a: 1 });
    expect(calls[0].init.headers).toContainEqual(['content-type', 'application/json']);
  });

  it('retries idempotent requests on retryable statuses', async () => {
    let n = 0;
    setHandler(() => ({ status: ++n < 3 ? 503 : 200, chunks: ['ok'] }));
    const api = createClient({ retry: { limit: 3, ...noDelay } });
    const response = await api.get('https://api.test/flaky');
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('does not retry POST by default', async () => {
    setHandler(() => ({ status: 503 }));
    const api = createClient({ retry: { limit: 3, ...noDelay } });
    const response = await api.post('https://api.test/x', { body: 'x' });
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
  });

  it('retries network errors but not pinning failures', async () => {
    setHandler(() => ({ errorCode: 'ERR_FETCHER_NETWORK' }));
    const api = createClient({ retry: { limit: 2, ...noDelay } });
    await expect(api.get('https://api.test')).rejects.toMatchObject({ code: 'ERR_NETWORK' });
    expect(calls).toHaveLength(3);

    calls.length = 0;
    setHandler(() => ({ errorCode: 'ERR_FETCHER_PINNING' }));
    await expect(api.get('https://api.test')).rejects.toMatchObject({ code: 'ERR_PINNING' });
    expect(calls).toHaveLength(1);
  });

  it('honours Retry-After and maxRetryAfter', async () => {
    setHandler(() => ({ status: 429, headers: [['retry-after', '120']] }));
    const api = createClient({ retry: { limit: 2, maxRetryAfter: 1000 } });
    const response = await api.get('https://api.test');
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(1);
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
  });

  it('replays the same body on each retry', async () => {
    let n = 0;
    setHandler(() => ({ status: ++n < 2 ? 500 : 200 }));
    const api = createClient({ retry: { limit: 1, ...noDelay } });
    await api.put('https://api.test', { body: 'payload' });
    expect(calls.map((c) => new TextDecoder().decode(c.body!))).toEqual(['payload', 'payload']);
  });

  it('runs hooks in order and lets beforeRequest short-circuit', async () => {
    const order: string[] = [];
    const api = createClient({
      hooks: {
        beforeRequest: [
          (request) => {
            order.push('before');
            return new Request(request, { headers: { authorization: 'Bearer t' } });
          },
        ],
        afterResponse: [
          (_request, response) => {
            order.push(`after ${response.status}`);
          },
        ],
      },
    });
    await api.get('https://api.test');
    expect(order).toEqual(['before', 'after 200']);
    expect(calls[0].init.headers).toContainEqual(['authorization', 'Bearer t']);

    const cached = createClient({ hooks: { beforeRequest: [() => new Response('cached')] } });
    expect(await (await cached.get('https://api.test')).text()).toBe('cached');
    expect(calls).toHaveLength(1);
  });

  it('refreshes a token after a 401 via afterResponse', async () => {
    let token = 'old';
    setHandler((call) => ({
      status: call.init.headers.some(([k, v]: string[]) => k === 'authorization' && v === 'Bearer new') ? 200 : 401,
    }));
    const api = createClient({
      hooks: {
        beforeRequest: [(request) => new Request(request, { headers: { authorization: `Bearer ${token}` } })],
        afterResponse: [
          async (request, response) => {
            if (response.status === 401) {
              token = 'new';
              return api(new Request(request, { headers: { authorization: `Bearer ${token}` } }));
            }
          },
        ],
      },
    });
    expect((await api.get('https://api.test/me')).status).toBe(200);
  });

  it('throws ERR_HTTP with a readable response when asked', async () => {
    setHandler(() => ({ status: 422, statusText: 'Unprocessable', chunks: ['{"field":"email"}'] }));
    const api = createClient({ throwHttpErrors: true });
    const error = await api.get('https://api.test').catch((e) => e);
    expect(error.code).toBe('ERR_HTTP');
    expect(error.status).toBe(422);
    expect(await error.response.json()).toEqual({ field: 'email' });
  });

  it('lets beforeError rewrite errors', async () => {
    setHandler(() => ({ status: 500 }));
    const api = createClient({
      retry: 0,
      hooks: { beforeError: [(error) => Object.assign(error, { message: 'rewritten' })] },
    });
    await expect(api.json('https://api.test')).rejects.toThrow('rewritten');
  });

  it('dedupes identical in-flight GETs', async () => {
    setHandler(() => ({ chunks: ['shared'], delay: 5 }));
    const api = createClient({ dedupe: true });
    const [a, b] = await Promise.all([api.get('https://api.test/x'), api.get('https://api.test/x')]);
    expect(calls).toHaveLength(1);
    expect(await a.text()).toBe('shared');
    expect(await b.text()).toBe('shared');
  });

  it('applies the client timeout', async () => {
    setHandler(() => ({ delay: 100 }));
    const api = createClient({ timeout: 10, retry: 0 });
    await expect(api.get('https://api.test')).rejects.toMatchObject({ code: 'ERR_TIMEOUT' });
  });

  it('stops retrying when the signal aborts during backoff', async () => {
    setHandler(() => ({ status: 503 }));
    const controller = new AbortController();
    const api = createClient({ retry: { limit: 5, delay: () => 1000 } });
    const pending = api.get('https://api.test', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shares a native session between clients with the same settings', async () => {
    const a = createClient({ pinning: { 'api.test': ['sha256/' + 'A'.repeat(43) + '='] } });
    const b = createClient({ pinning: { 'api.test': ['sha256/' + 'A'.repeat(43) + '='] } });
    await a.get('https://api.test');
    await b.get('https://api.test');
    expect(calls[0].session).toBe(calls[1].session);
    expect(calls[0].session.config.pins).toEqual([{ host: 'api.test', hashes: ['sha256/' + 'A'.repeat(43) + '='] }]);
  });

  it('validates pins', () => {
    expect(() => createClient({ pinning: { 'a.test': ['md5/abc'] } })).toThrow(TypeError);
  });

  it('extends clients', async () => {
    const base = createClient({ baseURL: 'https://api.test', headers: { a: '1' } });
    const child = base.extend({ headers: { b: '2' } });
    await child.get('/x');
    expect(calls[0].url).toBe('https://api.test/x');
    expect(calls[0].init.headers).toEqual(expect.arrayContaining([['a', '1'], ['b', '2']]));
  });
});
