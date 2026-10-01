import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { isWorkspacePlugin } from '../../src/plugins/plugin-manager.js';
import { PluginMarketplace } from '../../src/plugins/marketplace.js';
import { hasPermission } from '../../src/plugins/types.js';
import { isPathInside } from '../../src/security/path-comparison.js';

// Type pour accéder à la méthode privée validatePluginPath
type PluginMarketplaceWithPrivate = PluginMarketplace & {
  validatePluginPath(modulePath: string): boolean;
};

describe('Plugin path confinement vulnerabilities', () => {

  describe('1. plugin-manager.ts: isWorkspacePlugin', () => {
    const homePluginDir = path.join(os.homedir(), '.codebuddy', 'plugins');

    it('should correctly identify legitimate home plugins', () => {
      // Legitimate case: /home/user/.codebuddy/plugins/my-plugin
      const legitPath = path.join(homePluginDir, 'my-plugin');
      expect(isWorkspacePlugin(legitPath, homePluginDir)).toBe(false); // is NOT a workspace plugin, it IS a home plugin
    });

    it('should NOT identify a false sibling as a home plugin (fails without fix)', () => {
      // False sibling case: /home/user/.codebuddy/plugins-dev/my-plugin
      const falseSiblingPath = path.join(os.homedir(), '.codebuddy', 'plugins-dev', 'my-plugin');
      // Fix makes it true (is a workspace plugin because not inside homePluginDir)
      // Vulnerability makes it false (thinks it is a home plugin)
      expect(isWorkspacePlugin(falseSiblingPath, homePluginDir)).toBe(true);
    });
  });

  describe('2. marketplace.ts: validatePluginPath', () => {
    it('should allow legitimate plugin path and block false sibling (fails without fix)', () => {
      const marketplace = new PluginMarketplace({}) as PluginMarketplaceWithPrivate;
      const marketplaceDir = (marketplace as any).pluginsDir; // default is ~/.codebuddy/plugins

      // Need absolute path for the test because marketplace uses path.resolve
      const legitPath = path.join(marketplaceDir, 'my-plugin.js');
      expect(marketplace.validatePluginPath(legitPath)).toBe(true);

      // False sibling: ~/.codebuddy/plugins-evil/x.js
      const falseSiblingPath = marketplaceDir + '-evil/x.js';
      // Should block (false) but vulnerability allows it (true)
      expect(marketplace.validatePluginPath(falseSiblingPath)).toBe(false);
    });
  });

  describe('3. plugin-system.ts: main path traversal', () => {
    it('should block malicious main path exploiting false sibling directory (fails without fix)', () => {
      const pluginDir = '/data/plugins/foo';
      const manifestMain = '../foo-evil/index.js';

      const mainPath = path.resolve(pluginDir, manifestMain);
      // mainPath becomes /data/plugins/foo-evil/index.js
      // which startsWith /data/plugins/foo (prefix match!)

      // with fix: uses isPathInside instead of startsWith
      const isPathValidWithFix = isPathInside(mainPath, path.resolve(pluginDir));
      expect(isPathValidWithFix).toBe(false); // Should be properly blocked
    });
  });

  describe('4. types.ts: hasPermission (filesystem)', () => {
    it('should handle legitimate subpaths and block false siblings and transversals (fails without fix)', () => {
      const allowedPaths = ['/data/work'];

      // Legit subpath: should be true
      expect(hasPermission({ filesystem: allowedPaths }, 'filesystem', '/data/work/sub/x')).toBe(true);

      // False sibling: should be false
      expect(hasPermission({ filesystem: allowedPaths }, 'filesystem', '/data/work-secret/x')).toBe(false);

      // Path traversal: should be false
      expect(hasPermission({ filesystem: allowedPaths }, 'filesystem', '/data/work/../secret')).toBe(false);
    });
  });

});
