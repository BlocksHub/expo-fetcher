import type { RequestInit } from '../types';
import { Request } from '../classes/Request';
import { Response } from '../classes/Response';
import ExpoFetcherModule from '../modules/ExpoFetcherModule';
import { formatFetchError } from '../utils/errorHandling';

export async function fetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  let request: Request;

  try {
    if (input instanceof Request) {
      request = input;
    } else {
      request = new Request(input, init);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }
    throw new TypeError(
      'Failed to execute fetch: Invalid request.\n' +
      `Input: ${JSON.stringify(input)}\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const headersObj: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  let bodyToSend: string | ArrayBuffer | undefined = request.body;
  if (bodyToSend instanceof ArrayBuffer) {
    const decoder = new TextDecoder();
    bodyToSend = decoder.decode(bodyToSend);
  }

  try {
    const nativeResponse = await ExpoFetcherModule.fetch(request.url, {
      body: bodyToSend,
      headers: headersObj,
      method: request.method,
      redirect: request.redirect,
    });

    return new Response(
      nativeResponse.status,
      nativeResponse.statusText,
      nativeResponse.headers,
      nativeResponse.bodyBase64,
      nativeResponse.url,
      nativeResponse.ok,
      nativeResponse.redirected,
      nativeResponse.type
    );
  } catch (error) {
    const errorDetails = formatFetchError(error, {
      url: request.url,
      method: request.method,
      headers: headersObj
    });
    
    const enhancedError = new Error(errorDetails);
    if (error instanceof Error && error.stack) {
      enhancedError.stack = error.stack;
    }
    throw enhancedError;
  }
}

export async function clearCookies(): Promise<void> {
  await ExpoFetcherModule.clearCookies();
}
