export const CHAT_COMPOSER_INSERT_EVENT = 'chat:composer-insert';
export const CHAT_COMPOSER_SUBMIT_EVENT = 'chat:composer-submit';

export interface ChatComposerInsertDetail {
  body: string;
}

export interface ChatComposerSubmitDetail {
  body: string;
  images?: Array<{ base64: string; mediaType: string }>;
}

export function dispatchChatComposerInsert(body: string): boolean {
  if (!body.trim()) return false;

  window.dispatchEvent(
    new CustomEvent<ChatComposerInsertDetail>(CHAT_COMPOSER_INSERT_EVENT, {
      detail: { body },
    })
  );
  return true;
}

export function dispatchChatComposerSubmit(detail: ChatComposerSubmitDetail): boolean {
  if (!detail.body.trim() && !(detail.images && detail.images.length > 0)) return false;
  window.dispatchEvent(
    new CustomEvent<ChatComposerSubmitDetail>(CHAT_COMPOSER_SUBMIT_EVENT, {
      detail,
    }),
  );
  return true;
}
