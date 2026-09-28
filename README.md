<div align="center">
  <br />
  <img width="100%" alt="expo-fetcher" src="https://github.com/user-attachments/assets/5cb13bd8-119f-45e4-9762-aa3e9a3ac184" />
  <br />
  <br />

  [![npm version](https://img.shields.io/npm/v/expo-fetcher?style=flat-square&color=3366FF)](https://www.npmjs.com/package/expo-fetcher)
  [![License](https://img.shields.io/npm/l/expo-fetcher?style=flat-square&color=gray)](LICENSE)
  [![Platform - Android](https://img.shields.io/badge/platform-Android-3ddc84.svg?style=flat-square&logo=android)](https://www.android.com)
  [![Platform - iOS](https://img.shields.io/badge/platform-iOS-000000.svg?style=flat-square&logo=apple)](https://developer.apple.com/ios)
</div>

A standard `fetch` for Expo, running on URLSession (iOS) and OkHttp (Android). It adds streaming, progress, file uploads from disk, retries and SSL pinning.

## Install

```bash
npx expo install expo-fetcher
```

Needs a development build (not Expo Go), Expo SDK 54+, iOS 15.1+, Android API 24+.

## Usage

```ts
import { fetch } from 'expo-fetcher';

const response = await fetch('https://api.example.com/users/42', {
  headers: { Authorization: `Bearer ${token}` },
  timeout: 10_000,
});
const user = await response.json();
```

`Headers`, `Request`, `Response`, `AbortSignal`, `redirect`, `credentials` and `cache` work as in a browser.

### Stream, progress, files

```ts
// Read the body as it arrives
for await (const chunk of response.stream()) {
  // chunk is a Uint8Array
}

// Progress callbacks, throttled to one every 50 ms
await fetch(url, { method: 'PUT', body: bytes, onUploadProgress: ({ loaded, total }) => {} });

// Upload a file from disk, without loading it in JS
const form = new FormData();
form.append('photo', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' });
await fetch(url, { method: 'POST', body: form });
await fetch(presignedUrl, { method: 'PUT', body: { uri: video.uri, type: 'video/mp4' } });
```

### Client

```ts
import { createClient } from 'expo-fetcher';

const api = createClient({
  baseURL: 'https://api.example.com/v2',
  timeout: 15_000,
  retry: { limit: 3 },
  hooks: {
    beforeRequest: [(request) => request.headers.set('authorization', `Bearer ${getToken()}`)],
  },
});

const orders = await api.json<Order[]>('/orders', { searchParams: { status: 'open' } });
await api.post('/orders', { json: { sku: 'A-100', quantity: 2 } });
```

Other options: `headers`, `throwHttpErrors`, `dedupe`, `cookies`, `idleTimeout`, `maxConnectionsPerHost`. Retries only apply to idempotent methods, on network errors and 408, 413, 429, 5xx, and honour `Retry-After`.

### SSL pinning

```ts
const bank = createClient({
  pinning: {
    'api.bank.example': ['sha256/<current key hash>', 'sha256/<backup key hash>'],
  },
});
```

Get a host's pin with:

```bash
openssl s_client -connect api.bank.example:443 -servername api.bank.example </dev/null 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
```

Always ship a backup pin. On iOS, send all traffic for a pinned host through the pinned client: iOS can resume a TLS session opened earlier without pins, and a resumed session carries no certificate to check.

### Cookies

Cookies are shared with React Native's fetch and WebViews, and persist across launches.

```ts
import { cookies } from 'expo-fetcher';

await cookies.set('https://example.com', { name: 'consent', value: 'yes' });
await cookies.get('https://example.com');
await cookies.clear();
```

### Errors

Failures throw a `FetchError` (a `TypeError`) with a `code`: `ERR_NETWORK`, `ERR_TIMEOUT`, `ERR_PINNING`, `ERR_TLS`, `ERR_REDIRECT`, `ERR_INVALID_URL`, `ERR_FILE`, `ERR_BODY_USED`, `ERR_BODY_READ` or `ERR_HTTP`. Messages never include request headers or query strings.

## Performance

Compared with React Native's built-in `fetch`, Release build, iPhone 17 Pro simulator, local server, median of 10 to 30 runs:

| Task | expo-fetcher | RN fetch |
| :-- | --: | --: |
| One GET, POST, PUT or DELETE with small JSON | ~1 ms | 16.7 ms |
| 50 GETs one after another | 31.5 ms | 833 ms |
| 100 GETs in parallel | 41.7 ms | 50.2 ms |
| Download 20 MB | 21.7 ms | 981 ms |
| Upload 5 MB | 75.4 ms | 400 ms |

A local server hides network latency, so these numbers show the client's own overhead. Run the benchmark in [`example/`](example) on your devices. Android numbers are not measured yet.

## Upgrading from 0.9

- Errors are now `FetchError` with a `code`.
- iOS now stores and sends cookies, like Android. Use `credentials: 'omit'` to opt out.
- `formatFetchError` and `validateUrl` were removed.

## Development

```bash
npm test                                     # unit tests
cd example && npm install && npm run server  # test server
npx expo run:ios                             # in a second terminal
```

## License

MIT
