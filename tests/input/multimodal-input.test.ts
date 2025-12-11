/**
 * Tests for Multimodal Input
 */

import {
  MultimodalInputManager,
  getMultimodalInputManager,
  resetMultimodalInputManager,
} from "../../src/input/multimodal-input";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("MultimodalInputManager", () => {
  let manager: MultimodalInputManager;
  let tempDir: string;

  beforeEach(() => {
    resetMultimodalInputManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "multimodal-test-"));
    manager = new MultimodalInputManager({
      tempDir,
      maxImageSize: 10 * 1024 * 1024, // 10MB
      supportedFormats: [".png", ".jpg", ".jpeg", ".gif"],
    });
  });

  afterEach(() => {
    resetMultimodalInputManager();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Initialization", () => {
    it("should detect capabilities", async () => {
      const capabilities = await manager.initialize();

      expect(capabilities).toHaveProperty("screenshotAvailable");
      expect(capabilities).toHaveProperty("clipboardAvailable");
      expect(capabilities).toHaveProperty("ocrAvailable");
      expect(capabilities).toHaveProperty("imageProcessingAvailable");
    });

    it("should cache capabilities", async () => {
      const caps1 = await manager.initialize();
      const caps2 = await manager.initialize();

      expect(caps1).toEqual(caps2);
    });
  });

  describe("Image Loading", () => {
    it("should load image from file", async () => {
      // Create a minimal PNG file (1x1 red pixel)
      const pngData = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
        0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // width: 1
        0x00, 0x00, 0x00, 0x01, // height: 1
        0x08, 0x02, // bit depth: 8, color type: RGB
        0x00, 0x00, 0x00, // compression, filter, interlace
        0x90, 0x77, 0x53, 0xde, // CRC
        0x00, 0x00, 0x00, 0x0c, // IDAT chunk length
        0x49, 0x44, 0x41, 0x54, // IDAT
        0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, // compressed data
        0x01, 0x01, 0x01, 0x00, // some data
        0x18, 0xdd, 0x8d, 0xb4, // CRC (approximate)
        0x00, 0x00, 0x00, 0x00, // IEND chunk length
        0x49, 0x45, 0x4e, 0x44, // IEND
        0xae, 0x42, 0x60, 0x82, // CRC
      ]);

      const testImagePath = path.join(tempDir, "test.png");
      fs.writeFileSync(testImagePath, pngData);

      const image = await manager.loadImageFile(testImagePath);

      expect(image.id).toBeDefined();
      expect(image.source).toBe("file");
      expect(image.mimeType).toBe("image/png");
      expect(image.size).toBeGreaterThan(0);
      expect(image.base64).toBeDefined();
    });

    it("should reject unsupported formats", async () => {
      const testPath = path.join(tempDir, "test.xyz");
      fs.writeFileSync(testPath, "test content");

      await expect(manager.loadImageFile(testPath)).rejects.toThrow(
        "Unsupported format"
      );
    });

    it("should reject files that are too large", async () => {
      const largeManager = new MultimodalInputManager({
        tempDir,
        maxImageSize: 10, // Very small limit
      });

      const testPath = path.join(tempDir, "large.png");
      fs.writeFileSync(testPath, Buffer.alloc(100)); // Larger than limit

      await expect(largeManager.loadImageFile(testPath)).rejects.toThrow(
        "too large"
      );
    });

    it("should reject non-existent files", async () => {
      await expect(
        manager.loadImageFile("/nonexistent/path/image.png")
      ).rejects.toThrow("File not found");
    });
  });

  describe("Image Management", () => {
    it("should store and retrieve images", async () => {
      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      const loaded = await manager.loadImageFile(testPath);
      const retrieved = manager.getImage(loaded.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(loaded.id);
    });

    it("should list all images", async () => {
      const pngData = createMinimalPNG();

      const path1 = path.join(tempDir, "test1.png");
      const path2 = path.join(tempDir, "test2.png");
      fs.writeFileSync(path1, pngData);
      fs.writeFileSync(path2, pngData);

      await manager.loadImageFile(path1);
      await manager.loadImageFile(path2);

      const images = manager.getAllImages();

      expect(images.length).toBe(2);
    });

    it("should remove image", async () => {
      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      const loaded = await manager.loadImageFile(testPath);
      const removed = manager.removeImage(loaded.id);

      expect(removed).toBe(true);
      expect(manager.getImage(loaded.id)).toBeUndefined();
    });

    it("should clear all images", async () => {
      const pngData = createMinimalPNG();

      const path1 = path.join(tempDir, "test1.png");
      const path2 = path.join(tempDir, "test2.png");
      fs.writeFileSync(path1, pngData);
      fs.writeFileSync(path2, pngData);

      await manager.loadImageFile(path1);
      await manager.loadImageFile(path2);

      manager.clearAll();

      expect(manager.getAllImages().length).toBe(0);
    });
  });

  describe("API Preparation", () => {
    it("should prepare image for API", async () => {
      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      const loaded = await manager.loadImageFile(testPath);
      const prepared = await manager.prepareForAPI(loaded.id);

      expect(prepared.base64).toBeDefined();
      expect(prepared.mimeType).toBe("image/png");
    });

    it("should reject missing image ID", async () => {
      await expect(
        manager.prepareForAPI("nonexistent-id")
      ).rejects.toThrow("Image not found");
    });
  });

  describe("Summary Formatting", () => {
    it("should format summary with no images", async () => {
      await manager.initialize();
      const summary = manager.formatSummary();

      expect(summary).toContain("Multimodal Images");
      expect(summary).toContain("No images loaded");
      expect(summary).toContain("Commands");
    });

    it("should format summary with images", async () => {
      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      await manager.loadImageFile(testPath);
      const summary = manager.formatSummary();

      expect(summary).toContain("Loaded: 1 image");
      expect(summary).toContain("Source: file");
    });

    it("should show capabilities in summary", async () => {
      await manager.initialize();
      const summary = manager.formatSummary();

      expect(summary).toContain("Capabilities:");
      expect(summary).toContain("Screenshot:");
      expect(summary).toContain("Clipboard:");
      expect(summary).toContain("OCR:");
    });
  });

  describe("Event Emission", () => {
    it("should emit initialized event", async () => {
      const handler = jest.fn();
      manager.on("initialized", handler);

      await manager.initialize();

      expect(handler).toHaveBeenCalled();
    });

    it("should emit image:loaded event", async () => {
      const handler = jest.fn();
      manager.on("image:loaded", handler);

      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      await manager.loadImageFile(testPath);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "file",
          mimeType: "image/png",
        })
      );
    });

    it("should emit image:removed event", async () => {
      const handler = jest.fn();
      manager.on("image:removed", handler);

      const pngData = createMinimalPNG();
      const testPath = path.join(tempDir, "test.png");
      fs.writeFileSync(testPath, pngData);

      const loaded = await manager.loadImageFile(testPath);
      manager.removeImage(loaded.id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: loaded.id,
        })
      );
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance", () => {
      const instance1 = getMultimodalInputManager();
      const instance2 = getMultimodalInputManager();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton", () => {
      const instance1 = getMultimodalInputManager();
      resetMultimodalInputManager();
      const instance2 = getMultimodalInputManager();

      expect(instance1).not.toBe(instance2);
    });
  });
});

/**
 * Create a minimal valid PNG file
 */
function createMinimalPNG(): Buffer {
  return Buffer.from([
    // PNG signature
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR chunk
    0x00, 0x00, 0x00, 0x0d, // length
    0x49, 0x48, 0x44, 0x52, // type: IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x90, 0x77, 0x53, 0xde, // CRC
    // IDAT chunk
    0x00, 0x00, 0x00, 0x0c,
    0x49, 0x44, 0x41, 0x54,
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
    0x01, 0x01, 0x01, 0x00,
    // IEND chunk
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}
