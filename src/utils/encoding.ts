export const decoder = new TextDecoder();

export const zipPairs = (arr: string[]): Array<[string, string]> => {
  const result: Array<[string, string]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    result.push([arr[i], arr[i + 1]]);
  }
  return result;
};

export const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};
