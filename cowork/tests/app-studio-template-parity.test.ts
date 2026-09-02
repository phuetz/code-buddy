import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/core-loader.js', () => ({ loadCoreModule: vi.fn() }));

import { getTemplateEngine, resetTemplateEngine } from '../../src/templates/project-scaffolding.js';
import { STUDIO_TEMPLATES } from '../src/main/studio/scaffold-service.js';
import { DEFAULT_TEMPLATES } from '../src/renderer/components/studio/use-app-studio.js';

const EXPECTED_STUDIO_TEMPLATE_IDS = ['express-api', 'node-cli', 'react-tailwind', 'react-ts'];

afterEach(() => resetTemplateEngine());

describe('App Studio template declarations', () => {
  it('keeps the core engine, main process and renderer fallback in sync', () => {
    const engineIds = getTemplateEngine().getTemplates().map((template) => template.name).sort();
    const mainIds = STUDIO_TEMPLATES.map((template) => template.id).sort();
    const rendererIds = DEFAULT_TEMPLATES.map((template) => template.id).sort();

    expect(engineIds).toEqual(EXPECTED_STUDIO_TEMPLATE_IDS);
    expect(mainIds).toEqual(EXPECTED_STUDIO_TEMPLATE_IDS);
    expect(rendererIds).toEqual(EXPECTED_STUDIO_TEMPLATE_IDS);
  });
});
