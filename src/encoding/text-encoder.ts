/**
 * Text encoding and decoding utilities
 * Provides functions for encoding/decoding text in various formats
 */

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

/**
 * Encode a string to Base64
 * @param input - The string to encode
 * @returns Base64 encoded string
 */
export function encodeBase64(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  // Handle Unicode characters properly
  const bytes = new TextEncoder().encode(input);
  const binaryString = Array.from(bytes)
    .map(byte => String.fromCharCode(byte))
    .join('');

  return btoa(binaryString);
}

/**
 * Decode a Base64 string
 * @param input - The Base64 string to decode
 * @returns Decoded string
 */
export function decodeBase64(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return '';
  }

  // Validate Base64 format
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) {
    throw new EncodingError('Invalid Base64 string');
  }

  try {
    const binaryString = atob(trimmed);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    throw new EncodingError('Invalid Base64 string');
  }
}

/**
 * Encode a string to URL-safe Base64
 * @param input - The string to encode
 * @returns URL-safe Base64 encoded string
 */
export function encodeBase64Url(input: string): string {
  const base64 = encodeBase64(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a URL-safe Base64 string
 * @param input - The URL-safe Base64 string to decode
 * @returns Decoded string
 */
export function decodeBase64Url(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return '';
  }

  // Convert URL-safe Base64 to standard Base64
  let base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if necessary
  const padding = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padding);

  return decodeBase64(base64);
}

/**
 * Encode a string to hexadecimal
 * @param input - The string to encode
 * @returns Hexadecimal encoded string
 */
export function encodeHex(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const bytes = new TextEncoder().encode(input);
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode a hexadecimal string
 * @param input - The hexadecimal string to decode
 * @returns Decoded string
 */
export function decodeHex(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return '';
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]*$/.test(trimmed)) {
    throw new EncodingError('Invalid hexadecimal string');
  }

  if (trimmed.length % 2 !== 0) {
    throw new EncodingError('Hexadecimal string must have even length');
  }

  const bytes = new Uint8Array(trimmed.length / 2);
  for (let i = 0; i < trimmed.length; i += 2) {
    bytes[i / 2] = parseInt(trimmed.substring(i, i + 2), 16);
  }

  return new TextDecoder().decode(bytes);
}

/**
 * URL encode a string
 * @param input - The string to encode
 * @returns URL encoded string
 */
export function encodeURL(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  return encodeURIComponent(input);
}

/**
 * URL decode a string
 * @param input - The URL encoded string to decode
 * @returns Decoded string
 */
export function decodeURL(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  try {
    return decodeURIComponent(input);
  } catch {
    throw new EncodingError('Invalid URL encoded string');
  }
}

/**
 * Encode a string to HTML entities
 * @param input - The string to encode
 * @returns HTML entity encoded string
 */
export function encodeHTMLEntities(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Decode HTML entities
 * @param input - The HTML entity encoded string to decode
 * @returns Decoded string
 */
export function decodeHTMLEntities(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  let result = input;

  // Replace named entities
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'g'), char);
  }

  // Replace numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

/**
 * Convert a string to bytes (Uint8Array)
 * @param input - The string to convert
 * @param encoding - The encoding to use (default: 'utf-8')
 * @returns Uint8Array of bytes
 */
export function stringToBytes(input: string, encoding: 'utf-8' | 'utf-16' | 'ascii' = 'utf-8'): Uint8Array {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  switch (encoding) {
    case 'utf-8':
      return new TextEncoder().encode(input);
    case 'utf-16': {
      const buffer = new ArrayBuffer(input.length * 2);
      const view = new Uint16Array(buffer);
      for (let i = 0; i < input.length; i++) {
        view[i] = input.charCodeAt(i);
      }
      return new Uint8Array(buffer);
    }
    case 'ascii': {
      const bytes = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        if (code > 127) {
          throw new EncodingError(`Character at position ${i} is not ASCII`);
        }
        bytes[i] = code;
      }
      return bytes;
    }
    default:
      throw new EncodingError(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Convert bytes (Uint8Array) to a string
 * @param bytes - The bytes to convert
 * @param encoding - The encoding to use (default: 'utf-8')
 * @returns Decoded string
 */
export function bytesToString(bytes: Uint8Array, encoding: 'utf-8' | 'utf-16' | 'ascii' = 'utf-8'): string {
  if (bytes === null || bytes === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (!(bytes instanceof Uint8Array)) {
    throw new EncodingError('Input must be a Uint8Array');
  }

  switch (encoding) {
    case 'utf-8':
      return new TextDecoder('utf-8').decode(bytes);
    case 'utf-16': {
      const view = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
      return String.fromCharCode(...view);
    }
    case 'ascii': {
      let result = '';
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] > 127) {
          throw new EncodingError(`Byte at position ${i} is not valid ASCII`);
        }
        result += String.fromCharCode(bytes[i]);
      }
      return result;
    }
    default:
      throw new EncodingError(`Unsupported encoding: ${encoding}`);
  }
}

/**
 * Escape Unicode characters to their escape sequences
 * @param input - The string to escape
 * @returns String with Unicode escape sequences
 */
export function escapeUnicode(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  // eslint-disable-next-line no-control-regex
  return input.replace(/[^\u0000-\u007F]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code > 0xFFFF) {
      // Handle surrogate pairs
      const highSurrogate = Math.floor((code - 0x10000) / 0x400) + 0xD800;
      const lowSurrogate = ((code - 0x10000) % 0x400) + 0xDC00;
      return `\\u${highSurrogate.toString(16).padStart(4, '0')}\\u${lowSurrogate.toString(16).padStart(4, '0')}`;
    }
    return `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

/**
 * Unescape Unicode escape sequences
 * @param input - The string with Unicode escape sequences
 * @returns Unescaped string
 */
export function unescapeUnicode(input: string): string {
  if (input === null || input === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof input !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  return input.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}
