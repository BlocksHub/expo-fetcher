import type { NativeBodyPart } from './native';

export interface FileReference {
  uri: string;
  name?: string;
  type?: string;
}

export type BodyInit =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | URLSearchParams
  | FormData
  | ReadableStream<Uint8Array>
  | FileReference;

export interface EncodedBody {
  bytes: Uint8Array | null;
  parts: NativeBodyPart[] | null;
}

let encoder: TextEncoder | null = null;

export function encodeUtf8(text: string): Uint8Array {
  if (!encoder) {
    if (typeof TextEncoder !== 'function') {
      throw new TypeError('TextEncoder is not available in this JavaScript runtime.');
    }
    encoder = new TextEncoder();
  }
  return encoder.encode(text);
}

let decoder: TextDecoder | null = null;

export function decodeUtf8(bytes: Uint8Array): string {
  if (!decoder) {
    if (typeof TextDecoder !== 'function') {
      throw new TypeError('TextDecoder is not available in this JavaScript runtime.');
    }
    decoder = new TextDecoder();
  }
  return decoder.decode(bytes);
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (!ArrayBuffer.isView(data)) {
    return data;
  }
  const { buffer, byteOffset, byteLength } = data;
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer as ArrayBuffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

export function concatBytes(chunks: Uint8Array[], totalLength?: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0];
  }
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).size === 'number' &&
    typeof (value as Blob).type === 'string' &&
    (typeof (value as Blob).arrayBuffer === 'function' ||
      typeof (value as Blob).slice === 'function')
  );
}

export function isFileReference(value: unknown): value is FileReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileReference).uri === 'string' &&
    !isBlobLike(value)
  );
}

export function isFormData(value: unknown): value is FormData {
  if (typeof FormData === 'function' && value instanceof FormData) {
    return true;
  }
  return (
    typeof value === 'object' &&
    value !== null &&
    (Array.isArray((value as { _parts?: unknown })._parts) ||
      (typeof (value as FormData).append === 'function' &&
        typeof (value as FormData).entries === 'function'))
  );
}

export function isURLSearchParams(value: unknown): value is URLSearchParams {
  if (typeof URLSearchParams === 'function' && value instanceof URLSearchParams) {
    return true;
  }
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.toString.call(value) === '[object URLSearchParams]'
  );
}

export function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ReadableStream).getReader === 'function'
  );
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new TypeError('Could not read Blob'));
    reader.readAsArrayBuffer(blob);
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = toUint8Array(value);
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  return chunks.length === 0 ? new Uint8Array(0) : concatBytes(chunks, length);
}

export function createBoundary(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let boundary = '----ExpoFetcherBoundary';
  for (let i = 0; i < 24; i++) {
    boundary += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return boundary;
}

export function impliedContentType(body: unknown, boundary: string): string | null {
  if (body == null) {
    return null;
  }
  if (typeof body === 'string') {
    return 'text/plain;charset=UTF-8';
  }
  if (isURLSearchParams(body)) {
    return 'application/x-www-form-urlencoded;charset=UTF-8';
  }
  if (isFormData(body)) {
    return `multipart/form-data; boundary=${boundary}`;
  }
  if (isBlobLike(body) || isFileReference(body)) {
    return body.type || null;
  }
  return null;
}

type FormEntry = [name: string, value: string | Blob | FileReference];

function formDataEntries(form: FormData): FormEntry[] {
  const rnParts = (form as unknown as { _parts?: [string, unknown][] })._parts;
  const source: Iterable<[string, unknown]> = Array.isArray(rnParts)
    ? rnParts
    : (form.entries() as Iterable<[string, unknown]>);

  const entries: FormEntry[] = [];
  for (const [name, value] of source) {
    if (typeof value === 'string' || isBlobLike(value) || isFileReference(value)) {
      entries.push([name, value]);
    } else {
      entries.push([name, String(value)]);
    }
  }
  return entries;
}

function escapeHeaderParam(value: string): string {
  return value.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
}

function fileNameFromUri(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  const last = path.substring(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last) || 'file';
  } catch {
    return last || 'file';
  }
}

async function encodeFormData(form: FormData, boundary: string): Promise<EncodedBody> {
  const parts: NativeBodyPart[] = [];
  let pending: Uint8Array[] = [];
  let hasFile = false;

  const flush = () => {
    if (pending.length > 0) {
      parts.push({ data: concatBytes(pending) });
      pending = [];
    }
  };

  for (const [name, value] of formDataEntries(form)) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeHeaderParam(name)}"`;
    if (typeof value === 'string') {
      pending.push(encodeUtf8(`${head}\r\n\r\n`), encodeUtf8(value), encodeUtf8('\r\n'));
      continue;
    }
    if (isFileReference(value)) {
      const filename = value.name ?? fileNameFromUri(value.uri);
      const type = value.type || 'application/octet-stream';
      head += `; filename="${escapeHeaderParam(filename)}"\r\nContent-Type: ${type}\r\n\r\n`;
      pending.push(encodeUtf8(head));
      flush();
      parts.push({ uri: value.uri });
      pending.push(encodeUtf8('\r\n'));
      hasFile = true;
      continue;
    }
    const filename = (value as Blob & { name?: string }).name || 'blob';
    const type = value.type || 'application/octet-stream';
    head += `; filename="${escapeHeaderParam(filename)}"\r\nContent-Type: ${type}\r\n\r\n`;
    pending.push(encodeUtf8(head), await blobToBytes(value), encodeUtf8('\r\n'));
  }
  pending.push(encodeUtf8(`--${boundary}--\r\n`));
  flush();

  if (!hasFile) {
    return { bytes: parts[0].data!, parts: null };
  }
  return { bytes: null, parts };
}

export async function encodeBody(body: unknown, boundary: string): Promise<EncodedBody> {
  if (body == null) {
    return { bytes: null, parts: null };
  }
  if (typeof body === 'string') {
    return { bytes: encodeUtf8(body), parts: null };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return { bytes: toUint8Array(body as ArrayBuffer | ArrayBufferView), parts: null };
  }
  if (isURLSearchParams(body)) {
    return { bytes: encodeUtf8(body.toString()), parts: null };
  }
  if (isFormData(body)) {
    return encodeFormData(body, boundary);
  }
  if (isBlobLike(body)) {
    return { bytes: await blobToBytes(body), parts: null };
  }
  if (isReadableStream(body)) {
    return { bytes: await readStream(body), parts: null };
  }
  if (isFileReference(body)) {
    return { bytes: null, parts: [{ uri: body.uri }] };
  }
  throw new TypeError(`Unsupported body type: ${Object.prototype.toString.call(body)}`);
}
