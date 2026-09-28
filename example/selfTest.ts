import { fetch as expoFetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { cookies, createClient, fetch, FetchError } from 'expo-fetcher';
import { Platform } from 'react-native';

export const HOST = Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://localhost:8787';

export type CaseResult = { name: string; ok: boolean; ms: number; detail: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function pattern(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = i % 256;
  return bytes;
}

function isPattern(bytes: Uint8Array, offset = 0): boolean {
  for (let i = 0; i < bytes.length; i += 997) {
    if (bytes[i] !== (i + offset) % 256) return false;
  }
  return bytes.length === 0 || bytes[bytes.length - 1] === (bytes.length - 1 + offset) % 256;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    const actual = (error as FetchError).code ?? (error as Error).name;
    assert(actual === code, `expected ${code}, got ${actual}: ${(error as Error).message}`);
    return actual;
  }
  throw new Error(`expected ${code}, but the request succeeded`);
}

function writeTempFile(name: string, size: number): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(pattern(size));
  return file;
}

type Case = [name: string, run: () => Promise<string | void>];

const cases: Case[] = [
  ['GET JSON', async () => {
    const res = await fetch(`${HOST}/echo`, { headers: { 'X-Test': 'yes' } });
    const body = await res.json<{ method: string; headers: Record<string, string> }>();
    assert(res.ok && res.status === 200 && res.statusText === 'OK', `status ${res.status} "${res.statusText}"`);
    assert(body.headers['x-test'] === 'yes', 'custom header not received');
    return `type=${res.type}`;
  }],
  ['UTF-8 body length', async () => {
    const text = 'héllo € 🚀';
    const body = await (await fetch(`${HOST}/echo`, { method: 'POST', body: text })).json<any>();
    assert(body.bodyLength === 15, `server got ${body.bodyLength} bytes, expected 15`);
    assert(body.text === text, `server got "${body.text}"`);
    assert(body.headers['content-type'] === 'text/plain;charset=UTF-8', body.headers['content-type']);
  }],
  ['Binary upload byte-identical', async () => {
    const body = await (await fetch(`${HOST}/verify`, { method: 'POST', body: pattern(300_000) })).json<any>();
    assert(body.ok && body.bodyLength === 300_000, JSON.stringify(body));
  }],
  ['Binary download byte-identical (5 MB)', async () => {
    const buffer = await (await fetch(`${HOST}/bytes?n=${5 * 1024 * 1024}`)).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert(bytes.length === 5 * 1024 * 1024 && isPattern(bytes), `got ${bytes.length} bytes`);
  }],
  ['Streaming 20 MB in chunks', async () => {
    const res = await fetch(`${HOST}/bytes?n=${20 * 1024 * 1024}`);
    let chunks = 0;
    let total = 0;
    for await (const chunk of res.stream()) {
      assert(isPattern(chunk, total % 256), `bad bytes in chunk ${chunks}`);
      chunks += 1;
      total += chunk.length;
    }
    assert(total === 20 * 1024 * 1024 && chunks > 1, `${total} bytes in ${chunks} chunks`);
    return `${chunks} chunks`;
  }],
  ['Slow chunked stream arrives incrementally', async () => {
    const res = await fetch(`${HOST}/stream?chunks=5&size=1000&delay=100`);
    const times: number[] = [];
    const start = Date.now();
    for await (const _ of res.stream()) times.push(Date.now() - start);
    assert(times.length >= 3 && times[times.length - 1] - times[0] >= 200, `chunk times ${times}`);
  }],
  ['Abort before response head', async () => {
    const controller = new AbortController();
    const pending = fetch(`${HOST}/slow?ms=3000`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expectCode(pending, 'AbortError');
  }],
  ['Abort during body stream', async () => {
    const controller = new AbortController();
    const res = await fetch(`${HOST}/stream?chunks=40&size=1000&delay=100`, { signal: controller.signal });
    const iterator = res.stream();
    await iterator.next();
    controller.abort();
    await expectCode((async () => { while (!(await iterator.next()).done); })(), 'AbortError');
  }],
  ['Timeout', () => expectCode(fetch(`${HOST}/slow?ms=3000`, { timeout: 300 }), 'ERR_TIMEOUT').then(() => {})],
  ['Redirect follow', async () => {
    const res = await fetch(`${HOST}/redirect?n=3`);
    assert(res.status === 200 && res.redirected && res.url.endsWith('/echo'), `${res.status} ${res.redirected} ${res.url}`);
  }],
  ['Redirect error', () => expectCode(fetch(`${HOST}/redirect`, { redirect: 'error' }), 'ERR_REDIRECT').then(() => {})],
  ['Redirect manual', async () => {
    const res = await fetch(`${HOST}/redirect`, { redirect: 'manual' });
    assert(res.status === 302 && res.headers.get('location') === '/echo', `${res.status} ${res.headers.get('location')}`);
    await res.text();
  }],
  ['Two Set-Cookie headers', async () => {
    await cookies.clear();
    const res = await fetch(`${HOST}/cookies/set`);
    const list = res.headers.getSetCookie();
    await res.text();
    assert(list.length === 2 && list[0].startsWith('first=1') && list[1].startsWith('second=2'), JSON.stringify(list));
  }],
  ['Cookies stored, sent, omitted, cleared', async () => {
    const sent = await (await fetch(`${HOST}/cookies/echo`)).json<any>();
    assert(/first=1/.test(sent.cookie) && /second=2/.test(sent.cookie), `sent: ${sent.cookie}`);
    const stored = await cookies.get(HOST);
    assert(stored.some((c) => c.name === 'first'), JSON.stringify(stored));
    const omitted = await (await fetch(`${HOST}/cookies/echo`, { credentials: 'omit' })).json<any>();
    assert(omitted.cookie === null, `omit still sent ${omitted.cookie}`);
    await cookies.set(HOST, { name: 'manual', value: 'v' });
    const manual = await (await fetch(`${HOST}/cookies/echo`)).json<any>();
    assert(/manual=v/.test(manual.cookie), `manual cookie: ${manual.cookie}`);
    await cookies.clear();
    const cleared = await (await fetch(`${HOST}/cookies/echo`)).json<any>();
    assert(cleared.cookie === null, `after clear: ${cleared.cookie}`);
  }],
  ['gzip and brotli decoding', async () => {
    const gz = await (await fetch(`${HOST}/gzip`)).json<any>();
    const br = await (await fetch(`${HOST}/br`)).json<any>();
    assert(gz.encoding === 'gzip' && br.encoding === 'br', 'decoding failed');
  }],
  ['Multipart upload with a file from disk', async () => {
    const file = writeTempFile('upload.bin', 2 * 1024 * 1024 + 7);
    const form = new FormData();
    form.append('title', 'héllo');
    form.append('file', { uri: file.uri, name: 'upload.bin', type: 'application/octet-stream' } as any);
    const body = await (await fetch(`${HOST}/verify-multipart`, { method: 'POST', body: form })).json<any>();
    assert(Array.isArray(body.parts) && body.parts.length === 2, JSON.stringify(body));
    const [title, part] = body.parts;
    assert(title.text === 'héllo', `title ${title.text}`);
    assert(part.filename === 'upload.bin' && part.size === 2 * 1024 * 1024 + 7 && part.pattern, JSON.stringify(part));
    assert(body.contentLength !== null, 'Content-Length missing');
  }],
  ['Raw file upload body', async () => {
    const file = writeTempFile('raw.bin', 1_000_003);
    const body = await (await fetch(`${HOST}/verify`, { method: 'PUT', body: { uri: file.uri, type: 'application/octet-stream' } })).json<any>();
    assert(body.ok && body.bodyLength === 1_000_003, JSON.stringify(body));
    assert(body.contentLength === '1000003', `content-length ${body.contentLength}`);
  }],
  ['Missing upload file fails with ERR_FILE', () =>
    expectCode(fetch(`${HOST}/verify`, { method: 'PUT', body: { uri: 'file:///does/not/exist.bin' } }), 'ERR_FILE').then(() => {})],
  ['Upload progress', async () => {
    const events: number[] = [];
    let total: number | null = null;
    await (await fetch(`${HOST}/verify`, {
      method: 'POST',
      body: pattern(4 * 1024 * 1024),
      onUploadProgress: (e) => { events.push(e.loaded); total = e.total; },
    })).json();
    assert(events.length > 0 && events[events.length - 1] === 4 * 1024 * 1024, `events ${events.slice(-3)}`);
    assert(events.every((v, i) => i === 0 || v >= events[i - 1]), 'not monotonic');
    return `${events.length} events, total ${total}`;
  }],
  ['Download progress', async () => {
    const events: number[] = [];
    let total: number | null = null;
    await (await fetch(`${HOST}/bytes?n=${8 * 1024 * 1024}`, {
      onDownloadProgress: (e) => { events.push(e.loaded); total = e.total; },
    })).arrayBuffer();
    assert(events[events.length - 1] === 8 * 1024 * 1024 && total === 8 * 1024 * 1024, `last ${events[events.length - 1]} total ${total}`);
    assert(events.every((v, i) => i === 0 || v >= events[i - 1]), 'not monotonic');
    return `${events.length} events`;
  }],
  ['SSL pinning: wrong pin', async () => {
    const api = createClient({ pinning: { 'example.com': ['sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='] }, retry: 0 });
    await expectCode(api.get('https://example.com/'), 'ERR_PINNING');
  }],
  ['SSL pinning: matching pin', async () => {
    const { pins } = await (await fetch(`${HOST}/pins?host=example.com`)).json<{ pins: string[] }>();
    const api = createClient({ pinning: { 'example.com': [pins[pins.length - 1]] }, retry: 0 });
    const res = await api.get('https://example.com/');
    await res.text();
    assert(res.status === 200, `status ${res.status}`);
  }],
  ['Client retry on 503', async () => {
    const api = createClient({ baseURL: HOST, retry: { limit: 3, delay: () => 50 } });
    const res = await api.get('/flaky', { searchParams: { key: String(Math.random()), fail: 2 } });
    assert(res.status === 200, `status ${res.status}`);
    await res.text();
  }],
  ['Client json helper and ERR_HTTP', async () => {
    const api = createClient({ baseURL: HOST, retry: 0 });
    const echo = await api.json<any>('/echo', { method: 'POST', json: { a: 1 } });
    assert(echo.text === '{"a":1}' && echo.headers['content-type'] === 'application/json', echo.text);
    const error: any = await api.json("/status", { searchParams: { code: 422 } }).catch((e) => e);
    assert(error.code === 'ERR_HTTP' && error.status === 422, `${error.code} ${error.status}`);
    assert((await error.response.json()).code === 422, 'error body not readable');
  }],
  ['204, HEAD and clone', async () => {
    const empty = await fetch(`${HOST}/status?code=204`);
    assert(empty.status === 204 && empty.body === null, `status ${empty.status}`);
    const head = await fetch(`${HOST}/bytes?n=10`, { method: 'HEAD' });
    assert(head.headers.get('content-length') === '10' && (await head.text()) === '', 'HEAD');
    const res = await fetch(`${HOST}/echo`);
    const copy = res.clone();
    assert((await copy.json<any>()).method === (await res.json<any>()).method, 'clone');
  }],
  ['100 parallel requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => fetch(`${HOST}/echo?i=${i}`).then((r) => r.json<any>()))
    );
    assert(results.length === 100 && results.every((r) => r.method === 'GET'), 'parallel');
  }],
  ['Unreachable host fails with ERR_NETWORK', () =>
    expectCode(fetch('http://127.0.0.1:1/', { timeout: 5000 }), 'ERR_NETWORK').then(() => {})],
];

export async function runSelfTest(onResult: (result: CaseResult) => void): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const [name, run] of cases) {
    const start = performance.now();
    let result: CaseResult;
    try {
      const detail = await run();
      result = { name, ok: true, ms: Math.round(performance.now() - start), detail: detail ?? '' };
    } catch (error) {
      result = { name, ok: false, ms: Math.round(performance.now() - start), detail: String((error as Error)?.message ?? error) };
    }
    results.push(result);
    onResult(result);
  }
  await report(`selftest-${Platform.OS}`, { platform: Platform.OS, version: Platform.Version, results });
  return results;
}

export type BenchRow = { name: string; expoFetcher: number; globalFetch: number; expoFetch: number };

async function median(runs: number, task: () => Promise<unknown>): Promise<number> {
  await task();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await task();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]);
}

type AnyFetch = (url: string, init?: any) => Promise<{ arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<any> }>;

const clients: [keyof Omit<BenchRow, 'name'>, AnyFetch][] = [
  ['expoFetcher', fetch as AnyFetch],
  ['globalFetch', globalThis.fetch as AnyFetch],
  ['expoFetch', expoFetch as AnyFetch],
];

const benchmarks: [string, (f: AnyFetch) => Promise<unknown>][] = [
  ['Download 1 MB (arrayBuffer)', (f) => f(`${HOST}/bytes?n=${1024 * 1024}`).then((r) => r.arrayBuffer())],
  ['Download 20 MB (arrayBuffer)', (f) => f(`${HOST}/bytes?n=${20 * 1024 * 1024}`).then((r) => r.arrayBuffer())],
  ['100 parallel small JSON GETs', (f) => Promise.all(Array.from({ length: 100 }, (_, i) => f(`${HOST}/echo?i=${i}`).then((r) => r.json())))],
  ['Upload 5 MB (Uint8Array)', (f) => f(`${HOST}/verify`, { method: 'POST', body: pattern(5 * 1024 * 1024) }).then((r) => r.json())],
];

export async function runBenchmark(onRow: (row: BenchRow) => void, runs = 5): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  for (const [name, task] of benchmarks) {
    const row: BenchRow = { name, expoFetcher: -1, globalFetch: -1, expoFetch: -1 };
    for (const [key, f] of clients) {
      try {
        row[key] = await median(runs, () => task(f));
      } catch {
        row[key] = -1;
      }
    }
    rows.push(row);
    onRow(row);
  }
  await report(`bench-${Platform.OS}`, { platform: Platform.OS, version: Platform.Version, runs, rows });
  return rows;
}

async function report(name: string, value: unknown) {
  try {
    await fetch(`${HOST}/report?name=${name}`, { method: 'POST', body: JSON.stringify(value) });
  } catch {
  }
}
