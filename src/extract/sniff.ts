export type FileKind = 'pdf' | 'zip' | 'text' | 'legacy-doc' | 'rtf' | 'unknown';

const PDF_HEADER = '%PDF-';
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const RTF = [0x7b, 0x5c, 0x72, 0x74, 0x66];
const UTF16_LE_BOM = [0xff, 0xfe];
const UTF16_BE_BOM = [0xfe, 0xff];

const SAMPLE_BYTES = 8192;
const MAX_ODD_SHARE = 0.01;
// PDF readers accept a few stray bytes before the header, as long as it is in the first 1024 bytes.
const PDF_HEADER_WINDOW = 1024;

function startsWith(data: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

function hasPdfHeader(data: Uint8Array): boolean {
  return Buffer.from(data.buffer, data.byteOffset, Math.min(data.length, PDF_HEADER_WINDOW)).includes(PDF_HEADER);
}

/** Plain text has no zero bytes and almost no control characters. */
function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, SAMPLE_BYTES);
  let odd = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) odd += 1;
  }
  return odd <= sample.length * MAX_ODD_SHARE;
}

/** Decides the file type from its first bytes. The file name and the browser's content type are never trusted. */
export function sniffKind(data: Uint8Array): FileKind {
  if (startsWith(data, ZIP)) return 'zip';
  if (startsWith(data, OLE)) return 'legacy-doc';
  if (startsWith(data, RTF)) return 'rtf';
  if (hasPdfHeader(data)) return 'pdf';
  if (startsWith(data, UTF16_LE_BOM) || startsWith(data, UTF16_BE_BOM)) return 'text';
  return looksLikeText(data) ? 'text' : 'unknown';
}

/** Reads a text file as UTF-8, UTF-16 (with a byte order mark) or Windows-1252 (for old files). */
export function decodeText(data: Uint8Array): string {
  if (startsWith(data, UTF16_LE_BOM)) return new TextDecoder('utf-16le').decode(data);
  if (startsWith(data, UTF16_BE_BOM)) return new TextDecoder('utf-16be').decode(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}
