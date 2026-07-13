import { ipcRenderer } from 'electron';
import type {
  CameraSnapshotInspectionResult,
  CameraSnapshotResult,
  CompanionCard,
  CompanionCardKind,
  CompanionCardStatus,
  CompanionCardStore,
  CompanionCheckInCue,
  CompanionCompetitiveRadar,
  CompanionGatewayAdminExecutionResult,
  CompanionGatewayAdminPlan,
  CompanionGatewayExecutableAdminAction,
  CompanionGatewayFleetDraft,
  CompanionGatewayInbox,
  CompanionGatewayInboxDraft,
  CompanionGatewayLifecycleReport,
  CompanionGatewayMode,
  CompanionGatewayOutboundReplyDraft,
  CompanionGatewayOutboundReplySendResult,
  CompanionGatewayProfile,
  CompanionImprovementCycle,
  CompanionImpulseBrief,
  CompanionMission,
  CompanionMissionBoard,
  CompanionMissionBoardSyncResult,
  CompanionMissionRunResult,
  CompanionMissionStatus,
  CompanionPercept,
  CompanionPerceptModality,
  CompanionPerceptStats,
  CompanionPrivacyExportResult,
  CompanionPrivacyKind,
  CompanionPrivacyPurgeResult,
  CompanionPrivacyReport,
  CompanionSafetyEvent,
  CompanionSafetyEventKind,
  CompanionSafetyEventRisk,
  CompanionSafetyLedgerStats,
  CompanionSelfEvaluation,
  CompanionSetupResponse,
  CompanionSkillCandidate,
  CompanionSkillCandidateStore,
  CompanionSkillCuratorResult,
  CompanionSkillPromotionResult,
  CompanionStatus,
  OpenClawBridgeActionResult,
  OpenClawBridgeStatusResult,
} from '../../renderer/types';

export const companionApi = {
  companion: {
    setup: (input?: {
      projectId?: string;
      forceIdentity?: boolean;
      configureVoice?: boolean;
      configureModel?: boolean;
      language?: string;
      sttProvider?: string;
      ttsProvider?: string;
      ttsVoice?: string;
      model?: string;
      recordSelf?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionSetupResponse; error?: string }> =>
      ipcRenderer.invoke('companion.setup', input),
    status: (
      projectId?: string
    ): Promise<{ ok: boolean; status?: CompanionStatus; error?: string }> =>
      ipcRenderer.invoke('companion.status', projectId),
    recentPercepts: (input?: {
      limit?: number;
      modality?: CompanionPerceptModality;
      projectId?: string;
    }): Promise<{ ok: boolean; items: CompanionPercept[]; error?: string }> =>
      ipcRenderer.invoke('companion.percepts.recent', input),
    perceptStats: (
      projectId?: string
    ): Promise<{ ok: boolean; stats?: CompanionPerceptStats; error?: string }> =>
      ipcRenderer.invoke('companion.percepts.stats', projectId),
    recordSelf: (
      projectId?: string
    ): Promise<{ ok: boolean; percept?: CompanionPercept; error?: string }> =>
      ipcRenderer.invoke('companion.self.record', projectId),
    evaluate: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; evaluation?: CompanionSelfEvaluation; error?: string }> =>
      ipcRenderer.invoke('companion.evaluate', input),
    radar: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; radar?: CompanionCompetitiveRadar; error?: string }> =>
      ipcRenderer.invoke('companion.radar', input),
    improve: (input?: {
      projectId?: string;
      dryRun?: boolean;
      recordSuggestions?: boolean;
      runMission?: boolean;
    }): Promise<{ ok: boolean; cycle?: CompanionImprovementCycle; error?: string }> =>
      ipcRenderer.invoke('companion.improve', input),
    impulses: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; brief?: CompanionImpulseBrief; error?: string }> =>
      ipcRenderer.invoke('companion.impulses', input),
    checkIn: (input?: {
      projectId?: string;
      userText?: string;
      recordPercept?: boolean;
      createCard?: boolean;
      recordSafety?: boolean;
    }): Promise<{ ok: boolean; cue?: CompanionCheckInCue; error?: string }> =>
      ipcRenderer.invoke('companion.checkIn', input),
    syncMissions: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionMissionBoardSyncResult; error?: string }> =>
      ipcRenderer.invoke('companion.missions.sync', input),
    listMissions: (input?: {
      projectId?: string;
      status?: CompanionMissionStatus;
    }): Promise<{
      ok: boolean;
      board?: CompanionMissionBoard;
      items: CompanionMission[];
      error?: string;
    }> => ipcRenderer.invoke('companion.missions.list', input),
    runNextMission: (input?: {
      projectId?: string;
      dryRun?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionMissionRunResult; error?: string }> =>
      ipcRenderer.invoke('companion.missions.runNext', input),
    updateMission: (input: {
      projectId?: string;
      missionId: string;
      status: CompanionMissionStatus;
    }): Promise<{ ok: boolean; mission?: CompanionMission; error?: string }> =>
      ipcRenderer.invoke('companion.missions.update', input),
    recentSafetyEvents: (input?: {
      projectId?: string;
      limit?: number;
      kind?: CompanionSafetyEventKind;
      risk?: CompanionSafetyEventRisk;
    }): Promise<{ ok: boolean; items: CompanionSafetyEvent[]; error?: string }> =>
      ipcRenderer.invoke('companion.safety.recent', input),
    safetyStats: (
      projectId?: string
    ): Promise<{ ok: boolean; stats?: CompanionSafetyLedgerStats; error?: string }> =>
      ipcRenderer.invoke('companion.safety.stats', projectId),
    listCards: (input?: {
      projectId?: string;
      status?: CompanionCardStatus;
      kind?: CompanionCardKind;
      limit?: number;
    }): Promise<{
      ok: boolean;
      store?: CompanionCardStore;
      items: CompanionCard[];
      error?: string;
    }> => ipcRenderer.invoke('companion.cards.list', input),
    updateCard: (input: {
      projectId?: string;
      cardId: string;
      status: CompanionCardStatus;
    }): Promise<{ ok: boolean; card?: CompanionCard; error?: string }> =>
      ipcRenderer.invoke('companion.cards.update', input),
    gatewayProfile: (
      projectId?: string
    ): Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.profile', projectId),
    gatewayLifecycle: (
      projectId?: string
    ): Promise<{ ok: boolean; report?: CompanionGatewayLifecycleReport; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.lifecycle', projectId),
    gatewayAdminPlan: (
      projectId?: string
    ): Promise<{ ok: boolean; plan?: CompanionGatewayAdminPlan; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.adminPlan', projectId),
    executeGatewayAdminAction: (input: {
      projectId?: string;
      action: CompanionGatewayExecutableAdminAction;
      channel: string;
      approvedBy: string;
      liveAdminConfirmed: boolean;
    }): Promise<{ ok: boolean; result?: CompanionGatewayAdminExecutionResult; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.executeAdminAction', input),
    gatewayInbox: (
      projectId?: string
    ): Promise<{ ok: boolean; inbox?: CompanionGatewayInbox; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.inbox', projectId),
    draftGatewayInboxItem: (input: {
      projectId?: string;
      itemId: string;
    }): Promise<{
      ok: boolean;
      draft?: CompanionGatewayInboxDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.draft', input),
    routeGatewayDraftToFleet: (input: {
      projectId?: string;
      itemId: string;
    }): Promise<{
      ok: boolean;
      fleetDraft?: CompanionGatewayFleetDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.fleetDraft', input),
    draftGatewayOutboundReply: (input: {
      projectId?: string;
      itemId: string;
      text: string;
      reviewedBy: string;
    }): Promise<{
      ok: boolean;
      replyDraft?: CompanionGatewayOutboundReplyDraft;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.outboundReplyDraft', input),
    sendGatewayOutboundReply: (input: {
      projectId?: string;
      itemId: string;
      text: string;
      approvedBy: string;
      dryRun?: boolean;
      liveDeliveryConfirmed?: boolean;
    }): Promise<{
      ok: boolean;
      result?: CompanionGatewayOutboundReplySendResult;
      inbox?: CompanionGatewayInbox;
      error?: string;
    }> => ipcRenderer.invoke('companion.gateway.sendOutboundReply', input),
    updateGatewayChannel: (input: {
      projectId?: string;
      channel: string;
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
      recordPercepts?: boolean;
      tags?: string[];
    }): Promise<{ ok: boolean; profile?: CompanionGatewayProfile; error?: string }> =>
      ipcRenderer.invoke('companion.gateway.update', input),
    openClawBridgeStatus: (input?: {
      projectId?: string;
      source?: string;
    }): Promise<OpenClawBridgeStatusResult> =>
      ipcRenderer.invoke('companion.openclaw.status', input),
    previewOpenClawBridgeAttach: (input?: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.attachPreview', input),
    attachOpenClawBridge: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      approvedBy: string;
      liveAttachConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.attach', input),
    listOpenClawBridgePendingNodes: (input?: {
      projectId?: string;
      source?: string;
      approvedBy?: string;
      liveCallConfirmed?: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodesPending', input),
    approveOpenClawBridgePendingNode: (input: {
      projectId?: string;
      source?: string;
      nodeId?: string;
      code?: string;
      approvedBy: string;
      liveCallConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodeApprove', input),
    rejectOpenClawBridgePendingNode: (input: {
      projectId?: string;
      source?: string;
      nodeId?: string;
      code?: string;
      reason?: string;
      approvedBy: string;
      liveCallConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.nodeReject', input),
    draftOpenClawBridgeHandoff: (input: {
      projectId?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      senderId: string;
      senderName?: string;
      text: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.draft', input),
    previewOpenClawBridgeSend: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      text: string;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.sendPreview', input),
    sendOpenClawBridgeResponse: (input: {
      projectId?: string;
      source?: string;
      endpointPath?: string;
      messageId: string;
      channel: string;
      threadId?: string;
      text: string;
      approvedBy: string;
      liveSendConfirmed: boolean;
    }): Promise<OpenClawBridgeActionResult> =>
      ipcRenderer.invoke('companion.openclaw.send', input),
    listSkillCandidates: (
      projectId?: string
    ): Promise<{
      ok: boolean;
      store?: CompanionSkillCandidateStore;
      items: CompanionSkillCandidate[];
      error?: string;
    }> => ipcRenderer.invoke('companion.skills.list', projectId),
    curateSkills: (input?: {
      projectId?: string;
      recordSuggestions?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionSkillCuratorResult; error?: string }> =>
      ipcRenderer.invoke('companion.skills.curate', input),
    promoteSkillCandidate: (input: {
      projectId?: string;
      candidateId: string;
    }): Promise<{ ok: boolean; result?: CompanionSkillPromotionResult; error?: string }> =>
      ipcRenderer.invoke('companion.skills.promote', input),
    dismissSkillCandidate: (input: {
      projectId?: string;
      candidateId: string;
    }): Promise<{ ok: boolean; candidate?: CompanionSkillCandidate; error?: string }> =>
      ipcRenderer.invoke('companion.skills.dismiss', input),
    privacyReport: (
      projectId?: string
    ): Promise<{ ok: boolean; report?: CompanionPrivacyReport; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.report', projectId),
    exportPrivacy: (input?: {
      projectId?: string;
      kinds?: CompanionPrivacyKind[];
    }): Promise<{ ok: boolean; result?: CompanionPrivacyExportResult; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.export', input),
    purgePrivacy: (input?: {
      projectId?: string;
      kinds?: CompanionPrivacyKind[];
      backup?: boolean;
    }): Promise<{ ok: boolean; result?: CompanionPrivacyPurgeResult; error?: string }> =>
      ipcRenderer.invoke('companion.privacy.purge', input),
    cameraStatus: (): Promise<{ ok: boolean; status?: Record<string, unknown>; error?: string }> =>
      ipcRenderer.invoke('companion.camera.status'),
    cameraSnapshot: (input?: {
      outputPath?: string;
      device?: string;
      timeoutMs?: number;
      projectId?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.snapshot', input),
    cameraRendererSnapshot: (input: {
      dataUrl?: string;
      base64?: string;
      mediaType?: string;
      width?: number;
      height?: number;
      mediaPipe?: unknown;
      outputPath?: string;
      projectId?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.rendererSnapshot', input),
    cameraInspect: (input?: {
      imagePath?: string;
      outputPath?: string;
      device?: string;
      timeoutMs?: number;
      projectId?: string;
      includeOcr?: boolean;
      ocrLanguage?: string;
    }): Promise<{ ok: boolean; result?: CameraSnapshotInspectionResult; error?: string }> =>
      ipcRenderer.invoke('companion.camera.inspect', input),
  },
};

export type CompanionApi = typeof companionApi.companion;
