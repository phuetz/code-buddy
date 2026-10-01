import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Dockerfile version drift', () => {
  it('should match the version in package.json', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const dockerfilePath = path.join(process.cwd(), 'Dockerfile');

    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    const expectedVersion = packageJson.version;

    const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
    const argMatch = dockerfileContent.match(/ARG CODEBUDDY_VERSION=([0-9.]+)/);

    expect(argMatch).not.toBeNull();
    const actualVersion = argMatch![1];

    expect(actualVersion).toBe(expectedVersion);
  });
});
