import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { STR_REPLACE_EDITOR_TOOL, PATCH_TOOL } from '../../src/codebuddy/tool-definitions/core-tools.js';
import { StrReplaceEditorTool } from '../../src/tools/registry/text-editor-tools.js';

const canonical = { path: 'fixture.ts', old_str: 'const value = 1;\n', new_str: 'const value = 2;\n' };
const schemas = [
  ['core', STR_REPLACE_EDITOR_TOOL.function.parameters],
  ['patch alias', PATCH_TOOL.function.parameters],
  ['registry', new StrReplaceEditorTool().getSchema().parameters],
] as const;

describe('replacement schema matches the literal edit contract', () => {
  for (const [name, schema] of schemas) {
    const validate = new Ajv({ strict: false }).compile(schema);
    it(`${name}: rejects contradictory old-text fields captured on the local model`, () => {
      const args = { ...canonical, old_content: 'another region of the file' };
      expect(new StrReplaceEditorTool().validate(args).valid).toBe(false);
      expect(validate(args)).toBe(false);
    });
    it(`${name}: rejects contradictory replacement fields captured on the local model`, () => {
      const args = { ...canonical, new_content: '\n\n' };
      expect(new StrReplaceEditorTool().validate(args).valid).toBe(false);
      expect(validate(args)).toBe(false);
    });
    it(`${name}: accepts literal multiline edits and empty replacement text`, () => {
      expect(validate(canonical)).toBe(true);
      expect(validate({ ...canonical, new_str: '', replace_all: true })).toBe(true);
    });
  }

  it.each([
    { file_path: 'fixture.ts', old_content: 'before', new_content: 'after' },
    { target_file: 'fixture.ts', find: 'before', replace: 'after' },
    { path: 'fixture.ts', old_string: 'before', new_string: 'after' },
    { path: 'fixture.ts', pattern: 'before', replacement: 'after' },
  ])('keeps legacy runtime aliases compatible: %j', args => {
    expect(new StrReplaceEditorTool().validate(args)).toEqual({ valid: true });
  });
});
