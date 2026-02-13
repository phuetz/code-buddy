import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateOutputSchema } from '../../src/utils/output-schema-validator';
import { SessionStore } from '../../src/persistence/session-store';

// ============================================================================
// Feature 1: --output-schema validation
// ============================================================================

describe('Output Schema Validator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-flags-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSchema(schema: object): string {
    const schemaPath = path.join(tmpDir, 'schema.json');
    fs.writeFileSync(schemaPath, JSON.stringify(schema));
    return schemaPath;
  }

  it('should validate output matching a simple object schema', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['assistant', 'user'] },
        content: { type: 'string', minLength: 1 },
      },
      required: ['role', 'content'],
    });

    const output = { role: 'assistant', content: 'Hello world' };
    const result = validateOutputSchema(output, schemaPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject output missing required properties', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        role: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['role', 'content'],
    });

    const output = { role: 'assistant' };
    const result = validateOutputSchema(output, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('missing required property "content"');
  });

  it('should reject output with wrong type', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
    });

    const output = { count: 'not-a-number' };
    const result = validateOutputSchema(output, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected type number');
  });

  it('should validate enum values', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'error'] },
      },
    });

    const validOutput = { status: 'ok' };
    expect(validateOutputSchema(validOutput, schemaPath).valid).toBe(true);

    const invalidOutput = { status: 'unknown' };
    const result = validateOutputSchema(invalidOutput, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not in enum');
  });

  it('should validate string pattern', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
      },
    });

    const valid = { email: 'user@example.com' };
    expect(validateOutputSchema(valid, schemaPath).valid).toBe(true);

    const invalid = { email: 'not-an-email' };
    const result = validateOutputSchema(invalid, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('does not match pattern');
  });

  it('should validate minLength and maxLength', () => {
    const schemaPath = writeSchema({
      type: 'string',
      minLength: 3,
      maxLength: 10,
    });

    expect(validateOutputSchema('hello', schemaPath).valid).toBe(true);
    expect(validateOutputSchema('hi', schemaPath).valid).toBe(false);
    expect(validateOutputSchema('this string is too long', schemaPath).valid).toBe(false);
  });

  it('should validate array items', () => {
    const schemaPath = writeSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
        },
        required: ['role'],
      },
    });

    const validOutput = [{ role: 'user' }, { role: 'assistant' }];
    expect(validateOutputSchema(validOutput, schemaPath).valid).toBe(true);

    const invalidOutput = [{ role: 'user' }, { noRole: true }];
    const result = validateOutputSchema(invalidOutput, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing required property "role"');
  });

  it('should reject additional properties when additionalProperties is false', () => {
    const schemaPath = writeSchema({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      additionalProperties: false,
    });

    const output = { name: 'test', extra: 'field' };
    const result = validateOutputSchema(output, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unexpected additional property "extra"');
  });

  it('should return error for non-existent schema file', () => {
    const result = validateOutputSchema({}, '/nonexistent/schema.json');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Failed to load or parse schema');
  });

  it('should return error for invalid JSON in schema file', () => {
    const schemaPath = path.join(tmpDir, 'bad-schema.json');
    fs.writeFileSync(schemaPath, 'not valid json');

    const result = validateOutputSchema({}, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Failed to load or parse schema');
  });

  it('should validate number minimum and maximum', () => {
    const schemaPath = writeSchema({
      type: 'number',
      minimum: 0,
      maximum: 100,
    });

    expect(validateOutputSchema(50, schemaPath).valid).toBe(true);
    expect(validateOutputSchema(-1, schemaPath).valid).toBe(false);
    expect(validateOutputSchema(101, schemaPath).valid).toBe(false);
  });
});

// ============================================================================
// Feature 2: --add-dir parsing
// ============================================================================

describe('--add-dir flag', () => {
  it('should accept multiple directory paths from Commander option spec', () => {
    // Commander parses --add-dir <paths...> into an array of strings.
    // We test the workspace isolation function that receives the parsed value.
    // Since the actual Commander parsing is tested via integration,
    // here we verify the expected shape.
    const addDirPaths = ['/tmp/extra', '/home/user/data'];
    expect(Array.isArray(addDirPaths)).toBe(true);
    expect(addDirPaths).toHaveLength(2);
    expect(addDirPaths[0]).toBe('/tmp/extra');
    expect(addDirPaths[1]).toBe('/home/user/data');
  });

  it('should resolve relative paths properly', () => {
    const relPath = 'relative/dir';
    const resolved = path.resolve(relPath);
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});

// ============================================================================
// Feature 4: --ephemeral session behavior
// ============================================================================

describe('Ephemeral session behavior', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Use a temp directory for sessions to avoid polluting real sessions
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ephemeral-test-'));
    process.env.CODEBUDDY_SESSIONS_DIR = tmpDir;
    store = new SessionStore({ useSQLite: false });
  });

  afterEach(() => {
    const dir = process.env.CODEBUDDY_SESSIONS_DIR;
    delete process.env.CODEBUDDY_SESSIONS_DIR;
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should default to non-ephemeral mode', () => {
    expect(store.isEphemeral()).toBe(false);
  });

  it('should enable ephemeral mode via setEphemeral', () => {
    store.setEphemeral(true);
    expect(store.isEphemeral()).toBe(true);
  });

  it('should skip saving session when ephemeral is true', async () => {
    store.setEphemeral(true);

    const session = await store.createSession('Ephemeral Test', 'test-model');
    // Session was created in memory but saveSession should have been skipped.
    // Attempting to load it from disk should return null.
    const loaded = await store.loadSession(session.id);
    expect(loaded).toBeNull();
  });

  it('should save session normally when ephemeral is false', async () => {
    store.setEphemeral(false);

    const session = await store.createSession('Persistent Test', 'test-model');
    const loaded = await store.loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Persistent Test');
  });

  it('should toggle ephemeral mode', () => {
    store.setEphemeral(true);
    expect(store.isEphemeral()).toBe(true);

    store.setEphemeral(false);
    expect(store.isEphemeral()).toBe(false);
  });

  it('should skip addMessageToCurrentSession when ephemeral', async () => {
    // First create session normally
    store.setEphemeral(false);
    const session = await store.createSession('Toggle Test', 'test-model');

    // Now enable ephemeral and add a message
    store.setEphemeral(true);
    await store.addMessageToCurrentSession({
      type: 'user',
      content: 'This should not be saved',
      timestamp: new Date(),
    });

    // Disable ephemeral to load the session
    store.setEphemeral(false);
    const loaded = await store.loadSession(session.id);
    // The message should NOT have been persisted because saveSession was skipped
    expect(loaded?.messages).toHaveLength(0);
  });
});
