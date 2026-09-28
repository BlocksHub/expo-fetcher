import { encodeBody, impliedContentType } from '../encoding';

const text = (bytes: Uint8Array | null) => new TextDecoder().decode(bytes!);

describe('encodeBody', () => {
  it('encodes strings as UTF-8, so length counts bytes', async () => {
    const { bytes } = await encodeBody('héllo €', 'b');
    expect(bytes!.byteLength).toBe(10);
  });

  it('passes binary through byte for byte', async () => {
    const data = new Uint8Array([0, 255, 128, 10, 13]);
    const { bytes } = await encodeBody(data.buffer, 'b');
    expect(Array.from(bytes!)).toEqual([0, 255, 128, 10, 13]);
  });

  it('respects typed array views', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    const { bytes } = await encodeBody(buffer.subarray(1, 3), 'b');
    expect(Array.from(bytes!)).toEqual([2, 3]);
  });

  it('encodes URLSearchParams', async () => {
    const { bytes } = await encodeBody(new URLSearchParams({ a: '1 2', b: 'é' }), 'b');
    expect(text(bytes)).toBe('a=1+2&b=%C3%A9');
  });

  it('builds multipart bodies in memory without files', async () => {
    const form = new FormData();
    form.append('field', 'value');
    form.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
    const { bytes, parts } = await encodeBody(form, 'XYZ');
    expect(parts).toBeNull();
    expect(text(bytes)).toBe(
      '--XYZ\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n' +
        '--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nabc\r\n' +
        '--XYZ--\r\n'
    );
  });

  it('streams React Native file parts from disk', async () => {
    const form = { _parts: [['photo', { uri: 'file:///tmp/p.jpg', name: 'p.jpg', type: 'image/jpeg' }], ['n', 1]] };
    const { bytes, parts } = await encodeBody(form, 'XYZ');
    expect(bytes).toBeNull();
    expect(parts).toHaveLength(3);
    expect(text(parts![0].data!)).toContain('filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n');
    expect(parts![1]).toEqual({ uri: 'file:///tmp/p.jpg' });
    expect(text(parts![2].data!)).toBe('\r\n--XYZ\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n--XYZ--\r\n');
  });

  it('sends a bare file reference as the whole body', async () => {
    const { parts } = await encodeBody({ uri: 'file:///video.mp4', type: 'video/mp4' }, 'b');
    expect(parts).toEqual([{ uri: 'file:///video.mp4' }]);
    expect(impliedContentType({ uri: 'file:///video.mp4', type: 'video/mp4' }, 'b')).toBe('video/mp4');
  });

  it('escapes quotes and newlines in field names', async () => {
    const form = new FormData();
    form.append('a"b\nc', 'v');
    const { bytes } = await encodeBody(form, 'B');
    expect(text(bytes)).toContain('name="a%22b%0Ac"');
  });

  it('reads ReadableStream bodies', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    const { bytes } = await encodeBody(stream, 'b');
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
  });
});
