import { expect, test } from 'vitest';
import React from 'react';
import { render } from 'ink';
import InkTable from '../../src/ui/components/InkTable.js';
import stringWidth from 'string-width';
import { PassThrough } from 'stream';

test('truncateString with CJK and Emojis', () => {
  const data = [
    { a: '日本語日本語日本語日本語', b: 'x' },
    { a: 'abc', b: 'y' },
    { a: '😀😀😀😀😀😀😀😀😀😀😀😀', b: 'z' },
    { a: '👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦', b: 'w' }
  ];

  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString();
  });

  render(React.createElement(InkTable, { data, maxColumnWidth: 10 }), {
    stdout: stream as unknown as NodeJS.WriteStream,
    debug: true
  });

  const lines = output.split('\n').filter(l => l.trim() !== '');

  // Check border width
  const topBorderWidth = stringWidth(lines[0]);
  expect(topBorderWidth).toBe(18); // fallback border is used

  // Every line should have the same visual width as the top border
  for (const line of lines) {
    expect(stringWidth(line)).toBe(topBorderWidth);
  }

  // Emoji sequences remain whole; no broken surrogate or replacement glyph.
  expect(output).not.toContain('\uFFFD');
  expect(output).toContain('👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦…');
});

test('a narrow column does not split an emoji surrogate pair', () => {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => { output += chunk.toString(); });

  render(React.createElement(InkTable, {
    data: [{ a: '😀😀' }],
    maxColumnWidth: 1,
  }), { stdout: stream as unknown as NodeJS.WriteStream, debug: true });

  const lines = output.split('\n').filter((line) => line.trim() !== '');
  expect(output).not.toContain('\uFFFD');
  expect(new Set(lines.map((line) => stringWidth(line))).size).toBe(1);
});
