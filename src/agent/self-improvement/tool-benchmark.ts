/**
 * Seed behavioural benchmark for self-authored TOOLS. Each scenario describes a
 * small, deterministic capability with VISIBLE cases (shown to the proposer) and
 * HELD-OUT cases (fresh inputs, never shown) — so a tool that hardcodes the
 * visible answers is caught. Curated separately from any proposer.
 *
 * @module agent/self-improvement/tool-benchmark
 */

import type { ToolBenchmarkScenario } from './tool-types.js';

export const SEED_TOOL_SCENARIOS: ToolBenchmarkScenario[] = [
  {
    id: 'slugify',
    capability: 'Slugify the string field `text`: lowercase it, replace runs of spaces with single hyphens, and print the slug.',
    description: 'authored__slugify converts text to a url slug',
    visibleCases: [
      { input: { text: 'Hello World' }, expectedOutput: 'hello-world' },
      { input: { text: 'Foo Bar Baz' }, expectedOutput: 'foo-bar-baz' },
    ],
    heldOutCases: [
      { input: { text: 'The Quick Brown' }, expectedOutput: 'the-quick-brown' },
      { input: { text: 'A B C' }, expectedOutput: 'a-b-c' },
      // Capability says "runs of spaces" — a tool that only replace(' ','-')
      // would otherwise pass G4 on the single-space held-out pairs above.
      { input: { text: 'Hello  World' }, expectedOutput: 'hello-world' },
    ],
  },
  {
    id: 'word-count',
    capability: 'Count the whitespace-separated words in the string field `text` and print the integer count.',
    description: 'authored__word_count counts words',
    visibleCases: [
      { input: { text: 'one two three' }, expectedOutput: '3' },
      { input: { text: 'hello' }, expectedOutput: '1' },
    ],
    heldOutCases: [
      { input: { text: 'a b c d e' }, expectedOutput: '5' },
      { input: { text: 'foo bar' }, expectedOutput: '2' },
    ],
  },
  {
    id: 'sitemap-check',
    capability:
      'Extract all URLs from string `content` (supporting XML <loc> tags and HTML href attributes). For each URL found (preserving appearance order, without duplicates), look up its HTTP status code in object `statuses` (default to 404 if missing). Print each result as `<url>: <code>` separated by newlines.',
    description: 'authored__sitemap_check checks URLs extracted from sitemap XML or HTML against a status map',
    visibleCases: [
      {
        input: {
          content: '<urlset><url><loc>https://example.com/page1</loc></url><url><loc>https://example.com/page2</loc></url></urlset>',
          statuses: {
            'https://example.com/page1': 200,
            'https://example.com/page2': 404,
          },
        },
        expectedOutput: 'https://example.com/page1: 200\nhttps://example.com/page2: 404',
      },
      {
        input: {
          content: '<html><body><a href="https://example.com/home">Home</a><a href="https://example.com/contact">Contact</a></body></html>',
          statuses: {
            'https://example.com/home': 200,
            'https://example.com/contact': 301,
          },
        },
        expectedOutput: 'https://example.com/home: 200\nhttps://example.com/contact: 301',
      },
    ],
    heldOutCases: [
      {
        input: {
          content: '<urlset><url><loc>https://example.com/blog</loc></url><url><loc>https://example.com/api</loc></url></urlset>',
          statuses: {
            'https://example.com/blog': 200,
            'https://example.com/api': 500,
          },
        },
        expectedOutput: 'https://example.com/blog: 200\nhttps://example.com/api: 500',
      },
      {
        input: {
          content: '<html><a href="https://example.com/a">A</a><a href="https://example.com/b">B</a></html>',
          statuses: {
            'https://example.com/a': 200,
          },
        },
        expectedOutput: 'https://example.com/a: 200\nhttps://example.com/b: 404',
      },
      {
        input: {
          content: '<urlset><url><loc>https://example.com/dup</loc></url><url><loc>https://example.com/dup</loc></url></urlset>',
          statuses: {
            'https://example.com/dup': 200,
          },
        },
        expectedOutput: 'https://example.com/dup: 200',
      },
    ],
  },
  {
    id: 'ffmpeg-argv-audit',
    capability:
      'Audit an ffmpeg command line string in `argv`. Identify these 3 defects: ' +
      '1. "stream_loop_without_t": has "-stream_loop -1" but lacks an input duration limit "-t"; ' +
      '2. "duplicate_output": the output filename appears more than once; ' +
      '3. "format_after_output": "-f" appears after the output file declaration. ' +
      'Print the detected defect names sorted alphabetically and separated by comma and space (e.g. "duplicate_output, format_after_output"). If no defect is found, print "ok".',
    description: 'authored__ffmpeg_argv_audit audits an ffmpeg command for common CLI pitfalls',
    visibleCases: [
      {
        input: { argv: 'ffmpeg -stream_loop -1 -i in.mp4 out.mp4' },
        expectedOutput: 'stream_loop_without_t',
      },
      {
        input: { argv: 'ffmpeg -i in.mp4 out.mp4 -f mp4' },
        expectedOutput: 'format_after_output',
      },
      {
        input: { argv: 'ffmpeg -stream_loop -1 -t 10 -i in.mp4 out.mp4' },
        expectedOutput: 'ok',
      },
    ],
    heldOutCases: [
      {
        input: { argv: 'ffmpeg -i in.mp4 out.mp4 out.mp4' },
        expectedOutput: 'duplicate_output',
      },
      {
        input: { argv: 'ffmpeg -stream_loop -1 -i in.mp4 out.mp4 -f mp4' },
        expectedOutput: 'format_after_output, stream_loop_without_t',
      },
      {
        input: { argv: 'ffmpeg -i input.mov -c:v copy output.mov' },
        expectedOutput: 'ok',
      },
    ],
  },
  {
    id: 'orphan-temporaries',
    capability:
      'Inspect a directory file listing in array `entries` (where each entry has `name`: string and `ageMinutes`: number) and find orphan temporary files matching pattern `<target>.tmp.*` where `ageMinutes` is strictly greater than `maxAgeMinutes`. Print matching file names sorted alphabetically, joined by comma and space. If no matching files exist, print "none".',
    description: 'authored__orphan_temporaries detects orphan temporary files older than a given threshold',
    visibleCases: [
      {
        input: {
          entries: [
            { name: 'report.pdf.tmp.1023', ageMinutes: 45 },
            { name: 'video.mp4.tmp.999', ageMinutes: 5 },
            { name: 'data.csv', ageMinutes: 60 },
          ],
          maxAgeMinutes: 30,
        },
        expectedOutput: 'report.pdf.tmp.1023',
      },
      {
        input: {
          entries: [
            { name: 'main.ts', ageMinutes: 120 },
            { name: 'notes.txt.tmp.1', ageMinutes: 10 },
          ],
          maxAgeMinutes: 15,
        },
        expectedOutput: 'none',
      },
    ],
    heldOutCases: [
      {
        input: {
          entries: [
            { name: 'cache.db.tmp.8812', ageMinutes: 75 },
            { name: 'index.html.tmp.4421', ageMinutes: 90 },
            { name: 'style.css.tmp.12', ageMinutes: 2 },
          ],
          maxAgeMinutes: 60,
        },
        expectedOutput: 'cache.db.tmp.8812, index.html.tmp.4421',
      },
      {
        input: {
          entries: [
            { name: 'archive.tar.gz.tmp.old', ageMinutes: 25 },
          ],
          maxAgeMinutes: 20,
        },
        expectedOutput: 'archive.tar.gz.tmp.old',
      },
      {
        input: {
          entries: [
            { name: 'old_file.txt', ageMinutes: 1000 },
          ],
          maxAgeMinutes: 10,
        },
        expectedOutput: 'none',
      },
    ],
  },
];
