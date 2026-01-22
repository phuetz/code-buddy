/**
 * Comprehensive unit tests for the encoding module
 * Tests text encoding/decoding, format conversions, and character set handling
 */

import {
  // Text encoder exports
  EncodingError,
  encodeBase64,
  decodeBase64,
  encodeBase64Url,
  decodeBase64Url,
  encodeHex,
  decodeHex,
  encodeURL,
  decodeURL,
  encodeHTMLEntities,
  decodeHTMLEntities,
  stringToBytes,
  bytesToString,
  escapeUnicode,
  unescapeUnicode,
} from '../../src/encoding/text-encoder';

import {
  // Format converter exports
  jsonToXml,
  xmlToJson,
  csvToJson,
  jsonToCsv,
  yamlToJson,
  jsonToYaml,
  queryStringToJson,
  jsonToQueryString,
} from '../../src/encoding/format-converter';

import {
  // Charset handler exports
  detectCharset,
  isAscii,
  isPrintableAscii,
  isValidUtf8,
  removeBOM,
  addUtf8BOM,
  normalizeLineEndings,
  detectLineEndings,
  convertCharset,
  getByteLength,
  sanitizeForCharset,
  canEncodeAs,
  getCodePoints,
  fromCodePoints,
} from '../../src/encoding/charset-handler';

// Unicode test strings - using explicit escape sequences
const CAFE_ACCENT = 'caf\u00e9'; // cafe with e-acute

describe('Encoding Module', () => {
  describe('Text Encoder', () => {
    describe('Base64 Encoding/Decoding', () => {
      describe('encodeBase64', () => {
        it('should encode simple ASCII strings', () => {
          expect(encodeBase64('Hello')).toBe('SGVsbG8=');
          expect(encodeBase64('World')).toBe('V29ybGQ=');
        });

        it('should encode empty string', () => {
          expect(encodeBase64('')).toBe('');
        });

        it('should encode strings with spaces', () => {
          expect(encodeBase64('Hello World')).toBe('SGVsbG8gV29ybGQ=');
        });

        it('should encode Unicode characters', () => {
          const result = encodeBase64(CAFE_ACCENT);
          expect(decodeBase64(result)).toBe(CAFE_ACCENT);
        });

        it('should handle special characters', () => {
          expect(encodeBase64('!@#$%')).toBe('IUAjJCU=');
        });

        it('should throw on null input', () => {
          expect(() => encodeBase64(null as unknown as string)).toThrow(EncodingError);
          expect(() => encodeBase64(null as unknown as string)).toThrow(/null or undefined/);
        });

        it('should throw on undefined input', () => {
          expect(() => encodeBase64(undefined as unknown as string)).toThrow(EncodingError);
        });

        it('should throw on non-string input', () => {
          expect(() => encodeBase64(123 as unknown as string)).toThrow(EncodingError);
          expect(() => encodeBase64({} as unknown as string)).toThrow(/must be a string/);
        });
      });

      describe('decodeBase64', () => {
        it('should decode valid Base64 strings', () => {
          expect(decodeBase64('SGVsbG8=')).toBe('Hello');
          expect(decodeBase64('V29ybGQ=')).toBe('World');
        });

        it('should decode empty string', () => {
          expect(decodeBase64('')).toBe('');
        });

        it('should decode strings with padding', () => {
          expect(decodeBase64('SGVsbG8gV29ybGQ=')).toBe('Hello World');
        });

        it('should trim whitespace before decoding', () => {
          expect(decodeBase64('  SGVsbG8=  ')).toBe('Hello');
        });

        it('should throw on invalid Base64 characters', () => {
          expect(() => decodeBase64('Hello!@#')).toThrow(EncodingError);
          expect(() => decodeBase64('Hello!@#')).toThrow(/Invalid Base64/);
        });

        it('should throw on null input', () => {
          expect(() => decodeBase64(null as unknown as string)).toThrow(EncodingError);
        });

        it('should throw on undefined input', () => {
          expect(() => decodeBase64(undefined as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('URL-safe Base64', () => {
        it('should encode to URL-safe Base64', () => {
          const input = 'Hello+World/Test';
          const encoded = encodeBase64Url(input);
          expect(encoded).not.toContain('+');
          expect(encoded).not.toContain('/');
          expect(encoded).not.toContain('=');
        });

        it('should decode URL-safe Base64', () => {
          const input = 'Hello World';
          const encoded = encodeBase64Url(input);
          expect(decodeBase64Url(encoded)).toBe(input);
        });

        it('should decode empty string', () => {
          expect(decodeBase64Url('')).toBe('');
          expect(decodeBase64Url('  ')).toBe('');
        });

        it('should handle strings that produce padding', () => {
          const input = 'test';
          const encoded = encodeBase64Url(input);
          expect(decodeBase64Url(encoded)).toBe(input);
        });

        it('should throw on null input for decoding', () => {
          expect(() => decodeBase64Url(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('Hexadecimal Encoding/Decoding', () => {
      describe('encodeHex', () => {
        it('should encode simple strings', () => {
          expect(encodeHex('Hi')).toBe('4869');
          expect(encodeHex('ABC')).toBe('414243');
        });

        it('should encode empty string', () => {
          expect(encodeHex('')).toBe('');
        });

        it('should handle special characters', () => {
          expect(encodeHex('\n')).toBe('0a');
          expect(encodeHex('\t')).toBe('09');
        });

        it('should throw on null input', () => {
          expect(() => encodeHex(null as unknown as string)).toThrow(EncodingError);
        });

        it('should throw on non-string input', () => {
          expect(() => encodeHex(123 as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('decodeHex', () => {
        it('should decode valid hex strings', () => {
          expect(decodeHex('4869')).toBe('Hi');
          expect(decodeHex('414243')).toBe('ABC');
        });

        it('should decode empty string', () => {
          expect(decodeHex('')).toBe('');
          expect(decodeHex('  ')).toBe('');
        });

        it('should handle uppercase and lowercase', () => {
          expect(decodeHex('4869')).toBe('Hi');
          expect(decodeHex('4869')).toBe(decodeHex('4869'));
        });

        it('should throw on invalid hex characters', () => {
          expect(() => decodeHex('GGGG')).toThrow(EncodingError);
          expect(() => decodeHex('GGGG')).toThrow(/Invalid hexadecimal/);
        });

        it('should throw on odd-length hex string', () => {
          expect(() => decodeHex('123')).toThrow(EncodingError);
          expect(() => decodeHex('123')).toThrow(/even length/);
        });

        it('should throw on null input', () => {
          expect(() => decodeHex(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('URL Encoding/Decoding', () => {
      describe('encodeURL', () => {
        it('should encode special characters', () => {
          expect(encodeURL('hello world')).toBe('hello%20world');
          expect(encodeURL('a=b&c=d')).toBe('a%3Db%26c%3Dd');
        });

        it('should not encode safe characters', () => {
          expect(encodeURL('abc123')).toBe('abc123');
          expect(encodeURL('-_.~')).toBe('-_.~');
        });

        it('should encode Unicode characters', () => {
          const encoded = encodeURL(CAFE_ACCENT);
          expect(encoded).toContain('%');
        });

        it('should throw on null input', () => {
          expect(() => encodeURL(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('decodeURL', () => {
        it('should decode percent-encoded strings', () => {
          expect(decodeURL('hello%20world')).toBe('hello world');
          expect(decodeURL('a%3Db%26c%3Dd')).toBe('a=b&c=d');
        });

        it('should handle strings without encoding', () => {
          expect(decodeURL('hello')).toBe('hello');
        });

        it('should throw on invalid percent encoding', () => {
          expect(() => decodeURL('%GG')).toThrow(EncodingError);
          expect(() => decodeURL('%GG')).toThrow(/Invalid URL encoded/);
        });

        it('should throw on null input', () => {
          expect(() => decodeURL(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('HTML Entity Encoding/Decoding', () => {
      describe('encodeHTMLEntities', () => {
        it('should encode HTML special characters', () => {
          expect(encodeHTMLEntities('<div>')).toBe('&lt;div&gt;');
          expect(encodeHTMLEntities('a & b')).toBe('a &amp; b');
          expect(encodeHTMLEntities('"quoted"')).toBe('&quot;quoted&quot;');
        });

        it('should encode single quotes', () => {
          expect(encodeHTMLEntities("it's")).toBe('it&#39;s');
        });

        it('should handle empty string', () => {
          expect(encodeHTMLEntities('')).toBe('');
        });

        it('should throw on null input', () => {
          expect(() => encodeHTMLEntities(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('decodeHTMLEntities', () => {
        it('should decode named entities', () => {
          expect(decodeHTMLEntities('&lt;div&gt;')).toBe('<div>');
          expect(decodeHTMLEntities('a &amp; b')).toBe('a & b');
          expect(decodeHTMLEntities('&quot;quoted&quot;')).toBe('"quoted"');
        });

        it('should decode numeric entities', () => {
          expect(decodeHTMLEntities('&#65;')).toBe('A');
          expect(decodeHTMLEntities('&#x41;')).toBe('A');
        });

        it('should decode single quote entities', () => {
          expect(decodeHTMLEntities('it&#39;s')).toBe("it's");
          expect(decodeHTMLEntities('it&apos;s')).toBe("it's");
        });

        it('should decode nbsp', () => {
          expect(decodeHTMLEntities('hello&nbsp;world')).toBe('hello world');
        });

        it('should throw on null input', () => {
          expect(() => decodeHTMLEntities(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('String/Bytes Conversion', () => {
      describe('stringToBytes', () => {
        it('should convert string to UTF-8 bytes', () => {
          const bytes = stringToBytes('Hi', 'utf-8');
          expect(bytes).toEqual(new Uint8Array([72, 105]));
        });

        it('should convert string to UTF-16 bytes', () => {
          const bytes = stringToBytes('A', 'utf-16');
          expect(bytes.length).toBe(2);
          expect(bytes[0]).toBe(65);
          expect(bytes[1]).toBe(0);
        });

        it('should convert ASCII string', () => {
          const bytes = stringToBytes('ABC', 'ascii');
          expect(bytes).toEqual(new Uint8Array([65, 66, 67]));
        });

        it('should throw for non-ASCII chars with ascii encoding', () => {
          expect(() => stringToBytes(CAFE_ACCENT, 'ascii')).toThrow(EncodingError);
          expect(() => stringToBytes(CAFE_ACCENT, 'ascii')).toThrow(/not ASCII/);
        });

        it('should throw on null input', () => {
          expect(() => stringToBytes(null as unknown as string)).toThrow(EncodingError);
        });

        it('should throw on unsupported encoding', () => {
          expect(() => stringToBytes('test', 'invalid' as unknown as BufferEncoding)).toThrow(EncodingError);
        });
      });

      describe('bytesToString', () => {
        it('should convert UTF-8 bytes to string', () => {
          const bytes = new Uint8Array([72, 105]);
          expect(bytesToString(bytes, 'utf-8')).toBe('Hi');
        });

        it('should convert UTF-16 bytes to string', () => {
          const bytes = new Uint8Array([65, 0]);
          expect(bytesToString(bytes, 'utf-16')).toBe('A');
        });

        it('should convert ASCII bytes', () => {
          const bytes = new Uint8Array([65, 66, 67]);
          expect(bytesToString(bytes, 'ascii')).toBe('ABC');
        });

        it('should throw for non-ASCII bytes with ascii encoding', () => {
          const bytes = new Uint8Array([200]);
          expect(() => bytesToString(bytes, 'ascii')).toThrow(EncodingError);
        });

        it('should throw on null input', () => {
          expect(() => bytesToString(null as unknown as Uint8Array)).toThrow(EncodingError);
        });

        it('should throw on non-Uint8Array input', () => {
          expect(() => bytesToString([1, 2, 3] as unknown as Uint8Array)).toThrow(EncodingError);
        });
      });
    });

    describe('Unicode Escape/Unescape', () => {
      describe('escapeUnicode', () => {
        it('should escape non-ASCII characters', () => {
          expect(escapeUnicode(CAFE_ACCENT)).toBe('caf\\u00e9');
        });

        it('should leave ASCII unchanged', () => {
          expect(escapeUnicode('hello')).toBe('hello');
        });

        it('should handle empty string', () => {
          expect(escapeUnicode('')).toBe('');
        });

        it('should throw on null input', () => {
          expect(() => escapeUnicode(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('unescapeUnicode', () => {
        it('should unescape Unicode sequences', () => {
          expect(unescapeUnicode('caf\\u00e9')).toBe(CAFE_ACCENT);
        });

        it('should leave regular strings unchanged', () => {
          expect(unescapeUnicode('hello')).toBe('hello');
        });

        it('should handle multiple escapes', () => {
          expect(unescapeUnicode('\\u0041\\u0042')).toBe('AB');
        });

        it('should throw on null input', () => {
          expect(() => unescapeUnicode(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });
  });

  describe('Format Converter', () => {
    describe('JSON to XML Conversion', () => {
      it('should convert simple JSON to XML', () => {
        const json = { name: 'John', age: 30 };
        const xml = jsonToXml(json, { includeDeclaration: false });
        expect(xml).toContain('<root>');
        expect(xml).toContain('<name>John</name>');
        expect(xml).toContain('<age>30</age>');
        expect(xml).toContain('</root>');
      });

      it('should include XML declaration by default', () => {
        const json = { test: 'value' };
        const xml = jsonToXml(json);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      });

      it('should use custom root element', () => {
        const json = { test: 'value' };
        const xml = jsonToXml(json, { rootElement: 'custom', includeDeclaration: false });
        expect(xml).toContain('<custom>');
        expect(xml).toContain('</custom>');
      });

      it('should handle nested objects', () => {
        const json = { user: { name: 'John' } };
        const xml = jsonToXml(json, { includeDeclaration: false });
        expect(xml).toContain('<user>');
        expect(xml).toContain('<name>John</name>');
        expect(xml).toContain('</user>');
      });

      it('should handle arrays', () => {
        const json = { items: [1, 2, 3] };
        const xml = jsonToXml(json, { includeDeclaration: false });
        expect(xml).toContain('<item>1</item>');
        expect(xml).toContain('<item>2</item>');
        expect(xml).toContain('<item>3</item>');
      });

      it('should escape XML special characters', () => {
        const json = { text: '<script>&test</script>' };
        const xml = jsonToXml(json, { includeDeclaration: false });
        expect(xml).toContain('&lt;script&gt;');
        expect(xml).toContain('&amp;test');
      });

      it('should parse JSON string input', () => {
        const xml = jsonToXml('{"test": "value"}', { includeDeclaration: false });
        expect(xml).toContain('<test>value</test>');
      });

      it('should throw on invalid JSON string', () => {
        expect(() => jsonToXml('{invalid}')).toThrow(EncodingError);
      });

      it('should throw on null input', () => {
        expect(() => jsonToXml(null as unknown as string)).toThrow(EncodingError);
      });
    });

    describe('XML to JSON Conversion', () => {
      it('should convert simple XML to JSON', () => {
        const xml = '<root><name>John</name><age>30</age></root>';
        const json = xmlToJson(xml);
        expect(json).toHaveProperty('root');
        expect((json.root as Record<string, unknown>).name).toBe('John');
        expect((json.root as Record<string, unknown>).age).toBe('30');
      });

      it('should handle XML declaration', () => {
        const xml = '<?xml version="1.0"?><root><test>value</test></root>';
        const json = xmlToJson(xml);
        expect((json.root as Record<string, unknown>).test).toBe('value');
      });

      it('should preserve attributes when enabled', () => {
        const xml = '<root id="123"><item attr="val">content</item></root>';
        const json = xmlToJson(xml, { preserveAttributes: true });
        expect((json.root as Record<string, unknown>)['@attributes']).toHaveProperty('id', '123');
      });

      it('should handle self-closing tags', () => {
        const xml = '<root><empty/></root>';
        const json = xmlToJson(xml);
        expect(json).toHaveProperty('root');
      });

      it('should throw on empty string', () => {
        expect(() => xmlToJson('')).toThrow(EncodingError);
      });

      it('should throw on invalid XML', () => {
        expect(() => xmlToJson('not xml')).toThrow(EncodingError);
      });

      it('should throw on null input', () => {
        expect(() => xmlToJson(null as unknown as string)).toThrow(EncodingError);
      });
    });

    describe('CSV to JSON Conversion', () => {
      it('should convert CSV with headers', () => {
        const csv = 'name,age\nJohn,30\nJane,25';
        const json = csvToJson(csv);
        expect(json).toHaveLength(2);
        expect(json[0]).toEqual({ name: 'John', age: '30' });
        expect(json[1]).toEqual({ name: 'Jane', age: '25' });
      });

      it('should handle CSV without headers', () => {
        const csv = 'John,30\nJane,25';
        const json = csvToJson(csv, { hasHeader: false });
        expect(json).toHaveLength(2);
        expect(json[0]).toEqual({ col0: 'John', col1: '30' });
      });

      it('should handle custom delimiter', () => {
        const csv = 'name;age\nJohn;30';
        const json = csvToJson(csv, { delimiter: ';' });
        expect(json[0]).toEqual({ name: 'John', age: '30' });
      });

      it('should handle quoted fields', () => {
        const csv = 'name,description\nJohn,"Hello, World"';
        const json = csvToJson(csv);
        expect(json[0].description).toBe('Hello, World');
      });

      it('should trim values when enabled', () => {
        const csv = 'name,age\n John , 30 ';
        const json = csvToJson(csv, { trimValues: true });
        expect(json[0]).toEqual({ name: 'John', age: '30' });
      });

      it('should return empty array for empty input', () => {
        expect(csvToJson('')).toEqual([]);
        expect(csvToJson('  ')).toEqual([]);
      });

      it('should throw on null input', () => {
        expect(() => csvToJson(null as unknown as string)).toThrow(EncodingError);
      });
    });

    describe('JSON to CSV Conversion', () => {
      it('should convert JSON array to CSV', () => {
        const json = [
          { name: 'John', age: 30 },
          { name: 'Jane', age: 25 },
        ];
        const csv = jsonToCsv(json);
        const lines = csv.split('\n');
        expect(lines[0]).toContain('name');
        expect(lines[0]).toContain('age');
        expect(lines[1]).toContain('John');
        expect(lines[1]).toContain('30');
      });

      it('should handle custom delimiter', () => {
        const json = [{ a: 1, b: 2 }];
        const csv = jsonToCsv(json, { delimiter: ';' });
        expect(csv).toContain(';');
      });

      it('should exclude header when disabled', () => {
        const json = [{ name: 'John' }];
        const csv = jsonToCsv(json, { includeHeader: false });
        expect(csv).toBe('John');
      });

      it('should escape values with delimiters', () => {
        const json = [{ name: 'John, Jr.' }];
        const csv = jsonToCsv(json);
        expect(csv).toContain('"John, Jr."');
      });

      it('should escape values with quotes', () => {
        const json = [{ name: 'John "JJ" Doe' }];
        const csv = jsonToCsv(json);
        expect(csv).toContain('""');
      });

      it('should return empty string for empty array', () => {
        expect(jsonToCsv([])).toBe('');
      });

      it('should parse JSON string input', () => {
        const csv = jsonToCsv('[{"a": 1}]');
        expect(csv).toContain('a');
        expect(csv).toContain('1');
      });

      it('should throw on non-array input', () => {
        expect(() => jsonToCsv({ not: 'array' } as unknown as any[])).toThrow(EncodingError);
      });

      it('should throw on null input', () => {
        expect(() => jsonToCsv(null as unknown as any[])).toThrow(EncodingError);
      });
    });

    describe('YAML to JSON Conversion', () => {
      it('should convert simple YAML', () => {
        const yaml = 'name: John\nage: 30';
        const json = yamlToJson(yaml);
        expect(json).toEqual({ name: 'John', age: 30 });
      });

      it('should handle nested structures', () => {
        const yaml = 'user:\n  name: John\n  age: 30';
        const json = yamlToJson(yaml);
        expect(json.user).toEqual({ name: 'John', age: 30 });
      });

      it('should handle boolean values', () => {
        const yaml = 'enabled: true\ndisabled: false';
        const json = yamlToJson(yaml);
        expect(json.enabled).toBe(true);
        expect(json.disabled).toBe(false);
      });

      it('should handle null values', () => {
        const yaml = 'value: null';
        const json = yamlToJson(yaml);
        expect(json.value).toBeNull();
      });

      it('should handle quoted strings', () => {
        const yaml = 'name: "John Doe"';
        const json = yamlToJson(yaml);
        expect(json.name).toBe('John Doe');
      });

      it('should skip comments', () => {
        const yaml = '# Comment\nname: John';
        const json = yamlToJson(yaml);
        expect(json.name).toBe('John');
        expect(json).not.toHaveProperty('# Comment');
      });

      it('should return empty object for empty input', () => {
        expect(yamlToJson('')).toEqual({});
        expect(yamlToJson('  ')).toEqual({});
      });

      it('should throw on null input', () => {
        expect(() => yamlToJson(null as unknown as string)).toThrow(EncodingError);
      });
    });

    describe('JSON to YAML Conversion', () => {
      it('should convert simple JSON', () => {
        const json = { name: 'John', age: 30 };
        const yaml = jsonToYaml(json);
        expect(yaml).toContain('name: John');
        expect(yaml).toContain('age: 30');
      });

      it('should handle nested objects', () => {
        const json = { user: { name: 'John' } };
        const yaml = jsonToYaml(json);
        expect(yaml).toContain('user:');
        expect(yaml).toContain('name: John');
      });

      it('should handle arrays', () => {
        const json = { items: [1, 2, 3] };
        const yaml = jsonToYaml(json);
        expect(yaml).toContain('items:');
        expect(yaml).toContain('- 1');
        expect(yaml).toContain('- 2');
      });

      it('should handle boolean and null', () => {
        const json = { enabled: true, value: null };
        const yaml = jsonToYaml(json);
        expect(yaml).toContain('enabled: true');
        expect(yaml).toContain('value: null');
      });

      it('should parse JSON string input', () => {
        const yaml = jsonToYaml('{"test": "value"}');
        expect(yaml).toContain('test: value');
      });

      it('should throw on invalid JSON string', () => {
        expect(() => jsonToYaml('{invalid}')).toThrow(EncodingError);
      });

      it('should throw on null input', () => {
        expect(() => jsonToYaml(null as unknown as object)).toThrow(EncodingError);
      });
    });

    describe('Query String Conversion', () => {
      describe('queryStringToJson', () => {
        it('should parse simple query string', () => {
          const result = queryStringToJson('a=1&b=2');
          expect(result).toEqual({ a: '1', b: '2' });
        });

        it('should handle leading question mark', () => {
          const result = queryStringToJson('?a=1&b=2');
          expect(result).toEqual({ a: '1', b: '2' });
        });

        it('should decode URL-encoded values', () => {
          const result = queryStringToJson('name=John%20Doe');
          expect(result.name).toBe('John Doe');
        });

        it('should handle duplicate keys as arrays', () => {
          const result = queryStringToJson('tag=a&tag=b&tag=c');
          expect(result.tag).toEqual(['a', 'b', 'c']);
        });

        it('should handle empty values', () => {
          const result = queryStringToJson('key=');
          expect(result.key).toBe('');
        });

        it('should return empty object for empty input', () => {
          expect(queryStringToJson('')).toEqual({});
          expect(queryStringToJson('?')).toEqual({});
        });

        it('should throw on null input', () => {
          expect(() => queryStringToJson(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('jsonToQueryString', () => {
        it('should convert simple object', () => {
          const result = jsonToQueryString({ a: '1', b: '2' });
          expect(result).toContain('a=1');
          expect(result).toContain('b=2');
          expect(result).toContain('&');
        });

        it('should include question mark when requested', () => {
          const result = jsonToQueryString({ a: '1' }, true);
          expect(result).toBe('?a=1');
        });

        it('should URL-encode values', () => {
          const result = jsonToQueryString({ name: 'John Doe' });
          expect(result).toContain('John%20Doe');
        });

        it('should handle arrays', () => {
          const result = jsonToQueryString({ tag: ['a', 'b'] });
          expect(result).toContain('tag=a');
          expect(result).toContain('tag=b');
        });

        it('should skip null and undefined values', () => {
          const result = jsonToQueryString({ a: '1', b: null, c: undefined } as unknown as Record<string, string>);
          expect(result).toBe('a=1');
        });

        it('should return empty string for empty object', () => {
          expect(jsonToQueryString({})).toBe('');
        });

        it('should throw on null input', () => {
          expect(() => jsonToQueryString(null as unknown as object)).toThrow(EncodingError);
        });

        it('should throw on array input', () => {
          expect(() => jsonToQueryString([] as unknown as object)).toThrow(EncodingError);
        });
      });
    });
  });

  describe('Charset Handler', () => {
    describe('Charset Detection', () => {
      describe('detectCharset', () => {
        it('should detect UTF-8 BOM', () => {
          const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x48, 0x69]);
          const result = detectCharset(bytes);
          expect(result.name).toBe('utf-8');
          expect(result.hasBOM).toBe(true);
          expect(result.confidence).toBe(1.0);
        });

        it('should detect UTF-16 LE BOM', () => {
          const bytes = new Uint8Array([0xFF, 0xFE, 0x48, 0x00]);
          const result = detectCharset(bytes);
          expect(result.name).toBe('utf-16le');
          expect(result.hasBOM).toBe(true);
        });

        it('should detect UTF-16 BE BOM', () => {
          const bytes = new Uint8Array([0xFE, 0xFF, 0x00, 0x48]);
          const result = detectCharset(bytes);
          expect(result.name).toBe('utf-16be');
          expect(result.hasBOM).toBe(true);
        });

        it('should detect ASCII content', () => {
          const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
          const result = detectCharset(bytes);
          expect(result.name).toBe('utf-8');
          expect(result.hasBOM).toBe(false);
        });

        it('should detect UTF-8 with multi-byte sequences', () => {
          const bytes = new TextEncoder().encode('Hello ' + CAFE_ACCENT);
          const result = detectCharset(bytes);
          expect(result.name).toBe('utf-8');
          expect(result.confidence).toBeGreaterThan(0.9);
        });

        it('should return low confidence for empty input', () => {
          const result = detectCharset(new Uint8Array(0));
          expect(result.confidence).toBe(0.5);
        });

        it('should throw on null input', () => {
          expect(() => detectCharset(null as unknown as Uint8Array)).toThrow(EncodingError);
        });

        it('should throw on non-Uint8Array input', () => {
          expect(() => detectCharset([1, 2, 3] as unknown as Uint8Array)).toThrow(EncodingError);
        });
      });
    });

    describe('ASCII Validation', () => {
      describe('isAscii', () => {
        it('should return true for ASCII-only strings', () => {
          expect(isAscii('Hello World')).toBe(true);
          expect(isAscii('abc123!@#')).toBe(true);
        });

        it('should return false for strings with non-ASCII', () => {
          expect(isAscii(CAFE_ACCENT)).toBe(false);
          expect(isAscii('Hello \u2603')).toBe(false); // snowman
        });

        it('should handle empty string', () => {
          expect(isAscii('')).toBe(true);
        });

        it('should throw on null input', () => {
          expect(() => isAscii(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('isPrintableAscii', () => {
        it('should return true for printable ASCII', () => {
          expect(isPrintableAscii('Hello World!')).toBe(true);
          expect(isPrintableAscii('abc123')).toBe(true);
        });

        it('should allow common whitespace', () => {
          expect(isPrintableAscii('Hello\tWorld\n')).toBe(true);
        });

        it('should return false for control characters', () => {
          expect(isPrintableAscii('Hello\x00World')).toBe(false);
          expect(isPrintableAscii('\x07')).toBe(false);
        });

        it('should return false for non-ASCII', () => {
          expect(isPrintableAscii(CAFE_ACCENT)).toBe(false);
        });

        it('should throw on null input', () => {
          expect(() => isPrintableAscii(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('UTF-8 Validation', () => {
      describe('isValidUtf8', () => {
        it('should return true for valid UTF-8', () => {
          const valid = new TextEncoder().encode('Hello ' + CAFE_ACCENT);
          expect(isValidUtf8(valid)).toBe(true);
        });

        it('should return true for ASCII-only', () => {
          const ascii = new Uint8Array([72, 101, 108, 108, 111]);
          expect(isValidUtf8(ascii)).toBe(true);
        });

        it('should return false for invalid continuation bytes', () => {
          const invalid = new Uint8Array([0xC0, 0x00]); // Invalid 2-byte sequence
          expect(isValidUtf8(invalid)).toBe(false);
        });

        it('should return false for truncated sequences', () => {
          const truncated = new Uint8Array([0xE0, 0x80]); // Incomplete 3-byte sequence
          expect(isValidUtf8(truncated)).toBe(false);
        });

        it('should handle empty input', () => {
          expect(isValidUtf8(new Uint8Array(0))).toBe(true);
        });

        it('should throw on null input', () => {
          expect(() => isValidUtf8(null as unknown as Uint8Array)).toThrow(EncodingError);
        });
      });
    });

    describe('BOM Handling', () => {
      describe('removeBOM', () => {
        it('should remove UTF-8 BOM', () => {
          const withBOM = new Uint8Array([0xEF, 0xBB, 0xBF, 72, 105]);
          const result = removeBOM(withBOM);
          expect(result).toEqual(new Uint8Array([72, 105]));
        });

        it('should remove UTF-16 LE BOM', () => {
          const withBOM = new Uint8Array([0xFF, 0xFE, 72, 0]);
          const result = removeBOM(withBOM);
          expect(result).toEqual(new Uint8Array([72, 0]));
        });

        it('should remove UTF-16 BE BOM', () => {
          const withBOM = new Uint8Array([0xFE, 0xFF, 0, 72]);
          const result = removeBOM(withBOM);
          expect(result).toEqual(new Uint8Array([0, 72]));
        });

        it('should not modify bytes without BOM', () => {
          const noBOM = new Uint8Array([72, 105]);
          const result = removeBOM(noBOM);
          expect(result).toEqual(noBOM);
        });

        it('should handle empty input', () => {
          const result = removeBOM(new Uint8Array(0));
          expect(result.length).toBe(0);
        });

        it('should throw on null input', () => {
          expect(() => removeBOM(null as unknown as Uint8Array)).toThrow(EncodingError);
        });
      });

      describe('addUtf8BOM', () => {
        it('should add UTF-8 BOM', () => {
          const bytes = new Uint8Array([72, 105]);
          const result = addUtf8BOM(bytes);
          expect(result.slice(0, 3)).toEqual(new Uint8Array([0xEF, 0xBB, 0xBF]));
          expect(result.slice(3)).toEqual(bytes);
        });

        it('should not add duplicate BOM', () => {
          const withBOM = new Uint8Array([0xEF, 0xBB, 0xBF, 72, 105]);
          const result = addUtf8BOM(withBOM);
          expect(result).toEqual(withBOM);
        });

        it('should handle empty input', () => {
          const result = addUtf8BOM(new Uint8Array(0));
          expect(result).toEqual(new Uint8Array([0xEF, 0xBB, 0xBF]));
        });

        it('should throw on null input', () => {
          expect(() => addUtf8BOM(null as unknown as Uint8Array)).toThrow(EncodingError);
        });
      });
    });

    describe('Line Ending Handling', () => {
      describe('normalizeLineEndings', () => {
        it('should normalize CRLF to LF', () => {
          expect(normalizeLineEndings('a\r\nb\r\nc', 'lf')).toBe('a\nb\nc');
        });

        it('should normalize CR to LF', () => {
          expect(normalizeLineEndings('a\rb\rc', 'lf')).toBe('a\nb\nc');
        });

        it('should convert to CRLF', () => {
          expect(normalizeLineEndings('a\nb\nc', 'crlf')).toBe('a\r\nb\r\nc');
        });

        it('should convert to CR', () => {
          expect(normalizeLineEndings('a\nb\nc', 'cr')).toBe('a\rb\rc');
        });

        it('should handle mixed line endings', () => {
          expect(normalizeLineEndings('a\r\nb\nc\rd', 'lf')).toBe('a\nb\nc\nd');
        });

        it('should handle strings without line endings', () => {
          expect(normalizeLineEndings('hello', 'lf')).toBe('hello');
        });

        it('should throw on invalid format', () => {
          expect(() => normalizeLineEndings('test', 'invalid' as unknown as any)).toThrow(EncodingError);
        });

        it('should throw on null input', () => {
          expect(() => normalizeLineEndings(null as unknown as string, 'lf')).toThrow(EncodingError);
        });
      });

      describe('detectLineEndings', () => {
        it('should detect LF', () => {
          expect(detectLineEndings('a\nb\nc')).toBe('lf');
        });

        it('should detect CRLF', () => {
          expect(detectLineEndings('a\r\nb\r\nc')).toBe('crlf');
        });

        it('should detect CR', () => {
          expect(detectLineEndings('a\rb\rc')).toBe('cr');
        });

        it('should detect mixed line endings', () => {
          expect(detectLineEndings('a\nb\r\nc')).toBe('mixed');
        });

        it('should return none for no line endings', () => {
          expect(detectLineEndings('hello')).toBe('none');
        });

        it('should throw on null input', () => {
          expect(() => detectLineEndings(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('Charset Conversion', () => {
      describe('convertCharset', () => {
        it('should convert UTF-8 bytes to string', () => {
          const bytes = new TextEncoder().encode('Hello');
          const result = convertCharset(bytes, 'utf-8', 'utf-8');
          expect(result).toBe('Hello');
        });

        it('should convert string for ASCII target', () => {
          const result = convertCharset('Hello', 'utf-8', 'ascii');
          expect(result).toBe('Hello');
        });

        it('should throw when ASCII conversion fails', () => {
          expect(() => convertCharset(CAFE_ACCENT, 'utf-8', 'ascii')).toThrow(EncodingError);
        });

        it('should convert to Latin-1', () => {
          const result = convertCharset('Hello', 'utf-8', 'latin1');
          expect(result).toBe('Hello');
        });

        it('should throw on null input', () => {
          expect(() => convertCharset(null as unknown as string, 'utf-8', 'utf-8')).toThrow(EncodingError);
        });
      });
    });

    describe('Byte Length Calculation', () => {
      describe('getByteLength', () => {
        it('should calculate UTF-8 byte length', () => {
          expect(getByteLength('Hello')).toBe(5);
          // cafe with accent: c(1) + a(1) + f(1) + e-acute(2) = 5 bytes
          expect(getByteLength(CAFE_ACCENT)).toBe(5);
        });

        it('should calculate UTF-16 byte length', () => {
          expect(getByteLength('Hello', 'utf-16')).toBe(10);
        });

        it('should calculate ASCII byte length', () => {
          expect(getByteLength('Hello', 'ascii')).toBe(5);
        });

        it('should throw for non-ASCII with ascii charset', () => {
          expect(() => getByteLength(CAFE_ACCENT, 'ascii')).toThrow(EncodingError);
        });

        it('should calculate Latin-1 byte length', () => {
          expect(getByteLength('Hello', 'latin1')).toBe(5);
        });

        it('should throw on unsupported charset', () => {
          expect(() => getByteLength('test', 'invalid' as unknown as any)).toThrow(EncodingError);
        });

        it('should throw on null input', () => {
          expect(() => getByteLength(null as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('Charset Sanitization', () => {
      describe('sanitizeForCharset', () => {
        it('should replace non-ASCII characters for ascii target', () => {
          expect(sanitizeForCharset(CAFE_ACCENT, 'ascii')).toBe('caf?');
        });

        it('should use custom replacement', () => {
          expect(sanitizeForCharset(CAFE_ACCENT, 'ascii', '*')).toBe('caf*');
        });

        it('should keep ASCII characters', () => {
          expect(sanitizeForCharset('Hello', 'ascii')).toBe('Hello');
        });

        it('should handle Latin-1 target', () => {
          expect(sanitizeForCharset('Hello', 'latin1')).toBe('Hello');
        });

        it('should keep UTF-8 characters for UTF-8 target', () => {
          expect(sanitizeForCharset(CAFE_ACCENT, 'utf-8')).toBe(CAFE_ACCENT);
        });

        it('should throw on null input', () => {
          expect(() => sanitizeForCharset(null as unknown as string, 'ascii')).toThrow(EncodingError);
        });

        it('should throw on non-string replacement', () => {
          expect(() => sanitizeForCharset('test', 'ascii', 123 as unknown as string)).toThrow(EncodingError);
        });
      });
    });

    describe('Charset Encoding Check', () => {
      describe('canEncodeAs', () => {
        it('should return true for ASCII-only strings with ascii target', () => {
          expect(canEncodeAs('Hello', 'ascii')).toBe(true);
        });

        it('should return false for non-ASCII with ascii target', () => {
          expect(canEncodeAs(CAFE_ACCENT, 'ascii')).toBe(false);
        });

        it('should return true for Latin-1 compatible strings', () => {
          expect(canEncodeAs('Hello', 'latin1')).toBe(true);
        });

        it('should return true for any string with UTF-8 target', () => {
          expect(canEncodeAs(CAFE_ACCENT, 'utf-8')).toBe(true);
        });

        it('should handle empty string', () => {
          expect(canEncodeAs('', 'ascii')).toBe(true);
        });

        it('should throw on null input', () => {
          expect(() => canEncodeAs(null as unknown as string, 'ascii')).toThrow(EncodingError);
        });
      });
    });

    describe('Code Point Handling', () => {
      describe('getCodePoints', () => {
        it('should return code points for ASCII', () => {
          expect(getCodePoints('ABC')).toEqual([65, 66, 67]);
        });

        it('should return code points for Unicode', () => {
          const points = getCodePoints(CAFE_ACCENT);
          expect(points).toEqual([99, 97, 102, 233]); // c=99, a=97, f=102, e-acute=233
        });

        it('should handle simple characters', () => {
          const points = getCodePoints('A');
          expect(points[0]).toBe(65);
        });

        it('should return empty array for empty string', () => {
          expect(getCodePoints('')).toEqual([]);
        });

        it('should throw on null input', () => {
          expect(() => getCodePoints(null as unknown as string)).toThrow(EncodingError);
        });
      });

      describe('fromCodePoints', () => {
        it('should create string from code points', () => {
          expect(fromCodePoints([65, 66, 67])).toBe('ABC');
        });

        it('should handle Unicode code points', () => {
          expect(fromCodePoints([99, 97, 102, 233])).toBe(CAFE_ACCENT);
        });

        it('should return empty string for empty array', () => {
          expect(fromCodePoints([])).toBe('');
        });

        it('should throw on invalid code point', () => {
          expect(() => fromCodePoints([-1])).toThrow(EncodingError);
        });

        it('should throw on code point exceeding max', () => {
          expect(() => fromCodePoints([0x110000])).toThrow(EncodingError);
        });

        it('should throw on non-integer code point', () => {
          expect(() => fromCodePoints([65.5])).toThrow(EncodingError);
        });

        it('should throw on null input', () => {
          expect(() => fromCodePoints(null as unknown as number[])).toThrow(EncodingError);
        });

        it('should throw on non-array input', () => {
          expect(() => fromCodePoints('test' as unknown as number[])).toThrow(EncodingError);
        });
      });
    });
  });

  describe('Integration Tests', () => {
    it('should roundtrip Base64 encoding/decoding', () => {
      const original = 'Hello, World! Special chars: @#$%^&*()';
      expect(decodeBase64(encodeBase64(original))).toBe(original);
    });

    it('should roundtrip URL-safe Base64 encoding/decoding', () => {
      const original = 'Test with + and / characters';
      expect(decodeBase64Url(encodeBase64Url(original))).toBe(original);
    });

    it('should roundtrip Hex encoding/decoding', () => {
      const original = 'Binary data test';
      expect(decodeHex(encodeHex(original))).toBe(original);
    });

    it('should roundtrip URL encoding/decoding', () => {
      const original = 'hello world?foo=bar&baz=qux';
      expect(decodeURL(encodeURL(original))).toBe(original);
    });

    it('should roundtrip HTML entity encoding/decoding', () => {
      const original = '<script>alert("xss")</script>';
      expect(decodeHTMLEntities(encodeHTMLEntities(original))).toBe(original);
    });

    it('should roundtrip Unicode escape/unescape', () => {
      expect(unescapeUnicode(escapeUnicode(CAFE_ACCENT))).toBe(CAFE_ACCENT);
    });

    it('should roundtrip string/bytes conversion', () => {
      const original = 'Test string with UTF-8: ' + CAFE_ACCENT;
      const bytes = stringToBytes(original, 'utf-8');
      expect(bytesToString(bytes, 'utf-8')).toBe(original);
    });

    it('should roundtrip JSON/CSV conversion', () => {
      const original = [
        { name: 'John', age: '30' },
        { name: 'Jane', age: '25' },
      ];
      const csv = jsonToCsv(original);
      const result = csvToJson(csv);
      expect(result).toEqual(original);
    });

    it('should roundtrip query string conversion', () => {
      const original = { foo: 'bar', baz: 'qux' };
      const qs = jsonToQueryString(original);
      const result = queryStringToJson(qs);
      expect(result).toEqual(original);
    });

    it('should preserve content through BOM operations', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const withBOM = addUtf8BOM(original);
      const withoutBOM = removeBOM(withBOM);
      expect(withoutBOM).toEqual(original);
    });

    it('should preserve content through line ending normalization', () => {
      const original = 'line1\nline2\nline3';
      const crlf = normalizeLineEndings(original, 'crlf');
      const backToLf = normalizeLineEndings(crlf, 'lf');
      expect(backToLf).toBe(original);
    });
  });
});
