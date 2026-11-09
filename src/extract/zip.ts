import { inflateRawSync } from 'node:zlib';
import { AppError } from '../errors.ts';

/**
 * A small, careful ZIP reader for one job: getting a single part out of a Word file.
 * It reads the central directory, and unpacks only the entry that the caller asks for.
 * Unpacking stops at a size limit, so a "zip bomb" cannot use up the memory.
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Where the local header starts. */
  offset: number;
  encrypted: boolean;
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const MAX_ENTRIES = 2000;
const UINT32_MAX = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;

const damaged = (): AppError => new AppError(422, 'unreadable_file', 'I could not read this Word file. It may be damaged.');
const tooLarge = (): AppError =>
  new AppError(422, 'file_too_complex', 'This file is too large once it is unpacked. Save a smaller copy and try again.');

function findEndRecord(data: Buffer): number {
  const lowest = Math.max(0, data.length - END_SIZE - MAX_COMMENT);
  for (let position = data.length - END_SIZE; position >= lowest; position -= 1) {
    if (data.readUInt32LE(position) === END_SIGNATURE && position + END_SIZE + data.readUInt16LE(position + 20) <= data.length) {
      return position;
    }
  }
  throw damaged();
}

export function listZipEntries(data: Buffer): ZipEntry[] {
  const end = findEndRecord(data);
  const total = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryStart = data.readUInt32LE(end + 16);

  if (data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0 || data.readUInt16LE(end + 8) !== total) {
    throw new AppError(415, 'unsupported_file', 'This ZIP file is split into several parts, which is not supported.');
  }
  if (total === 0xffff || directorySize === UINT32_MAX || directoryStart === UINT32_MAX) throw tooLarge();
  const directoryEnd = directoryStart + directorySize;
  if (total > MAX_ENTRIES || directoryEnd > end) throw damaged();

  const entries: ZipEntry[] = [];
  let position = directoryStart;
  for (let index = 0; index < total; index += 1) {
    if (position + CENTRAL_SIZE > directoryEnd || data.readUInt32LE(position) !== CENTRAL_SIGNATURE) throw damaged();
    const nameLength = data.readUInt16LE(position + 28);
    const next = position + CENTRAL_SIZE + nameLength + data.readUInt16LE(position + 30) + data.readUInt16LE(position + 32);
    if (next > directoryEnd) throw damaged();

    const compressedSize = data.readUInt32LE(position + 20);
    const size = data.readUInt32LE(position + 24);
    const offset = data.readUInt32LE(position + 42);
    if (compressedSize === UINT32_MAX || size === UINT32_MAX || offset === UINT32_MAX) throw tooLarge();

    entries.push({
      name: data.toString('utf8', position + CENTRAL_SIZE, position + CENTRAL_SIZE + nameLength),
      method: data.readUInt16LE(position + 10),
      compressedSize,
      size,
      offset,
      encrypted: (data.readUInt16LE(position + 8) & 1) !== 0,
    });
    position = next;
  }
  return entries;
}

/** Unpacks one entry. It throws if the entry is bigger than maxBytes, either as declared or when really unpacked. */
export function readZipEntry(data: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  if (entry.encrypted) {
    throw new AppError(422, 'password_protected', 'This file is password-protected. Remove the password, or paste the text instead.');
  }
  if (entry.size > maxBytes) throw tooLarge();
  if (entry.offset + LOCAL_SIZE > data.length || data.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE) throw damaged();

  const start = entry.offset + LOCAL_SIZE + data.readUInt16LE(entry.offset + 26) + data.readUInt16LE(entry.offset + 28);
  const end = start + entry.compressedSize;
  if (end > data.length) throw damaged();
  const packed = data.subarray(start, end);

  let content: Buffer;
  if (entry.method === STORED) {
    content = packed;
  } else if (entry.method === DEFLATED) {
    try {
      // The limit is the size the file says it has, so a file that lies about its size is caught here.
      content = inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) });
    } catch (error) {
      throw (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? tooLarge() : damaged();
    }
  } else {
    throw damaged();
  }
  if (content.length !== entry.size) throw damaged();
  return content;
}
