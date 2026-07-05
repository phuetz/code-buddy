export type StudioMessageRole = 'user' | 'assistant';

export interface StudioMessage {
  id: string;
  role: StudioMessageRole;
  text: string;
  streaming?: boolean;
}

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface StudioFileChange {
  path: string;
  kind: ChangeKind;
}

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

export interface ChangeSummary {
  added: number;
  modified: number;
  deleted: number;
}

export function summarizeChanges(changes: readonly StudioFileChange[]): ChangeSummary {
  return changes.reduce<ChangeSummary>(
    (summary, change) => {
      summary[change.kind] += 1;
      return summary;
    },
    { added: 0, modified: 0, deleted: 0 },
  );
}

export function deviceWidth(device: PreviewDevice): number {
  switch (device) {
    case 'mobile':
      return 390;
    case 'tablet':
      return 768;
    case 'desktop':
      return 1280;
  }
}

export function lastAssistantMessage(messages: readonly StudioMessage[]): StudioMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return message;
    }
  }

  return undefined;
}
