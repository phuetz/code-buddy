import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: electronMock.invoke,
  },
}));

import { companionApi } from '../src/preload/api/companion';

describe('preload companion API', () => {
  beforeEach(() => {
    electronMock.invoke.mockReset();
    electronMock.invoke.mockResolvedValue({ ok: true });
  });

  it('is composed into the single electronAPI bridge with its inferred renderer type', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8');

    expect(source).toContain("import { companionApi, type CompanionApi } from './api/companion';");
    expect(source).toContain('...companionApi,');
    expect(source).toContain('companion: CompanionApi;');
  });

  it('forwards primitive, object, and argument-free calls without changing their payloads', async () => {
    const missionFilter = { projectId: 'project-1', status: 'open' as const };
    const outboundReply = {
      projectId: 'project-1',
      itemId: 'gateway-item-1',
      text: 'Approved reply',
      approvedBy: 'operator-1',
      liveDeliveryConfirmed: true,
    };

    await companionApi.companion.status('project-1');
    await companionApi.companion.listMissions(missionFilter);
    await companionApi.companion.sendGatewayOutboundReply(outboundReply);
    await companionApi.companion.cameraStatus();

    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      1,
      'companion.status',
      'project-1',
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      2,
      'companion.missions.list',
      missionFilter,
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      3,
      'companion.gateway.sendOutboundReply',
      outboundReply,
    );
    expect(electronMock.invoke).toHaveBeenNthCalledWith(4, 'companion.camera.status');
  });

  it('preserves explicit OpenClaw approval data', async () => {
    const input = {
      projectId: 'project-1',
      messageId: 'message-1',
      channel: 'telegram',
      text: 'Reviewed response',
      approvedBy: 'operator-1',
      liveSendConfirmed: true,
    };

    await companionApi.companion.sendOpenClawBridgeResponse(input);

    expect(electronMock.invoke).toHaveBeenCalledWith('companion.openclaw.send', input);
  });
});
