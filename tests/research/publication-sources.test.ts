import { describe, it, expect } from 'vitest';
import { parseArxivAtom, parseEuropePmc } from '../../src/research/publication-sources.js';

describe('publication-sources — pure parsers (no network)', () => {
  it('parses an arXiv Atom feed', () => {
    const xml = `<?xml version="1.0"?><feed>
      <entry>
        <id>http://arxiv.org/abs/2501.13956v1</id>
        <title>Zep: A Temporal Knowledge Graph Architecture
          for Agent Memory</title>
        <summary>We present Zep, a memory layer service for AI agents.</summary>
      </entry>
      <entry>
        <id>http://arxiv.org/abs/2310.00001v2</id>
        <title>Another paper</title>
        <summary>Second abstract &amp; details.</summary>
      </entry>
    </feed>`;
    const pubs = parseArxivAtom(xml, 5);
    expect(pubs).toHaveLength(2);
    expect(pubs[0]!.id).toBe('arxiv:2501.13956v1');
    expect(pubs[0]!.title).toBe('Zep: A Temporal Knowledge Graph Architecture for Agent Memory'); // whitespace collapsed
    expect(pubs[0]!.source).toBe('arxiv');
    expect(pubs[1]!.abstract).toContain('Second abstract & details'); // entities decoded
  });

  it('respects the limit and skips entries without title/abstract', () => {
    const xml = `<feed>
      <entry><id>http://arxiv.org/abs/1</id><title>Has title</title></entry>
      <entry><id>http://arxiv.org/abs/2</id><title>T2</title><summary>A2</summary></entry>
      <entry><id>http://arxiv.org/abs/3</id><title>T3</title><summary>A3</summary></entry>
    </feed>`;
    expect(parseArxivAtom(xml, 5)).toHaveLength(2); // first has no summary → skipped
    expect(parseArxivAtom(xml, 1)).toHaveLength(1); // limit honoured
  });

  it('parses a Europe PMC JSON response and skips abstract-less records', () => {
    const json = {
      resultList: {
        result: [
          { id: '39000000', source: 'MED', title: 'Metformin trial', abstractText: 'Lowered HbA1c significantly.', doi: '10.1/x' },
          { id: '2', source: 'MED', title: 'No abstract here' },
        ],
      },
    };
    const pubs = parseEuropePmc(json, 5);
    expect(pubs).toHaveLength(1);
    expect(pubs[0]!.id).toBe('MED:39000000');
    expect(pubs[0]!.source).toBe('europepmc');
    expect(pubs[0]!.url).toBe('https://doi.org/10.1/x');
  });

  it('returns [] for an empty/malformed Europe PMC payload', () => {
    expect(parseEuropePmc({}, 5)).toEqual([]);
    expect(parseEuropePmc({ resultList: {} }, 5)).toEqual([]);
  });
});
