<div align="center">
  <br />
  <img src=".github/assets/banner.png" alt="Expo Fetcher Banner" width="100%" />
  <br />
  <br />

  [![npm version](https://img.shields.io/npm/v/expo-fetcher?style=flat-square&color=3366FF)](https://www.npmjs.com/package/expo-fetcher)
  [![License](https://img.shields.io/npm/l/expo-fetcher?style=flat-square&color=gray)](LICENSE)
  [![Platform - Android](https://img.shields.io/badge/platform-Android-3ddc84.svg?style=flat-square&logo=android)](https://www.android.com)
  [![Platform - iOS](https://img.shields.io/badge/platform-iOS-000000.svg?style=flat-square&logo=apple)](https://developer.apple.com/ios)
  [![TypeScript](https://img.shields.io/badge/types-TypeScript-3178C6.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

  <h3 align="center">The Missing Native Fetch for Expo</h3>

  <p align="center">
    Use the power of native networking libraries with a standard <code>fetch</code> API.
    <br />
    Handle cookies and redirects with ease.
    <br />
    <br />
    <a href="#-installation"><strong>Installation</strong></a> ·
    <a href="#-usage"><strong>Usage</strong></a> ·
    <a href="#-api-reference"><strong>API Reference</strong></a> ·
    <a href="#-contributing"><strong>Contributing</strong></a>
  </p>
</div>

---

<br />

## 🌟 Why Expo Fetcher?

`expo-fetcher` bridges the gap between the JavaScript `fetch` API and native networking capabilities ensuring your apps are robust, secure, and performant.

| Feature | Description |
| :--- | :--- |
| **🍪 Advanced Cookie Support** | Persistent cookie jar on Android. Full visibility of `Set-Cookie` headers on iOS. |
| **⚡ Native Networking** | Uses platform-native networking stacks (NSURLSession/OkHttp) for maximum reliability. |
| **⤵️ Smart Redirects** | Fine-grained control over redirect policies: `follow`, `error`, or `manual`. |
| **✨ Standard API** | Drop-in replacement for `fetch`. No new concepts to learn. |
| **🔒 Type Safe** | Written in TypeScript with complete definitions included. |

<br />

## 📦 Installation

Add the package to your Expo or React Native project.

```bash
# Using npm
npm install expo-fetcher

# Using yarn
yarn add expo-fetcher

# Using expo
npx expo install expo-fetcher
```

<br />

## 🛠 Usage

### Basic Fetch

It works just like the standard `fetch` you know and love.

```typescript
import { fetch } from 'expo-fetcher';

// Simple GET request
const response = await fetch('https://api.example.com/data');
const json = await response.json();
```

### Advanced POST with Headers

```typescript
import { fetch } from 'expo-fetcher';

const uploadData = async () => {
  try {
    const response = await fetch('https://api.example.com/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <YOUR_TOKEN>',
      },
      body: JSON.stringify({ name: 'John Doe', role: 'Developer' }),
    });

    if (response.ok) {
      console.log('Success:', await response.json());
    }
  } catch (error) {
    console.error('Request failed:', error);
  }
};
```

### Cookie Management

Authentication cookies set by the server are automatically stored and managed on Android. On iOS, you have full access to `Set-Cookie` headers to manage sessions manually if needed.

> **Note**: Android maintains a persistent cookie jar between requests. iOS requests use isolated sessions, so cookies are not automatically carried over to subsequent requests.

```typescript
import { clearCookies } from 'expo-fetcher';

const handleLogout = async () => {
  // Clears the native cookie storage (Android only)
  await clearCookies();
  console.log('Session cleared');
};
```

<br />

## 📚 API Reference

### `fetch(input, init)`

Performs a network request.

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `input` | `string` \| `URL` \| `Request` | ✅ | The URL or Request object. |
| `init` | `RequestInit` | ❌ | Optional configuration object. |

#### `RequestInit` Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `method` | `'GET'` \| `'POST'` \| `'PUT'` \| `'DELETE'` \| `'PATCH'` \| `'HEAD'` \| `'OPTIONS'` | `'GET'` | The HTTP method to use. |
| `headers` | `Headers` \| `Record<string, string>` | `{}` | Request headers. |
| `body` | `string` \| `ArrayBuffer` \| `Uint8Array` | `undefined` | The body content. |
| `redirect` | `'follow'` \| `'error'` \| `'manual'` | `'follow'` | Redirect handling policy. |

<br />

### `clearCookies()`

Clears all cookies stored in the native container.

| Return Type | Description |
| :--- | :--- |
| `Promise<void>` | Resolves when the Android cookie jar has been emptied. |

<br />

## 🤝 Contributing

We welcome contributions! Please see the guidelines below.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

<br />

## 📄 License

This project is licensed under the **MIT License**.
