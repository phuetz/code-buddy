import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogMock = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: dialogMock,
}));

import { createOfficeExportSaveHandler, registerOfficeExportIpcHandlers } from '../src/main/office-export/office-export-ipc';
import { writeOfficeExport } from '../src/main/office-export/export-office';

vi.mock('../src/main/office-export/export-office', async () => {
  const actual = await vi.importActual<typeof import('../src/main/office-export/export-office')>(
    '../src/main/office-export/export-office'
  );
  return {
    ...actual,
    writeOfficeExport: vi.fn(),
  };
});

describe('officeExport.save IPC', () => {
  const getSession = vi.fn();
  const handler = createOfficeExportSaveHandler({
    getSession,
    getUserDataPath: () => '/tmp/user-data',
    getMainWindow: () => null,
  });

  beforeEach(() => {
    getSession.mockReset();
    dialogMock.showSaveDialog.mockReset();
    vi.mocked(writeOfficeExport).mockReset();
  });

  it('rejects an invalid format', async () => {
    await expect(handler({}, { markdown: '# A', format: 'pdf' })).resolves.toEqual({
      success: false,
      error: 'Format invalide (docx ou pptx)',
    });
  });

  it('rejects empty markdown', async () => {
    await expect(handler({}, { markdown: '  ', format: 'docx' })).resolves.toMatchObject({
      success: false,
      error: 'Aucun contenu à exporter',
    });
  });

  it('proposes the session exports path then writes locally', async () => {
    getSession.mockReturnValue({ title: 'Atelier', cwd: '/tmp/session-cwd' });
    dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/session-cwd/exports/Atelier.docx',
    });
    vi.mocked(writeOfficeExport).mockResolvedValue({
      success: true,
      path: '/tmp/session-cwd/exports/Atelier.docx',
      warnings: [],
      format: 'docx',
      title: 'Atelier',
    });
    const result = await handler({}, {
      markdown: '# Atelier\n\nHello',
      format: 'docx',
      sessionId: 's1',
      title: 'Atelier',
    });
    expect(dialogMock.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '/tmp/session-cwd/exports/Atelier.docx',
      })
    );
    expect(result).toEqual({
      success: true,
      path: '/tmp/session-cwd/exports/Atelier.docx',
      warnings: [],
    });
  });

  it('returns canceled when the dialog is dismissed', async () => {
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(
      handler({}, { markdown: '# A', format: 'pptx' })
    ).resolves.toEqual({ success: false, canceled: true });
    expect(writeOfficeExport).not.toHaveBeenCalled();
  });

  it('registers officeExport.save once', () => {
    const handle = vi.fn();
    registerOfficeExportIpcHandlers({ handle }, {
      getSession: () => null,
      getUserDataPath: () => '/tmp',
    });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0]?.[0]).toBe('officeExport.save');
  });
});
