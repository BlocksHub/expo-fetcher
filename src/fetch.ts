import { NativeSource } from './BodyMixin';
import {
  FetchError,
  createAbortError,
  createTimeoutError,
  fromNativeError,
  type FetchErrorRequestInfo,
} from './errors';
import { Headers } from './Headers';
import { getNativeModule, toNativeParts, type NativeRequestInit, type NativeSession } from './native';
import { Request, type RequestInit } from './Request';
import { Response } from './Response';
import { getSession, toNativeConfig } from './session';
import { statusText } from './statusText';
import { redactUrl } from './url';

let defaultSession: NativeSession | null = null;

function getDefaultSession(): NativeSession {
  if (!defaultSession) {
    defaultSession = getSession(toNativeConfig());
  }
  return defaultSession;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : createAbortError();
}

export function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let request: Request;
  try {
    request = input instanceof Request && init === undefined ? input : new Request(input, init);
  } catch (error) {
    return Promise.reject(error);
  }
  return send(getDefaultSession(), request);
}

export async function send(session: NativeSession, request: Request): Promise<Response> {
  const info: FetchErrorRequestInfo = { method: request.method, url: redactUrl(request.url) };
  const { signal } = request;
  if (signal?.aborted) {
    throw abortReason(signal);
  }

  const encoded = await request._encode();
  if (signal?.aborted) {
    throw abortReason(signal);
  }

  const { NativeRequest, NativeResponse } = getNativeModule();
  const nativeResponse = new NativeResponse();
  const nativeRequest = new NativeRequest(nativeResponse);

  const nativeInit: NativeRequestInit = {
    method: request.method,
    headers: request.headers.toPairs(),
    redirect: request.redirect,
    credentials: request.credentials === 'omit' ? 'omit' : 'include',
    cache: request.cache,
    reportUploadProgress: typeof request.onUploadProgress === 'function',
    reportDownloadProgress: typeof request.onDownloadProgress === 'function',
  };

  const subscriptions: { remove(): void }[] = [];
  let source: NativeSource | null = null;
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    signal?.removeEventListener('abort', onAbort);
    for (const subscription of subscriptions) {
      subscription.remove();
    }
  };

  let rejectHead: ((reason: unknown) => void) | null = null;
  const onAbort = () => {
    const reason = abortReason(signal!);
    source?.abort(reason);
    rejectHead?.(reason);
    void nativeRequest.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);

  if (request.onUploadProgress) {
    const callback = request.onUploadProgress;
    subscriptions.push(
      nativeResponse.addListener('uploadProgress', (sent, total) => {
        callback({ loaded: sent, total: total >= 0 ? total : null });
      })
    );
  }
  if (request.onDownloadProgress) {
    const callback = request.onDownloadProgress;
    subscriptions.push(
      nativeResponse.addListener('downloadProgress', (received, total) => {
        callback({ loaded: received, total: total >= 0 ? total : null });
      })
    );
  }
  subscriptions.push(nativeResponse.addListener('readyForJSFinalization', release));

  let timer: ReturnType<typeof setTimeout> | null = null;
  const head = new Promise<void>((resolve, reject) => {
    rejectHead = reject;
    if (request.timeout !== undefined && request.timeout > 0) {
      const ms = request.timeout;
      timer = setTimeout(() => {
        void nativeRequest.cancel().catch(() => {});
        reject(
          new FetchError('ERR_TIMEOUT', `${info.method} ${info.url} timed out after ${ms} ms.`, {
            request: info,
            cause: createTimeoutError(ms),
          })
        );
      }, ms);
    }
    const parts = toNativeParts(encoded.parts);
    nativeRequest
      .start(session, request.url, nativeInit, encoded.bytes, parts?.layout ?? null, parts?.chunks ?? null)
      .then(resolve, (error) => {
        reject(signal?.aborted ? abortReason(signal) : fromNativeError(error, info));
      });
  });

  try {
    await head;
  } catch (error) {
    release();
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    rejectHead = null;
  }

  const status = nativeResponse.status;
  const hasBody = request.method !== 'HEAD' && status !== 204 && status !== 304;
  source = new NativeSource(nativeResponse, release);
  if (!hasBody) {
    source.cancel();
  }

  return Response._fromNetwork({
    status,
    statusText: statusText(status, nativeResponse.statusText),
    headers: Headers.fromPairs(nativeResponse._rawHeaders),
    url: nativeResponse.url || request.url,
    redirected: nativeResponse.redirected,
    type: 'basic',
    source: hasBody ? source : null,
  });
}
