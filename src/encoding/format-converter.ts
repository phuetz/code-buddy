/**
 * Format conversion utilities
 * Provides functions for converting between different data formats
 */

import { EncodingError } from './text-encoder.js';

export { EncodingError };

export interface JsonToXmlOptions {
  rootElement?: string;
  indent?: string;
  includeDeclaration?: boolean;
}

export interface XmlToJsonOptions {
  preserveAttributes?: boolean;
  trimText?: boolean;
}

export interface CsvToJsonOptions {
  delimiter?: string;
  hasHeader?: boolean;
  trimValues?: boolean;
}

/**
 * Convert JSON to XML format
 * @param json - JSON object or string to convert
 * @param options - Conversion options
 * @returns XML string
 */
export function jsonToXml(
  json: unknown,
  options: JsonToXmlOptions = {}
): string {
  const { rootElement = 'root', indent = '  ', includeDeclaration = true } = options;

  if (json === null || json === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }

  let obj: unknown;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch {
      throw new EncodingError('Invalid JSON string');
    }
  } else {
    obj = json;
  }

  const escapeXml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const convert = (value: unknown, name: string, level: number): string => {
    const prefix = indent.repeat(level);

    if (value === null || value === undefined) {
      return `${prefix}<${name}/>\n`;
    }

    if (Array.isArray(value)) {
      return value
        .map((item, _index) => convert(item, `item`, level))
        .join('');
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        return `${prefix}<${name}/>\n`;
      }
      const children = entries
        .map(([key, val]) => convert(val, key, level + 1))
        .join('');
      return `${prefix}<${name}>\n${children}${prefix}</${name}>\n`;
    }

    const text = escapeXml(String(value));
    return `${prefix}<${name}>${text}</${name}>\n`;
  };

  let xml = '';
  if (includeDeclaration) {
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  }

  xml += convert(obj, rootElement, 0);
  return xml.trim();
}

/**
 * Convert XML to JSON format
 * @param xml - XML string to convert
 * @param options - Conversion options
 * @returns JSON object
 */
export function xmlToJson(
  xml: string,
  options: XmlToJsonOptions = {}
): Record<string, unknown> {
  const { preserveAttributes = true, trimText = true } = options;

  if (xml === null || xml === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof xml !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = xml.trim();
  if (trimmed === '') {
    throw new EncodingError('Input XML string is empty');
  }

  // Simple XML parser for basic XML structures
  const parseNode = (content: string): Record<string, unknown> | string => {
    // Remove XML declaration
    const noDecl = content.replace(/<\?xml[^?]*\?>/g, '').trim();

    // Match the root element
    const rootMatch = noDecl.match(/^<([a-zA-Z_][\w.-]*)([^>]*)>([\s\S]*)<\/\1>$/);
    if (!rootMatch) {
      // Check for self-closing tag
      const selfClose = noDecl.match(/^<([a-zA-Z_][\w.-]*)([^>]*)\/>$/);
      if (selfClose) {
        const [, tagName, attrs] = selfClose;
        const result: Record<string, unknown> = {};
        if (preserveAttributes && attrs.trim()) {
          result['@attributes'] = parseAttributes(attrs);
        }
        return { [tagName]: result };
      }
      throw new EncodingError('Invalid XML format');
    }

    const [, tagName, attrs, innerContent] = rootMatch;
    const result: Record<string, unknown> = {};

    // Parse attributes
    if (preserveAttributes && attrs.trim()) {
      result['@attributes'] = parseAttributes(attrs);
    }

    // Check for text content vs child elements
    const hasChildElements = /<[a-zA-Z_][\w.-]*/.test(innerContent);

    if (!hasChildElements) {
      const text = trimText ? innerContent.trim() : innerContent;
      if (Object.keys(result).length === 0) {
        return { [tagName]: text };
      }
      result['#text'] = text;
      return { [tagName]: result };
    }

    // Parse child elements
    const children: Record<string, unknown[]> = {};
    const childRegex = /<([a-zA-Z_][\w.-]*)([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let match;

    while ((match = childRegex.exec(innerContent)) !== null) {
      const [, childTag, childAttrs, childContent = ''] = match;
      const childResult = parseChildElement(childTag, childAttrs, childContent, preserveAttributes, trimText);

      if (!children[childTag]) {
        children[childTag] = [];
      }
      children[childTag].push(childResult);
    }

    // Flatten single-element arrays
    for (const [key, values] of Object.entries(children)) {
      result[key] = values.length === 1 ? values[0] : values;
    }

    return { [tagName]: Object.keys(result).length === 0 ? '' : result };
  };

  const parseAttributes = (attrString: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z_][\w.-]*)=["']([^"']*)["']/g;
    let match;
    while ((match = attrRegex.exec(attrString)) !== null) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  };

  const parseChildElement = (
    tag: string,
    attrs: string,
    content: string,
    preserveAttrs: boolean,
    trim: boolean
  ): unknown => {
    const hasChildren = /<[a-zA-Z_][\w.-]*/.test(content);

    if (!hasChildren) {
      const text = trim ? content.trim() : content;
      if (preserveAttrs && attrs.trim()) {
        return { '@attributes': parseAttributes(attrs), '#text': text };
      }
      return text;
    }

    // Recursively parse nested children
    const result: Record<string, unknown> = {};
    if (preserveAttrs && attrs.trim()) {
      result['@attributes'] = parseAttributes(attrs);
    }

    const children: Record<string, unknown[]> = {};
    const childRegex = /<([a-zA-Z_][\w.-]*)([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let match;

    while ((match = childRegex.exec(content)) !== null) {
      const [, childTag, childAttrs, childContent = ''] = match;
      const childResult = parseChildElement(childTag, childAttrs, childContent, preserveAttrs, trim);

      if (!children[childTag]) {
        children[childTag] = [];
      }
      children[childTag].push(childResult);
    }

    for (const [key, values] of Object.entries(children)) {
      result[key] = values.length === 1 ? values[0] : values;
    }

    return result;
  };

  return parseNode(trimmed) as Record<string, unknown>;
}

/**
 * Convert CSV to JSON format
 * @param csv - CSV string to convert
 * @param options - Conversion options
 * @returns Array of JSON objects
 */
export function csvToJson(
  csv: string,
  options: CsvToJsonOptions = {}
): Record<string, string>[] {
  const { delimiter = ',', hasHeader = true, trimValues = true } = options;

  if (csv === null || csv === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof csv !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = csv.trim();
  if (trimmed === '') {
    return [];
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  const parseRow = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"' && (i === 0 || line[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(trimValues ? current.trim() : current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(trimValues ? current.trim() : current);
    return values.map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"'));
  };

  const rows = lines.map(parseRow);

  if (hasHeader) {
    const headers = rows[0];
    const data = rows.slice(1);

    return data.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }

  // Without headers, use numeric keys
  return rows.map(row => {
    const obj: Record<string, string> = {};
    row.forEach((value, index) => {
      obj[`col${index}`] = value;
    });
    return obj;
  });
}

/**
 * Convert JSON to CSV format
 * @param json - Array of JSON objects or JSON string to convert
 * @param options - Conversion options
 * @returns CSV string
 */
export function jsonToCsv(
  json: Record<string, unknown>[] | string,
  options: { delimiter?: string; includeHeader?: boolean } = {}
): string {
  const { delimiter = ',', includeHeader = true } = options;

  if (json === null || json === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }

  let data: Record<string, unknown>[];
  if (typeof json === 'string') {
    try {
      data = JSON.parse(json);
    } catch {
      throw new EncodingError('Invalid JSON string');
    }
  } else {
    data = json;
  }

  if (!Array.isArray(data)) {
    throw new EncodingError('Input must be an array of objects');
  }

  if (data.length === 0) {
    return '';
  }

  // Get all unique keys from all objects
  const headers = [...new Set(data.flatMap(obj => Object.keys(obj)))];

  const escapeValue = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value);
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[] = [];

  if (includeHeader) {
    rows.push(headers.map(escapeValue).join(delimiter));
  }

  for (const obj of data) {
    const row = headers.map(header => escapeValue(obj[header]));
    rows.push(row.join(delimiter));
  }

  return rows.join('\n');
}

/**
 * Convert YAML-like format to JSON
 * Note: This is a simplified parser for basic YAML structures
 * @param yaml - YAML-like string to convert
 * @returns JSON object
 */
export function yamlToJson(yaml: string): Record<string, unknown> {
  if (yaml === null || yaml === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof yaml !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = yaml.trim();
  if (trimmed === '') {
    return {};
  }

  const lines = trimmed.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [{ indent: -1, obj: result }];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, spaces, key, value] = match;
    const indent = spaces.length;
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    // Pop stack until we find parent with smaller indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (trimmedValue === '' || trimmedValue === '|' || trimmedValue === '>') {
      // This is a parent node
      const newObj: Record<string, unknown> = {};
      parent.obj[trimmedKey] = newObj;
      stack.push({ indent, obj: newObj, key: trimmedKey });
    } else if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
      // Inline array
      try {
        parent.obj[trimmedKey] = JSON.parse(trimmedValue);
      } catch {
        parent.obj[trimmedKey] = trimmedValue;
      }
    } else {
      // Simple value
      let parsedValue: unknown = trimmedValue;

      // Remove quotes
      if ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
          (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))) {
        parsedValue = trimmedValue.slice(1, -1);
      } else if (trimmedValue === 'true') {
        parsedValue = true;
      } else if (trimmedValue === 'false') {
        parsedValue = false;
      } else if (trimmedValue === 'null') {
        parsedValue = null;
      } else if (!isNaN(Number(trimmedValue))) {
        parsedValue = Number(trimmedValue);
      }

      parent.obj[trimmedKey] = parsedValue;
    }
  }

  return result;
}

/**
 * Convert JSON to YAML-like format
 * @param json - JSON object or string to convert
 * @param indent - Indentation string (default: 2 spaces)
 * @returns YAML-like string
 */
export function jsonToYaml(json: unknown, indent: string = '  '): string {
  if (json === null || json === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }

  let obj: unknown;
  if (typeof json === 'string') {
    try {
      obj = JSON.parse(json);
    } catch {
      throw new EncodingError('Invalid JSON string');
    }
  } else {
    obj = json;
  }

  const convert = (value: unknown, level: number): string => {
    const prefix = indent.repeat(level);

    if (value === null) {
      return 'null';
    }

    if (value === undefined) {
      return '';
    }

    if (typeof value === 'boolean') {
      return value.toString();
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (typeof value === 'string') {
      if (value.includes('\n') || value.includes(':') || value.includes('#')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }

      const items = value.map((item, _index) => {
        if (typeof item === 'object' && item !== null) {
          const lines = convert(item, level + 1).split('\n');
          return `${prefix}- ${lines[0]}\n${lines.slice(1).map(l => `${prefix}  ${l}`).join('\n')}`;
        }
        return `${prefix}- ${convert(item, level)}`;
      });

      return items.join('\n');
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return '{}';
      }

      const lines = entries.map(([key, val]) => {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          const nested = convert(val, level + 1);
          return `${prefix}${key}:\n${nested}`;
        }
        if (Array.isArray(val)) {
          const nested = convert(val, level + 1);
          return `${prefix}${key}:\n${nested}`;
        }
        return `${prefix}${key}: ${convert(val, level)}`;
      });

      return lines.join('\n');
    }

    return String(value);
  };

  return convert(obj, 0);
}

/**
 * Convert query string to JSON object
 * @param queryString - URL query string (with or without leading ?)
 * @returns JSON object
 */
export function queryStringToJson(queryString: string): Record<string, string | string[]> {
  if (queryString === null || queryString === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof queryString !== 'string') {
    throw new EncodingError('Input must be a string');
  }

  const trimmed = queryString.trim().replace(/^\?/, '');
  if (trimmed === '') {
    return {};
  }

  const result: Record<string, string | string[]> = {};
  const pairs = trimmed.split('&');

  for (const pair of pairs) {
    const [key, value = ''] = pair.split('=').map(decodeURIComponent);

    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert JSON object to query string
 * @param json - JSON object to convert
 * @param includeQuestionMark - Whether to include leading ? (default: false)
 * @returns Query string
 */
export function jsonToQueryString(
  json: Record<string, unknown>,
  includeQuestionMark: boolean = false
): string {
  if (json === null || json === undefined) {
    throw new EncodingError('Input cannot be null or undefined');
  }
  if (typeof json !== 'object' || Array.isArray(json)) {
    throw new EncodingError('Input must be an object');
  }

  const pairs: string[] = [];

  for (const [key, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else if (value !== undefined && value !== null) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  const queryString = pairs.join('&');
  return includeQuestionMark && queryString ? `?${queryString}` : queryString;
}
