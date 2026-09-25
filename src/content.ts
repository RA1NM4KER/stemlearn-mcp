const TEXT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
]);

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_MIMES.has(mime);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(text);
}
