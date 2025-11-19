import type { RequestMethod, RequestRedirection, RequestInit } from '../types';
import { Headers } from './Headers';
import parse from 'url-parse';

type HeadersInit = Headers | Record<string, string> | [string, string][];

export class Request {
  readonly url: string;
  readonly body: string | ArrayBuffer | undefined;
  readonly method: RequestMethod;
  readonly redirect: RequestRedirection;
  readonly headers: Headers;

  constructor(input: string | URL, init?: RequestInit) {
    let urlString: string;
    
    if (typeof input !== 'string') {
      urlString = input.href;
    } else {
      urlString = input;
    }

    if (!urlString || urlString.trim() === '') {
      throw new TypeError(
        'Failed to construct Request: URL is empty or contains only whitespace.\n' +
        'Received: ' + JSON.stringify(input) + '\n' +
        'Make sure you provide a valid URL string.'
      );
    }

    try {
      const parsedUrl = parse(urlString, true);
      
      if (!parsedUrl.protocol || parsedUrl.protocol === '') {
        throw new TypeError(
          'Failed to construct Request: URL protocol is missing.\n' +
          `Received URL: "${urlString}"\n` +
          'Valid URL must start with http:// or https://\n' +
          `Example: "https://example.com${urlString.startsWith('/') ? urlString : '/' + urlString}"`
        );
      }

      if (!parsedUrl.hostname || parsedUrl.hostname === '') {
        throw new TypeError(
          'Failed to construct Request: URL hostname is missing.\n' +
          `Received URL: "${urlString}"\n` +
          'Valid URL must include a hostname.\n' +
          `Example: "https://example.com${urlString}"`
        );
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new TypeError(
          'Failed to construct Request: Unsupported URL protocol.\n' +
          `Received URL: "${urlString}"\n` +
          `Protocol: "${parsedUrl.protocol}"\n` +
          'Only http:// and https:// protocols are supported.'
        );
      }

    } catch (e) {
      if (e instanceof TypeError) {
        throw e;
      }
      throw new TypeError(
        'Failed to construct Request: Invalid URL format.\n' +
        `Received URL: "${urlString}"\n` +
        `Error: ${e instanceof Error ? e.message : String(e)}\n` +
        'Make sure the URL is properly formatted: https://example.com/path'
      );
    }

    this.method = init?.method ?? 'GET';
    this.url = urlString;
    this.redirect = init?.redirect ?? 'follow';

    if (init?.headers) {
      this.headers = new Headers(init.headers as HeadersInit);
    } else {
      this.headers = new Headers();
    }

    if (typeof init?.body === 'string') {
      this.body = init.body;
      if (!this.headers.has('Content-Length')) {
        this.headers.set('Content-Length', init.body.length.toString());
      }
    } else if (init?.body instanceof ArrayBuffer) {
      this.body = init.body;
      if (!this.headers.has('Content-Length')) {
        this.headers.set('Content-Length', init.body.byteLength.toString());
      }
    } else if (init?.body instanceof Uint8Array) {
      this.body = init.body.buffer as ArrayBuffer;
      if (!this.headers.has('Content-Length')) {
        this.headers.set('Content-Length', init.body.byteLength.toString());
      }
    }
  }
}
