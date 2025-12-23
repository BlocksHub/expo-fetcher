
# Expo Fetcher

Expo Fetcher simplifies and unifies HTTP requests in Expo, React Native, and native (iOS/Android) projects. It provides a `fetch` inspired API with advanced handling for headers, cookies, redirects, and errors.

## Main Features

- Flexible header and cookie management
- Redirect control and error handling
- Full support for HTTP methods and body types
- Seamless integration with Expo and React Native
- Native implementation for iOS and Android

---

## Installation

```bash
npm install expo-fetcher
```

## Basic Usage

```typescript
import { fetch } from 'expo-fetcher';

const response = await fetch('https://api.example.com/data', {
  method: 'GET',
  headers: { 'Authorization': 'Bearer TOKEN' }
});
const data = await response.json();
```

---

## Contributing

Contributions are welcome!

1. Fork the project
2. Create a branch
3. Add your changes
4. Open a Pull Request

---

## License

MIT
