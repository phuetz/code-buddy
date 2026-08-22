import {
  ApprovalRequest,
  RemoteApprovalService,
} from '../../src/security/remote-approval.js';

describe('RemoteApprovalService', () => {
  async function requestAndApprove(service: RemoteApprovalService): Promise<ApprovalRequest> {
    const requested = new Promise<ApprovalRequest>((resolve) => {
      service.once('approval-requested', resolve);
    });
    const decision = service.requestApproval({
      toolName: 'bash',
      summary: 'Run a command',
      timeoutMs: 1_000,
    });

    const request = await requested;
    service.handleResponse(request.id, true);
    await expect(decision).resolves.toBe(true);
    return request;
  }

  it('uses unique, unguessable UUID approval IDs', async () => {
    const service = new RemoteApprovalService();
    const first = await requestAndApprove(service);
    const second = await requestAndApprove(service);

    expect(first.id).toMatch(
      /^approval-[0-9a-f]{10}$/i
    );
    expect(second.id).not.toBe(first.id);
  });
});
