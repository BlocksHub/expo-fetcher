import { createHash, X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:tls';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const PORT = Number(process.env.PORT ?? 8787);
const failures = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length, ...headers });
  res.end(body);
}

function patternBytes(n) {
  const buf = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) buf[i] = i % 256;
  return buf;
}

function pinsFor(host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host }, () => {
      const pins = [];
      let cert = socket.getPeerCertificate(true);
      const seen = new Set();
      while (cert && cert.raw && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        const spki = new X509Certificate(cert.raw).publicKey.export({ type: 'spki', format: 'der' });
        pins.push('sha256/' + createHash('sha256').update(spki).digest('base64'));
        cert = cert.issuerCertificate;
      }
      socket.end();
      resolve(pins);
    });
    socket.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams;
  try {
    switch (url.pathname) {
      case '/echo': {
        const body = await readBody(req);
        return json(res, 200, {
          method: req.method,
          headers: req.headers,
          bodyLength: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
          text: body.length < 4096 ? body.toString('utf8') : null,
        });
      }
      case '/verify': {
        const body = await readBody(req);
        return json(res, 200, {
          ok: body.equals(patternBytes(body.length)),
          bodyLength: body.length,
          contentLength: req.headers['content-length'] ?? null,
          transferEncoding: req.headers['transfer-encoding'] ?? null,
        });
      }
      case '/verify-multipart': {
        const body = await readBody(req);
        const type = req.headers['content-type'] ?? '';
        const boundary = /boundary=(.+)$/.exec(type)?.[1];
        if (!boundary) return json(res, 400, { error: 'no boundary' });
        const parts = [];
        const delimiter = Buffer.from(`--${boundary}`);
        let index = body.indexOf(delimiter);
        while (index !== -1) {
          const start = index + delimiter.length;
          if (body.subarray(start, start + 2).toString() === '--') break;
          const headEnd = body.indexOf('\r\n\r\n', start);
          const next = body.indexOf(delimiter, headEnd);
          const head = body.subarray(start + 2, headEnd).toString();
          const content = body.subarray(headEnd + 4, next - 2);
          const name = /name="([^"]*)"/.exec(head)?.[1];
          const filename = /filename="([^"]*)"/.exec(head)?.[1] ?? null;
          parts.push({
            name,
            filename,
            size: content.length,
            pattern: filename ? content.equals(patternBytes(content.length)) : null,
            text: filename ? null : content.toString('utf8'),
          });
          index = next;
        }
        return json(res, 200, { parts, contentLength: req.headers['content-length'] ?? null });
      }
      case '/json': {
        const kb = Number(q.get('kb') ?? 1024);
        const items = [];
        let size = 2;
        for (let i = 0; size < kb * 1024; i++) {
          const item = { id: i, name: `item ${i}`, tags: ['a', 'b', 'c'], price: i * 1.5, active: i % 2 === 0 };
          size += JSON.stringify(item).length + 1;
          items.push(item);
        }
        const body = Buffer.from(JSON.stringify(items));
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
        return res.end(body);
      }
      case '/bytes': {
        const body = patternBytes(Number(q.get('n') ?? 256));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
        return res.end(body);
      }
      case '/stream': {
        const chunks = Number(q.get('chunks') ?? 5);
        const size = Number(q.get('size') ?? 1024);
        const delay = Number(q.get('delay') ?? 50);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        for (let i = 0; i < chunks; i++) {
          res.write(patternBytes(size));
          await sleep(delay);
        }
        return res.end();
      }
      case '/redirect': {
        const n = Number(q.get('n') ?? 1);
        const location = n > 1 ? `/redirect?n=${n - 1}` : '/echo';
        res.writeHead(302, { location });
        return res.end();
      }
      case '/slow':
        await sleep(Number(q.get('ms') ?? 2000));
        return json(res, 200, { slow: true });
      case '/cookies/set':
        res.writeHead(200, {
          'set-cookie': [
            'first=1; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
            'second=2; Path=/; HttpOnly',
          ],
          'content-type': 'text/plain',
        });
        return res.end('ok');
      case '/cookies/echo':
        return json(res, 200, { cookie: req.headers.cookie ?? null });
      case '/gzip': {
        const body = gzipSync(JSON.stringify({ encoding: 'gzip', filler: 'x'.repeat(5000) }));
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(body);
      }
      case '/br': {
        const body = brotliCompressSync(JSON.stringify({ encoding: 'br', filler: 'y'.repeat(5000) }));
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
        return res.end(body);
      }
      case '/status':
        return json(res, Number(q.get('code') ?? 200), { code: Number(q.get('code')) });
      case '/flaky': {
        const key = q.get('key') ?? 'default';
        const left = failures.has(key) ? failures.get(key) : Number(q.get('fail') ?? 2);
        if (left > 0) {
          failures.set(key, left - 1);
          return json(res, 503, { left: left - 1 });
        }
        failures.delete(key);
        return json(res, 200, { ok: true });
      }
      case '/pins':
        return json(res, 200, { pins: await pinsFor(q.get('host') ?? 'example.com') });
      case '/report': {
        const body = await readBody(req);
        const name = q.get('name') ?? 'report';
        writeFileSync(new URL(`./${name}.json`, import.meta.url), body);
        console.log(`[report] ${name}:`, body.toString('utf8'));
        return json(res, 200, { saved: true });
      }
      default:
        return json(res, 404, { error: 'not found' });
    }
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: String(error) });
    else res.destroy();
  }
});

server.listen(PORT, () => console.log(`test server on http://localhost:${PORT}`));
