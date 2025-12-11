/**
 * Tests for ThemeManager
 */

import { ThemeManager } from "../../src/themes/theme-manager";
import { Theme, ThemeColors, AvatarConfig } from "../../src/themes/theme";

describe("ThemeManager", () => {
  let themeManager: ThemeManager;

  beforeEach(() => {
    // Reset singleton for each test
    (ThemeManager as any).instance = undefined;
    themeManager = ThemeManager.getInstance();
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = ThemeManager.getInstance();
      const instance2 = ThemeManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("Built-in Themes", () => {
    it("should have default themes", () => {
      const themes = themeManager.getAvailableThemes();
      expect(themes.length).toBeGreaterThan(0);
    });

    it("should have dark theme", () => {
      const theme = themeManager.getTheme("dark");
      expect(theme).toBeDefined();
      expect(theme?.name).toBe("Dark");
    });

    it("should have neon theme", () => {
      const theme = themeManager.getTheme("neon");
      expect(theme).toBeDefined();
    });

    it("should have matrix theme", () => {
      const theme = themeManager.getTheme("matrix");
      expect(theme).toBeDefined();
    });

    it("should have ocean theme", () => {
      const theme = themeManager.getTheme("ocean");
      expect(theme).toBeDefined();
    });
  });

  describe("Theme Selection", () => {
    it("should get current theme", () => {
      const current = themeManager.getCurrentTheme();
      expect(current).toBeDefined();
      expect(current.id).toBeDefined();
      expect(current.name).toBeDefined();
    });

    it("should set theme by id", () => {
      const result = themeManager.setTheme("dark");
      expect(result).toBe(true);
      expect(themeManager.getCurrentTheme().id).toBe("dark");
    });

    it("should return false for unknown theme", () => {
      const result = themeManager.setTheme("nonexistent-theme");
      expect(result).toBe(false);
    });
  });

  describe("Theme Colors", () => {
    it("should have primary color", () => {
      const theme = themeManager.getCurrentTheme();
      expect(theme.colors.primary).toBeDefined();
    });

    it("should have text color", () => {
      const theme = themeManager.getCurrentTheme();
      expect(theme.colors.text).toBeDefined();
    });

    it("should have error color", () => {
      const theme = themeManager.getCurrentTheme();
      expect(theme.colors.error).toBeDefined();
    });

    it("should have success color", () => {
      const theme = themeManager.getCurrentTheme();
      expect(theme.colors.success).toBeDefined();
    });

    it("should have warning color", () => {
      const theme = themeManager.getCurrentTheme();
      expect(theme.colors.warning).toBeDefined();
    });
  });

  describe("Get Colors and Avatars", () => {
    it("should get effective colors", () => {
      const colors = themeManager.getColors();
      expect(colors.primary).toBeDefined();
      expect(colors.text).toBeDefined();
    });

    it("should get effective avatars", () => {
      const avatars = themeManager.getAvatars();
      expect(avatars.user).toBeDefined();
      expect(avatars.assistant).toBeDefined();
    });
  });

  describe("Custom Colors", () => {
    it("should set custom primary color", () => {
      themeManager.setCustomColor("primary", "#FF0000");
      const colors = themeManager.getColors();
      expect(colors.primary).toBe("#FF0000");
    });

    it("should clear custom colors", () => {
      themeManager.setCustomColor("primary", "#FF0000");
      themeManager.clearCustomColors();

      const theme = themeManager.getCurrentTheme();
      const colors = themeManager.getColors();
      expect(colors.primary).toBe(theme.colors.primary);
    });
  });

  describe("Avatars", () => {
    it("should have user avatar", () => {
      const avatars = themeManager.getAvatars();
      expect(avatars.user).toBeDefined();
    });

    it("should have assistant avatar", () => {
      const avatars = themeManager.getAvatars();
      expect(avatars.assistant).toBeDefined();
    });

    it("should have system avatar", () => {
      const avatars = themeManager.getAvatars();
      expect(avatars.system).toBeDefined();
    });

    it("should set custom avatar", () => {
      themeManager.setCustomAvatar("user", "🚀");
      const avatars = themeManager.getAvatars();
      expect(avatars.user).toBe("🚀");
    });

    it("should clear custom avatars", () => {
      themeManager.setCustomAvatar("user", "🚀");
      themeManager.clearCustomAvatars();

      const theme = themeManager.getCurrentTheme();
      const avatars = themeManager.getAvatars();
      expect(avatars.user).toBe(theme.avatars.user);
    });
  });

  describe("Avatar Presets", () => {
    it("should apply avatar preset", () => {
      const result = themeManager.applyAvatarPreset("minimal");
      expect(result).toBe(true);
    });

    it("should return false for unknown preset", () => {
      const result = themeManager.applyAvatarPreset("nonexistent-preset");
      expect(result).toBe(false);
    });

    it("should list available presets", () => {
      const presets = themeManager.getAvatarPresets();
      expect(presets.length).toBeGreaterThan(0);
    });
  });

  describe("Theme Listing", () => {
    it("should list available themes", () => {
      const themes = themeManager.getAvailableThemes();
      expect(Array.isArray(themes)).toBe(true);
      expect(themes.length).toBeGreaterThan(0);
    });

    it("should include theme ids in listing", () => {
      const themes = themeManager.getAvailableThemes();
      const themeIds = themes.map(t => t.id);
      expect(themeIds).toContain("dark");
      expect(themeIds).toContain("default");
    });
  });

  describe("Theme Export/Import", () => {
    it("should export theme by id", () => {
      const exported = themeManager.exportTheme("dark");
      expect(exported).toBeDefined();
      expect(typeof exported).toBe("string");

      if (exported) {
        // Should be valid JSON
        const parsed = JSON.parse(exported);
        expect(parsed.id).toBe("dark");
        expect(parsed.colors).toBeDefined();
      }
    });

    it("should return null for unknown theme export", () => {
      const exported = themeManager.exportTheme("nonexistent");
      expect(exported).toBeNull();
    });

    it("should import theme from JSON", () => {
      const customTheme: Theme = {
        id: "custom-test",
        name: "Custom Test",
        description: "A test theme",
        isBuiltin: false,
        colors: {
          primary: "#123456",
          secondary: "#654321",
          accent: "#AABBCC",
          text: "#FFFFFF",
          textMuted: "#CCCCCC",
          textDim: "#999999",
          error: "#FF0000",
          warning: "#FFFF00",
          success: "#00FF00",
          info: "#0000FF",
          border: "#333333",
          borderActive: "#555555",
          borderBusy: "#777777",
          userMessage: "#4488FF",
          assistantMessage: "#44FF88",
          toolCall: "#FF8844",
          toolResult: "#8844FF",
          code: "#FFFF88",
          spinner: "#FF44FF",
        },
        avatars: {
          user: "👤",
          assistant: "🤖",
          system: "⚙️",
          tool: "🔧",
        },
      };

      const json = JSON.stringify(customTheme);
      const result = themeManager.importTheme(json);
      // importTheme returns the theme object or null
      expect(result).not.toBeNull();

      const imported = themeManager.getTheme("custom-test");
      expect(imported).toBeDefined();
      expect(imported?.name).toBe("Custom Test");
    });

    it("should reject invalid theme JSON", () => {
      const result = themeManager.importTheme("invalid json");
      expect(result).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty theme id", () => {
      const result = themeManager.setTheme("");
      expect(result).toBe(false);
    });

    it("should handle theme with special characters in search", () => {
      const themes = themeManager.getAvailableThemes();
      // All themes should have valid IDs
      for (const theme of themes) {
        expect(theme.id).toMatch(/^[a-z0-9-]+$/);
      }
    });

    it("should return consistent colors", () => {
      const colors1 = themeManager.getColors();
      const colors2 = themeManager.getColors();
      expect(colors1).toEqual(colors2);
    });
  });
});
