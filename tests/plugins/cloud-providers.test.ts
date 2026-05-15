import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBedrockProvider } from '../../src/plugins/bundled/bedrock-provider.js';
import { createAzureProvider } from '../../src/plugins/bundled/azure-provider.js';
import type { DiscoveredModel } from '../../src/plugins/types.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.subtle for AWS signing
const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
const mockImportKey = vi.fn().mockResolvedValue({});
const mockSign = vi.fn().mockResolvedValue(new ArrayBuffer(32));

vi.stubGlobal('crypto', {
  subtle: {
    digest: mockDigest,
    importKey: mockImportKey,
    sign: mockSign,
  },
});

describe('Cloud Providers', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  describe('AWS Bedrock Provider', () => {
    it('should return null when AWS region env vars are not set', () => {
      delete process.env.AWS_BEDROCK_REGION;
      delete process.env.AWS_REGION;
      const provider = createBedrockProvider();
      expect(provider).toBeNull();
    });

    it('should create provider when AWS_BEDROCK_REGION is set', () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      const provider = createBedrockProvider();
      expect(provider).not.toBeNull();
      expect(provider!.id).toBe('bundled-bedrock');
      expect(provider!.name).toBe('AWS Bedrock');
      expect(provider!.type).toBe('llm');
      expect(provider!.priority).toBe(4);
      expect(provider!.onboarding).toBeDefined();
      expect(provider!.config).toEqual({
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        region: 'us-east-1',
      });
    });

    it('should create provider when AWS_REGION is set (fallback)', () => {
      delete process.env.AWS_BEDROCK_REGION;
      process.env.AWS_REGION = 'eu-west-1';
      const provider = createBedrockProvider();
      expect(provider).not.toBeNull();
      expect(provider!.config?.region).toBe('eu-west-1');
    });

    it('should prefer AWS_BEDROCK_REGION over AWS_REGION', () => {
      process.env.AWS_BEDROCK_REGION = 'us-west-2';
      process.env.AWS_REGION = 'eu-west-1';
      const provider = createBedrockProvider();
      expect(provider).not.toBeNull();
      expect(provider!.config?.region).toBe('us-west-2');
    });

    it('should fail auth when AWS credentials are missing', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      const provider = createBedrockProvider()!;

      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('AWS credentials not found');
    });

    it('should validate auth with AWS credentials', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);
    });

    it('should handle auth failure from Bedrock', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('403');
    });

    it('should handle auth connection error', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should discover models from Bedrock API', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelSummaries: [
            {
              modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
              modelName: 'Claude 3.5 Sonnet v2',
              providerName: 'Anthropic',
              inputModalities: ['TEXT'],
              outputModalities: ['TEXT'],
              modelLifecycle: { status: 'ACTIVE' },
            },
            {
              modelId: 'amazon.titan-text-express-v1',
              modelName: 'Titan Text Express',
              providerName: 'Amazon',
              inputModalities: ['TEXT'],
              outputModalities: ['TEXT'],
              modelLifecycle: { status: 'ACTIVE' },
            },
            {
              modelId: 'stability.stable-diffusion-xl-v1',
              modelName: 'Stable Diffusion XL',
              providerName: 'Stability AI',
              inputModalities: ['TEXT'],
              outputModalities: ['IMAGE'],
              modelLifecycle: { status: 'ACTIVE' },
            },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      // Should filter out image-only model (Stable Diffusion outputs IMAGE, not TEXT)
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
      expect(models[0].contextWindow).toBe(200000);
      expect(models[0].capabilities).toContain('anthropic');

      expect(models[1].id).toBe('amazon.titan-text-express-v1');
      expect(models[1].contextWindow).toBe(8192);
    });

    it('should fall back to known models when API discovery fails', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const models = await provider.onboarding!['discovery.run']!();

      // Should return known models fallback
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id.includes('claude'))).toBe(true);
      expect(models.some(m => m.id.includes('titan'))).toBe(true);
    });

    it('should prefer Claude 3.5 Sonnet in model picker', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      const provider = createBedrockProvider()!;

      const models: DiscoveredModel[] = [
        { id: 'amazon.titan-text-express-v1', name: 'Titan', contextWindow: 8192 },
        { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude', contextWindow: 200000 },
      ];

      const picked = await provider.onboarding!['wizard.modelPicker']!(models);
      expect(picked).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
    });

    it('should initialize and shutdown without error', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      const provider = createBedrockProvider()!;

      await expect(provider.initialize()).resolves.not.toThrow();
      await expect(provider.shutdown!()).resolves.not.toThrow();
    });

    it('should filter out LEGACY models from discovery', async () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      const provider = createBedrockProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelSummaries: [
            {
              modelId: 'anthropic.claude-v1',
              modelName: 'Claude v1',
              providerName: 'Anthropic',
              inputModalities: ['TEXT'],
              outputModalities: ['TEXT'],
              modelLifecycle: { status: 'LEGACY' },
            },
            {
              modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
              modelName: 'Claude 3.5 Sonnet v2',
              providerName: 'Anthropic',
              inputModalities: ['TEXT'],
              outputModalities: ['TEXT'],
              modelLifecycle: { status: 'ACTIVE' },
            },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
    });
  });

  describe('Azure OpenAI Provider', () => {
    it('should return null when AZURE_OPENAI_ENDPOINT is not set', () => {
      delete process.env.AZURE_OPENAI_ENDPOINT;
      const provider = createAzureProvider();
      expect(provider).toBeNull();
    });

    it('should create provider when AZURE_OPENAI_ENDPOINT is set', () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      const provider = createAzureProvider();
      expect(provider).not.toBeNull();
      expect(provider!.id).toBe('bundled-azure-openai');
      expect(provider!.name).toBe('Azure OpenAI');
      expect(provider!.type).toBe('llm');
      expect(provider!.priority).toBe(4);
      expect(provider!.onboarding).toBeDefined();
      expect(provider!.config).toEqual({
        baseUrl: 'https://myresource.openai.azure.com',
        apiVersion: '2024-02-01',
      });
    });

    it('should strip trailing slash from endpoint', () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com/';
      const provider = createAzureProvider();
      expect(provider!.config?.baseUrl).toBe('https://myresource.openai.azure.com');
    });

    it('should use custom API version when set', () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_VERSION = '2024-06-01';
      const provider = createAzureProvider();
      expect(provider!.config?.apiVersion).toBe('2024-06-01');
    });

    it('should fail auth when no credentials are set', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_AD_TOKEN;

      const provider = createAzureProvider()!;
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('credentials not found');
    });

    it('should validate auth with API key', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-api-key-12345';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);

      // Verify the fetch was called with api-key header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/openai/deployments'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-api-key-12345',
          }),
        }),
      );
    });

    it('should validate auth with Azure AD token', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      delete process.env.AZURE_OPENAI_API_KEY;
      process.env.AZURE_OPENAI_AD_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(true);

      // Verify the fetch was called with Bearer token
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/openai/deployments'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer'),
          }),
        }),
      );
    });

    it('should handle auth 401/403 with specific message', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'bad-key';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('authentication failed');
    });

    it('should handle auth connection error', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';

      const provider = createAzureProvider()!;

      mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const result = await provider.onboarding!.auth!();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ENOTFOUND');
    });

    it('should discover deployments from Azure API', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'my-gpt4o',
              model: 'gpt-4o',
              status: 'succeeded',
            },
            {
              id: 'my-gpt35',
              model: 'gpt-35-turbo',
              status: 'succeeded',
            },
            {
              id: 'my-deleted',
              model: 'gpt-4',
              status: 'deleting',
            },
          ],
        }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      // Should filter out deleting deployment
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('my-gpt4o');
      expect(models[0].name).toBe('gpt-4o');
      expect(models[0].contextWindow).toBe(128000);
      expect(models[0].capabilities).toContain('azure');
      expect(models[0].capabilities).toContain('gpt-4o');

      expect(models[1].id).toBe('my-gpt35');
      expect(models[1].contextWindow).toBe(16384);
    });

    it('should fall back to known models when deployment discovery fails', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';

      const provider = createAzureProvider()!;

      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const models = await provider.onboarding!['discovery.run']!();

      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.id === 'gpt-4o')).toBe(true);
      expect(models.some(m => m.id === 'gpt-35-turbo')).toBe(true);
    });

    it('should prefer gpt-4o in model picker', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      const provider = createAzureProvider()!;

      const models: DiscoveredModel[] = [
        { id: 'my-gpt35', name: 'gpt-35-turbo', contextWindow: 16384 },
        { id: 'my-gpt4o', name: 'gpt-4o', contextWindow: 128000 },
      ];

      const picked = await provider.onboarding!['wizard.modelPicker']!(models);
      expect(picked).toBe('my-gpt4o');
    });

    it('should fall back to gpt-4 variant in model picker when gpt-4o unavailable', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      const provider = createAzureProvider()!;

      const models: DiscoveredModel[] = [
        { id: 'my-gpt35', name: 'gpt-35-turbo', contextWindow: 16384 },
        { id: 'my-gpt4', name: 'gpt-4-turbo', contextWindow: 128000 },
      ];

      const picked = await provider.onboarding!['wizard.modelPicker']!(models);
      expect(picked).toBe('my-gpt4');
    });

    it('should initialize and shutdown without error', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      const provider = createAzureProvider()!;

      await expect(provider.initialize()).resolves.not.toThrow();
      await expect(provider.shutdown!()).resolves.not.toThrow();
    });

    it('should use AZURE_OPENAI_DEPLOYMENT env for chat calls', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';
      process.env.AZURE_OPENAI_DEPLOYMENT = 'my-custom-deployment';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Azure!' } }],
        }),
      });

      const result = await provider.chat!([{ role: 'user', content: 'Hi' }]);

      expect(result).toBe('Hello from Azure!');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/deployments/my-custom-deployment/'),
        expect.anything(),
      );
    });

    it('should throw when Azure chat response has no content', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      await expect(provider.chat!([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
        'Azure OpenAI returned empty response content'
      );
    });

    it('should handle empty deployments list', async () => {
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';
      process.env.AZURE_OPENAI_API_KEY = 'test-key';

      const provider = createAzureProvider()!;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const models = await provider.onboarding!['discovery.run']!();

      // Should fall back to known models when no deployments exist
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('Both providers — env gating', () => {
    it('should not activate Bedrock when no AWS env is set', () => {
      delete process.env.AWS_BEDROCK_REGION;
      delete process.env.AWS_REGION;
      expect(createBedrockProvider()).toBeNull();
    });

    it('should not activate Azure when no AZURE env is set', () => {
      delete process.env.AZURE_OPENAI_ENDPOINT;
      expect(createAzureProvider()).toBeNull();
    });

    it('should activate both when both envs are set', () => {
      process.env.AWS_BEDROCK_REGION = 'us-east-1';
      process.env.AZURE_OPENAI_ENDPOINT = 'https://myresource.openai.azure.com';

      const bedrock = createBedrockProvider();
      const azure = createAzureProvider();

      expect(bedrock).not.toBeNull();
      expect(azure).not.toBeNull();
      expect(bedrock!.id).not.toBe(azure!.id);
    });
  });
});
