import { QRTool } from '../../src/tools/qr-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Define mocks inside the factory
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      ensureDir: jest.fn(),
      exists: jest.fn(),
      writeFile: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
    }
  }
}));

// Mock child_process
const mockSpawnSync = jest.fn();
jest.mock('child_process', () => ({
  spawnSync: (...args: any[]) => mockSpawnSync(...args)
}));

describe('QRTool', () => {
  let tool: QRTool;
  const mockVfs = UnifiedVfsRouter.Instance as unknown as {
    ensureDir: jest.Mock;
    exists: jest.Mock;
    writeFile: jest.Mock;
    readDirectory: jest.Mock;
    stat: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new QRTool();
  });

  describe('generate', () => {
    it('should generate ASCII QR code', async () => {
      const result = await tool.generate('Hello World', { format: 'ascii' });
      
      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('ascii');
      expect((result.data as any).content).toContain('██'); // Check for block characters
    });

    it('should generate UTF8 QR code', async () => {
      const result = await tool.generate('Hello World', { format: 'utf8' });
      
      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('utf8');
      // UTF8 mode uses different characters like ▀, ▄, █
      expect((result.data as any).content).toMatch(/[▀▄█]/);
    });

    it('should save SVG QR code', async () => {
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.writeFile.mockResolvedValue(undefined);

      const result = await tool.generate('Hello World', { format: 'svg' });
      
      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('svg');
      expect(result.output).toContain('QR Code saved to:');
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });

    it('should return ASCII with warning for PNG format (missing library)', async () => {
      const result = await tool.generate('Hello World', { format: 'png' });
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('QR Code (ASCII)');
      expect(result.output).toContain('install qrcode package');
    });
  });

  describe('decode', () => {
    it('should decode QR code using zbarimg', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'QR-Code:Decoded Text'
      });

      const result = await tool.decode('test.png');
      
      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe('Decoded Text');
      expect((result.data as any).type).toBe('text');
    });

    it('should handle missing image file', async () => {
      mockVfs.exists.mockResolvedValue(false);
      
      const result = await tool.decode('test.png');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Image not found');
    });

    it('should handle zbarimg failure', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Error'
      });

      const result = await tool.decode('test.png');
      
      expect(result.success).toBe(false);
      // It returns generic "No QR code found" or "zbarimg not installed" depending on output/throw
      // In this case, spawnSync didn't throw, but returned non-zero.
      // The implementation throws 'zbarimg failed' if status !== 0
      // Then catches and returns 'zbarimg not installed' message
      expect(result.error).toContain('zbarimg not installed');
    });

    it('should handle no QR code found', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'No barcode found'
      });

      const result = await tool.decode('test.png');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No QR code found');
    });
  });

  describe('Helper Methods', () => {
    it('should generate WiFi QR', async () => {
      const result = await tool.generateWiFi('MyNetwork', 'password123');
      expect(result.success).toBe(true);
      // Data content should contain the wifi string format
      // But generate returns matrixToAscii result which is visual.
      // The output text contains the data string: "QR Code for: WIFI:..."
      expect(result.output).toContain('WIFI:T:WPA;S:MyNetwork;P:password123');
    });

    it('should generate vCard QR', async () => {
      const contact = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com'
      };
      
      const result = await tool.generateVCard(contact);
      expect(result.success).toBe(true);
      expect(result.output).toContain('BEGIN:VCARD');
      expect(result.output).toContain('N:Doe;John');
    });

    it('should generate URL QR', async () => {
      const result = await tool.generateURL('example.com');
      expect(result.success).toBe(true);
      expect(result.output).toContain('https://example.com');
    });
  });

  describe('listQRCodes', () => {
    it('should list generated QR codes', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([
        { name: 'qr_123.svg', isFile: true },
        { name: 'other.txt', isFile: true }
      ]);
      mockVfs.stat.mockResolvedValue({ size: 1024 });

      const result = await tool.listQRCodes();

      expect(result.success).toBe(true);
      expect(result.output).toContain('qr_123.svg');
      expect(result.output).not.toContain('other.txt');
    });

    it('should handle directory not found', async () => {
      mockVfs.exists.mockResolvedValue(false);

      const result = await tool.listQRCodes();

      expect(result.success).toBe(true);
      expect(result.output).toContain('No QR codes generated yet');
    });
  });
});
