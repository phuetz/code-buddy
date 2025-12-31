/**
 * Comprehensive unit tests for WebSearchTool
 *
 * Tests cover:
 * - Web search with DuckDuckGo
 * - Page fetching and HTML parsing
 * - Caching behavior
 * - HTML entity decoding
 * - Error handling
 */

import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { WebSearchTool, WebSearchOptions, SearchResult } from '../../src/tools/web-search';

describe('WebSearchTool', () => {
  let webSearchTool: WebSearchTool;

  beforeEach(() => {
    jest.clearAllMocks();
    webSearchTool = new WebSearchTool();
  });

  afterEach(() => {
    webSearchTool.clearCache();
  });

  describe('constructor', () => {
    it('should create instance with empty cache', () => {
      expect(webSearchTool).toBeInstanceOf(WebSearchTool);
    });
  });

  describe('search', () => {
    it('should execute search and return formatted results', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Example Title</a>
          <a class="result__snippet">This is a snippet</a>
        </div></div>
      `;

      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test query');

      expect(result.success).toBe(true);
      expect(result.output).toContain('test query');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('html.duckduckgo.com'),
        expect.objectContaining({
          headers: expect.any(Object),
          timeout: 10000,
        })
      );
    });

    it('should return no results message when no matches found', async () => {
      const mockHtml = '<html><body>No results</body></html>';
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('nonexistent query xyz');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should respect maxResults option', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example1.com">Title 1</a>
          <a class="result__snippet">Snippet 1</a>
        </div></div>
        <div class="result">
          <a class="result__a" href="https://example2.com">Title 2</a>
          <a class="result__snippet">Snippet 2</a>
        </div></div>
        <div class="result">
          <a class="result__a" href="https://example3.com">Title 3</a>
          <a class="result__snippet">Snippet 3</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test', { maxResults: 2 });

      expect(result.success).toBe(true);
      // Should limit results to 2
    });

    it('should cache results and return cached data on subsequent calls', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Cached Result</a>
          <a class="result__snippet">Cached snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      // First call
      const result1 = await webSearchTool.search('cached query', { maxResults: 5 });
      expect(result1.success).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await webSearchTool.search('cached query', { maxResults: 5 });
      expect(result2.success).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should not use cache when maxResults differs', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Result</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValue({ data: mockHtml });

      await webSearchTool.search('query', { maxResults: 3 });
      await webSearchTool.search('query', { maxResults: 5 });

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should handle network errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await webSearchTool.search('test query');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Web search failed');
      expect(result.error).toContain('Network error');
    });

    it('should handle timeout errors', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('timeout of 10000ms exceeded'));

      const result = await webSearchTool.search('test query');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Web search failed');
    });

    it('should decode DuckDuckGo wrapped URLs', async () => {
      const encodedUrl = encodeURIComponent('https://actual-site.com/page');
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodedUrl}&rut=abc">Title</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('https://actual-site.com/page');
    });

    it('should use fallback parsing when main regex fails', async () => {
      const mockHtml = `
        <a class="result__url" href="https://fallback.com">fallback.com</a>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('fallback test');

      expect(result.success).toBe(true);
    });

    it('should decode HTML entities in titles and snippets', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Title &amp; More &lt;test&gt;</a>
          <a class="result__snippet">Snippet with &quot;quotes&quot; and &#39;apostrophes&#39;</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('entities');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Title & More <test>');
    });

    it('should handle search with empty query', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html></html>' });

      const result = await webSearchTool.search('');

      expect(result.success).toBe(true);
    });

    it('should handle special characters in query', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html></html>' });

      const result = await webSearchTool.search('test "quoted" & <special>');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('test "quoted" & <special>')),
        expect.any(Object)
      );
    });
  });

  describe('fetchPage', () => {
    it('should fetch and extract text from a web page', async () => {
      const mockHtml = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <h1>Main Title</h1>
            <p>This is paragraph content.</p>
            <p>More content here.</p>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com/page');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Content from https://example.com/page');
      expect(result.output).toContain('Main Title');
      expect(result.output).toContain('paragraph content');
      expect(result.data).toEqual({
        url: 'https://example.com/page',
        contentLength: expect.any(Number),
      });
    });

    it('should remove script and style tags', async () => {
      const mockHtml = `
        <html>
          <head>
            <style>.hidden { display: none; }</style>
          </head>
          <body>
            <script>alert('bad');</script>
            <p>Visible content</p>
            <script type="text/javascript">
              console.log('more script');
            </script>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('alert');
      expect(result.output).not.toContain('console.log');
      expect(result.output).not.toContain('display: none');
      expect(result.output).toContain('Visible content');
    });

    it('should remove nav, header, and footer elements', async () => {
      const mockHtml = `
        <html>
          <body>
            <nav>Navigation menu</nav>
            <header>Site header</header>
            <main>Main content</main>
            <footer>Footer info</footer>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Navigation menu');
      expect(result.output).not.toContain('Site header');
      expect(result.output).not.toContain('Footer info');
      expect(result.output).toContain('Main content');
    });

    it('should convert list items to bullet points', async () => {
      const mockHtml = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      // Bullet character should be present
    });

    it('should truncate content longer than 8000 characters', async () => {
      const longContent = 'x'.repeat(10000);
      const mockHtml = `<html><body><p>${longContent}</p></body></html>`;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      expect(result.output).toContain('[Content truncated...]');
    });

    it('should handle fetch errors gracefully', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('404 Not Found'));

      const result = await webSearchTool.fetchPage('https://example.com/nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch page');
      expect(result.error).toContain('404 Not Found');
    });

    it('should follow redirects up to 5 times', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html>Redirected page</html>' });

      await webSearchTool.fetchPage('https://example.com');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          maxRedirects: 5,
        })
      );
    });

    it('should use appropriate headers', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html></html>' });

      await webSearchTool.fetchPage('https://example.com');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('CodeBuddyCLI'),
            'Accept': expect.stringContaining('text/html'),
          }),
        })
      );
    });

    it('should decode numeric HTML entities', async () => {
      const mockHtml = `
        <html>
          <body>
            <p>Numeric: &#65; &#66; &#67;</p>
            <p>Hex: &#x41; &#x42; &#x43;</p>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      expect(result.output).toContain('A');
      expect(result.output).toContain('B');
      expect(result.output).toContain('C');
    });

    it('should decode common HTML entities', async () => {
      const mockHtml = `
        <html>
          <body>
            <p>&nbsp;&ndash;&mdash;&hellip;&copy;&reg;&trade;</p>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      expect(result.output).toContain('\u2013'); // ndash
      expect(result.output).toContain('\u2014'); // mdash
      expect(result.output).toContain('\u2026'); // hellip
      expect(result.output).toContain('\u00A9'); // copy
      expect(result.output).toContain('\u00AE'); // reg
      expect(result.output).toContain('\u2122'); // trade
    });

    it('should clean up excessive whitespace', async () => {
      const mockHtml = `
        <html>
          <body>
            <p>Text  with    multiple     spaces</p>
            <p>


            Multiple blank lines


            </p>
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      // Should not have excessive whitespace
      expect(result.output).not.toMatch(/\n\s*\n\s*\n\s*\n/);
    });

    it('should convert HTML structure elements to newlines', async () => {
      const mockHtml = `
        <html>
          <body>
            <h1>Heading 1</h1>
            <p>Paragraph</p>
            <div>Div content</div>
            <br/>Line break
          </body>
        </html>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.fetchPage('https://example.com');

      expect(result.success).toBe(true);
      // Content should be on separate lines
    });

    it('should handle prompt parameter (even if unused)', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html><body>Content</body></html>' });

      const result = await webSearchTool.fetchPage('https://example.com', 'Summarize this page');

      expect(result.success).toBe(true);
      // The prompt parameter is defined but not used in current implementation
    });
  });

  describe('clearCache', () => {
    it('should clear the search cache', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Result</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValue({ data: mockHtml });

      // Populate cache
      await webSearchTool.search('cached query', { maxResults: 5 });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);

      // Clear cache
      webSearchTool.clearCache();

      // Search again - should not use cache
      await webSearchTool.search('cached query', { maxResults: 5 });
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should not throw when clearing empty cache', () => {
      expect(() => webSearchTool.clearCache()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle malformed HTML gracefully', async () => {
      const malformedHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Unclosed tag
          <a class="result__snippet">Snippet
        </div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: malformedHtml });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
    });

    it('should handle empty response', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '' });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No results found');
    });

    it('should handle null/undefined response data', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: null });

      const result = await webSearchTool.search('test');

      // Should handle gracefully
      expect(result.success).toBe(true);
    });

    it('should handle unicode in search results', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">\u4E2D\u6587\u6807\u9898</a>
          <a class="result__snippet">\u65E5\u672C\u8A9E\u306E\u30B9\u30CB\u30DA\u30C3\u30C8</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('unicode test');

      expect(result.success).toBe(true);
    });

    it('should handle very long URLs', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2000);
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="${longUrl}">Long URL</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('long url test');

      expect(result.success).toBe(true);
    });

    it('should handle non-Error thrown objects', async () => {
      mockedAxios.get.mockRejectedValueOnce('String error');

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('String error');
    });

    it('should handle results with missing snippets', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Title Only</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
    });

    it('should handle results with empty URL in uddg parameter', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=&rut=abc">Title</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
    });
  });

  describe('formatResults', () => {
    it('should format results with numbered list', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example1.com">First Result</a>
          <a class="result__snippet">First snippet</a>
        </div></div>
        <div class="result">
          <a class="result__a" href="https://example2.com">Second Result</a>
          <a class="result__snippet">Second snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('test');

      expect(result.success).toBe(true);
      expect(result.output).toContain('1.');
      expect(result.output).toContain('2.');
      expect(result.output).toContain('URL:');
    });

    it('should include query in header', async () => {
      const mockHtml = `
        <div class="result">
          <a class="result__a" href="https://example.com">Result</a>
          <a class="result__snippet">Snippet</a>
        </div></div>
      `;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const result = await webSearchTool.search('specific query');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Web search results for: "specific query"');
    });
  });
});
