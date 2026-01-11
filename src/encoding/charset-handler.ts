/**
 * Character set handling utilities
 * Provides functions for detecting, validating, and converting character sets
 */

import { EncodingError } from './text-encoder.js';

export { EncodingError };

export type CharsetName = 'utf-8' | 'utf-16' | 'utf-16le' | 'utf-16be' | 'ascii' | 'latin1' | 'iso-8859-1';

export interface CharsetInfo {
  name: CharsetName;
  confidence: number;
  hasBOM: boolean;
}

/**
 * Detect the character set of a byte array
 * @param bytes - The byte array to analyze
 * @returns Charset detection result
 */
export function detectCharset(bytes: Uint8Array): CharsetInfo {
  if (bytes === null || bytes === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new EncodingError('Input must be a Uint8Array');
  }

  if (bytes.length === 0) {
    return { name: 'utf-8', confidence: 0.5, hasBOM: false };
  }

  // Check for BOM (Byte Order Mark)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { name: 'utf-8', confidence: 1.0, hasBOM: true };
  }

  if (bytes.length >= 2) {
    // UTF-16 LE BOM
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { name: 'utf-16le', confidence: 1.0, hasBOM: true };
    }
    // UTF-16 BE BOM
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { name: 'utf-16be', confidence: 1.0, hasBOM: true };
    }
  }

  // Check for UTF-8 validity
  let isValidUtf8 = true;
  let hasUtf8MultiBytes = false;
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte <= 0x7F) {
      // ASCII byte
      i++;
    } else if ((byte & 0xE0) === 0xC0) {
      // 2-byte sequence
      if (i + 1 >= bytes.length || (bytes[i + 1] & 0xC0) !== 0x80) {
        isValidUtf8 = false;
        break;
      }
      hasUtf8MultiBytes = true;
      i += 2;
    } else if ((byte & 0xF0) === 0xE0) {
      // 3-byte sequence
      if (i + 2 >= bytes.length ||
          (bytes[i + 1] & 0xC0) !== 0x80 ||
          (bytes[i + 2] & 0xC0) !== 0x80) {
        isValidUtf8 = false;
        break;
      }
      hasUtf8MultiBytes = true;
      i += 3;
    } else if ((byte & 0xF8) === 0xF0) {
      // 4-byte sequence
      if (i + 3 >= bytes.length ||
          (bytes[i + 1] & 0xC0) !== 0x80 ||
          (bytes[i + 2] & 0xC0) !== 0x80 ||
          (bytes[i + 3] & 0xC0) !== 0x80) {
        isValidUtf8 = false;
        break;
      }
      hasUtf8MultiBytes = true;
      i += 4;
    } else {
      isValidUtf8 = false;
      break;
    }
  }

  if (isValidUtf8) {
    const confidence = hasUtf8MultiBytes ? 0.95 : 0.7;
    return { name: 'utf-8', confidence, hasBOM: false };
  }

  // Check if all bytes are ASCII (0-127)
  const allAscii = Array.from(bytes).every(b => b <= 127);
  if (allAscii) {
    return { name: 'ascii', confidence: 0.9, hasBOM: false };
  }

  // Check for Latin-1 (ISO-8859-1) - all bytes 0-255 are valid
  const hasHighBytes = Array.from(bytes).some(b => b >= 128);
  if (hasHighBytes) {
    return { name: 'latin1', confidence: 0.6, hasBOM: false };
  }

  // Default to UTF-8 with low confidence
  return { name: 'utf-8', confidence: 0.5, hasBOM: false };
}

/**
 * Validate if a string contains only ASCII characters
 * @param input - The string to validate
 * @returns true if ASCII-only, false otherwise
 */
export function isAscii(input: string): boolean {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
}

/**
 * Validate if a string contains only printable ASCII characters
 * @param input - The string to validate
 * @returns true if printable ASCII-only, false otherwise
 */
export function isPrintableAscii(input: string): boolean {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Printable ASCII: 32 (space) to 126 (~), plus common whitespace
    if (code < 32 || code > 126) {
      // Allow tab, newline, carriage return
      if (code !== 9 && code !== 10 && code !== 13) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Validate if a byte array is valid UTF-8
 * @param bytes - The byte array to validate
 * @returns true if valid UTF-8, false otherwise
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  if (bytes === null || bytes === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new EncodingError('Input must be a Uint8Array');
  }

  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte <= 0x7F) {
      i++;
    } else if ((byte & 0xE0) === 0xC0) {
      if (i + 1 >= bytes.length || (bytes[i + 1] & 0xC0) !== 0x80) {
        return false;
      }
      // Check for overlong encoding
      if ((byte & 0x1E) === 0) {
        return false;
      }
      i += 2;
    } else if ((byte & 0xF0) === 0xE0) {
      if (i + 2 >= bytes.length ||
          (bytes[i + 1] & 0xC0) !== 0x80 ||
          (bytes[i + 2] & 0xC0) !== 0x80) {
        return false;
      }
      i += 3;
    } else if ((byte & 0xF8) === 0xF0) {
      if (i + 3 >= bytes.length ||
          (bytes[i + 1] & 0xC0) !== 0x80 ||
          (bytes[i + 2] & 0xC0) !== 0x80 ||
          (bytes[i + 3] & 0xC0) !== 0x80) {
        return false;
      }
      i += 4;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Remove BOM (Byte Order Mark) from a byte array
 * @param bytes - The byte array to process
 * @returns Byte array without BOM
 */
export function removeBOM(bytes: Uint8Array): Uint8Array {
  if (bytes === null || bytes === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new EncodingError('Input must be a Uint8Array');
  }

  if (bytes.length === 0) {
    return bytes;
  }

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return bytes.slice(3);
  }

  // UTF-16 LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return bytes.slice(2);
  }

  // UTF-16 BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return bytes.slice(2);
  }

  return bytes;
}

/**
 * Add UTF-8 BOM to a byte array
 * @param bytes - The byte array to process
 * @returns Byte array with UTF-8 BOM prepended
 */
export function addUtf8BOM(bytes: Uint8Array): Uint8Array {
  if (bytes === null || bytes === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new EncodingError('Input must be a Uint8Array');
  }

  // Check if BOM already exists
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return bytes;
  }

  const result = new Uint8Array(bytes.length + 3);
  result[0] = 0xEF;
  result[1] = 0xBB;
  result[2] = 0xBF;
  result.set(bytes, 3);
  return result;
}

/**
 * Normalize line endings to a specified format
 * @param input - The string to normalize
 * @param format - The target line ending format ('lf', 'crlf', 'cr')
 * @returns String with normalized line endings
 */
export function normalizeLineEndings(input: string, format: 'lf' | 'crlf' | 'cr' = 'lf'): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  // First normalize to LF
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  switch (format) {
    case 'lf':
      return normalized;
    case 'crlf':
      return normalized.replace(/\n/g, '\r\n');
    case 'cr':
      return normalized.replace(/\n/g, '\r');
    default:
      throw new EncodingError(`Unsupported line ending format: ${format}`);
  }
}

/**
 * Detect the line ending format used in a string
 * @param input - The string to analyze
 * @returns The detected line ending format
 */
export function detectLineEndings(input: string): 'lf' | 'crlf' | 'cr' | 'mixed' | 'none' {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const crlfCount = (input.match(/\r\n/g) || []).length;
  const lfOnlyCount = (input.replace(/\r\n/g, '').match(/\n/g) || []).length;
  const crOnlyCount = (input.replace(/\r\n/g, '').match(/\r/g) || []).length;

  const total = crlfCount + lfOnlyCount + crOnlyCount;

  if (total === 0) {
    return 'none';
  }

  // Check if multiple formats are used
  const formats = [crlfCount > 0, lfOnlyCount > 0, crOnlyCount > 0].filter(Boolean).length;
  if (formats > 1) {
    return 'mixed';
  }

  if (crlfCount > 0) return 'crlf';
  if (lfOnlyCount > 0) return 'lf';
  if (crOnlyCount > 0) return 'cr';

  return 'none';
}

/**
 * Convert string from one charset to another
 * @param input - The string to convert
 * @param fromCharset - Source charset
 * @param toCharset - Target charset
 * @returns Converted string
 */
export function convertCharset(
  input: string | Uint8Array,
  fromCharset: CharsetName,
  toCharset: CharsetName
): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }

  let decoded: string;

  // Decode from source charset
  if (typeof input === 'string') {
    decoded = input;
  } else if (input instanceof Uint8Array) {
    switch (fromCharset) {
      case 'utf-8':
        decoded = new TextDecoder('utf-8').decode(input);
        break;
      case 'utf-16':
      case 'utf-16le':
        decoded = new TextDecoder('utf-16le').decode(input);
        break;
      case 'utf-16be':
        decoded = new TextDecoder('utf-16be').decode(input);
        break;
      case 'ascii':
      case 'latin1':
      case 'iso-8859-1':
        decoded = new TextDecoder('iso-8859-1').decode(input);
        break;
      default:
        throw new EncodingError(`Unsupported source charset: ${fromCharset}`);
    }
  } else {
    throw new EncodingError('Input must be a string or Uint8Array');
  }

  // For ASCII target, validate and return
  if (toCharset === 'ascii') {
    for (let i = 0; i < decoded.length; i++) {
      if (decoded.charCodeAt(i) > 127) {
        throw new EncodingError(`Character at position ${i} cannot be represented in ASCII`);
      }
    }
    return decoded;
  }

  // For Latin-1 target, validate and return
  if (toCharset === 'latin1' || toCharset === 'iso-8859-1') {
    for (let i = 0; i < decoded.length; i++) {
      if (decoded.charCodeAt(i) > 255) {
        throw new EncodingError(`Character at position ${i} cannot be represented in Latin-1`);
      }
    }
    return decoded;
  }

  // For UTF-* targets, just return the decoded string
  return decoded;
}

/**
 * Get byte length of a string in a specific encoding
 * @param input - The string to measure
 * @param charset - The target charset
 * @returns Byte length
 */
export function getByteLength(input: string, charset: CharsetName = 'utf-8'): number {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  switch (charset) {
    case 'utf-8':
      return new TextEncoder().encode(input).length;
    case 'utf-16':
    case 'utf-16le':
    case 'utf-16be':
      return input.length * 2;
    case 'ascii':
      // Validate ASCII
      for (let i = 0; i < input.length; i++) {
        if (input.charCodeAt(i) > 127) {
          throw new EncodingError(`Character at position ${i} is not ASCII`);
        }
      }
      return input.length;
    case 'latin1':
    case 'iso-8859-1':
      // Validate Latin-1
      for (let i = 0; i < input.length; i++) {
        if (input.charCodeAt(i) > 255) {
          throw new EncodingError(`Character at position ${i} is not Latin-1`);
        }
      }
      return input.length;
    default:
      throw new EncodingError(`Unsupported charset: ${charset}`);
  }
}

/**
 * Replace invalid characters in a string for a target charset
 * @param input - The string to sanitize
 * @param charset - The target charset
 * @param replacement - The replacement character (default: '?')
 * @returns Sanitized string
 */
export function sanitizeForCharset(
  input: string,
  charset: CharsetName,
  replacement: string = '?'
): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }
  if (typeof replacement !== 'string') {
    throw new EncodingError('Replacement must be a string');
  }

  let result = '';
  const maxCode = charset === 'ascii' ? 127 : (charset === 'latin1' || charset === 'iso-8859-1') ? 255 : Infinity;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= maxCode) {
      result += input[i];
    } else {
      result += replacement;
    }
  }

  return result;
}

/**
 * Check if a string can be encoded in a specific charset without data loss
 * @param input - The string to check
 * @param charset - The target charset
 * @returns true if encodable without loss, false otherwise
 */
export function canEncodeAs(input: string, charset: CharsetName): boolean {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const maxCode = charset === 'ascii' ? 127 : (charset === 'latin1' || charset === 'iso-8859-1') ? 255 : Infinity;

  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > maxCode) {
      return false;
    }
  }

  return true;
}

/**
 * Get unicode code points from a string
 * @param input - The string to analyze
 * @returns Array of code points
 */
export function getCodePoints(input: string): number[] {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const codePoints: number[] = [];

  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      codePoints.push(codePoint);
    }
  }

  return codePoints;
}

/**
 * Create a string from unicode code points
 * @param codePoints - Array of code points
 * @returns Resulting string
 */
export function fromCodePoints(codePoints: number[]): string {
  if (codePoints === null || codePoints === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!Array.isArray(codePoints)) {
    throw new EncodingError('Input must be an array');
  }

  for (let i = 0; i < codePoints.length; i++) {
    if (typeof codePoints[i] !== 'number' || !Number.isInteger(codePoints[i]) || codePoints[i] < 0) {
      throw new EncodingError(`Invalid code point at index ${i}`);
    }
    if (codePoints[i] > 0x10FFFF) {
      throw new EncodingError(`Code point at index ${i} exceeds maximum valid value`);
    }
  }

  return String.fromCodePoint(...codePoints);
}
