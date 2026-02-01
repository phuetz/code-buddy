/**
 * Email Module
 *
 * Comprehensive email integration with IMAP, SMTP, and webhook support.
 */

// Types
export type {
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  EmailFlag,
  EmailFolder,
  ImapConfig,
  ImapSearchCriteria,
  ImapFetchOptions,
  SmtpConfig,
  SendMailOptions,
  SendMailResult,
  OAuth2Credentials,
  OAuth2Token,
  GmailConfig,
  GmailLabel,
  GmailThread,
  EmailWebhookConfig,
  EmailWebhookEvent,
  EmailWebhookPayload,
  EmailServiceConfig,
  EmailServiceStats,
  EmailServiceEvents,
} from './types.js';

export {
  DEFAULT_IMAP_CONFIG,
  DEFAULT_SMTP_CONFIG,
  GMAIL_SCOPES,
} from './types.js';

// Client
export {
  parseEmailAddress,
  formatEmailAddress,
  generateMessageId,
  ImapClient,
  SmtpClient,
} from './client.js';

export type {
  ImapClientEvents,
  SmtpClientEvents,
} from './client.js';

// Service
export {
  WebhookManager,
  EmailService,
  getEmailService,
  resetEmailService,
} from './service.js';
