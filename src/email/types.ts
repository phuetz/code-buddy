/**
 * Email Integration Types
 *
 * Type definitions for email operations including IMAP, SMTP, and Gmail API.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content?: Buffer | string;
  contentId?: string;
  encoding?: 'base64' | 'quoted-printable' | '7bit' | '8bit';
}

export interface EmailMessage {
  id: string;
  uid?: number;
  from: EmailAddress[];
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  date: Date;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string | string[]>;
  flags?: EmailFlag[];
  labels?: string[];
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

export type EmailFlag = 'seen' | 'answered' | 'flagged' | 'deleted' | 'draft' | 'recent';

export interface EmailFolder {
  name: string;
  path: string;
  delimiter: string;
  flags?: string[];
  specialUse?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'all';
  totalMessages?: number;
  unseenMessages?: number;
  recentMessages?: number;
}

// ============================================================================
// IMAP Types
// ============================================================================

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  oauth2?: OAuth2Credentials;
  timeout?: number;
  tls?: {
    rejectUnauthorized?: boolean;
    servername?: string;
  };
  debug?: boolean;
}

export const DEFAULT_IMAP_CONFIG: Partial<ImapConfig> = {
  port: 993,
  secure: true,
  timeout: 30000,
};

export interface ImapSearchCriteria {
  all?: boolean;
  seen?: boolean;
  unseen?: boolean;
  flagged?: boolean;
  unflagged?: boolean;
  answered?: boolean;
  unanswered?: boolean;
  deleted?: boolean;
  undeleted?: boolean;
  draft?: boolean;
  undraft?: boolean;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  text?: string;
  before?: Date;
  since?: Date;
  on?: Date;
  sentBefore?: Date;
  sentSince?: Date;
  sentOn?: Date;
  larger?: number;
  smaller?: number;
  uid?: number | number[];
  header?: { name: string; value: string };
  or?: [ImapSearchCriteria, ImapSearchCriteria];
  not?: ImapSearchCriteria;
}

export interface ImapFetchOptions {
  bodies?: boolean | string | string[];
  envelope?: boolean;
  flags?: boolean;
  uid?: boolean;
  size?: boolean;
  structure?: boolean;
  markSeen?: boolean;
}

// ============================================================================
// SMTP Types
// ============================================================================

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  oauth2?: OAuth2Credentials;
  timeout?: number;
  tls?: {
    rejectUnauthorized?: boolean;
    servername?: string;
  };
  pool?: boolean;
  maxConnections?: number;
  rateDelta?: number;
  rateLimit?: number;
  debug?: boolean;
}

export const DEFAULT_SMTP_CONFIG: Partial<SmtpConfig> = {
  port: 587,
  secure: false,
  timeout: 30000,
  pool: false,
};

export interface SendMailOptions {
  from: string | EmailAddress;
  to: string | EmailAddress | Array<string | EmailAddress>;
  cc?: string | EmailAddress | Array<string | EmailAddress>;
  bcc?: string | EmailAddress | Array<string | EmailAddress>;
  replyTo?: string | EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  priority?: 'high' | 'normal' | 'low';
  inReplyTo?: string;
  references?: string | string[];
}

export interface SendMailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  pending: string[];
  response: string;
}

// ============================================================================
// OAuth2 Types
// ============================================================================

export interface OAuth2Credentials {
  type: 'oauth2';
  user: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expires?: number;
  accessUrl?: string;
}

export interface OAuth2Token {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

// ============================================================================
// Gmail Types
// ============================================================================

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  accessToken?: string;
  refreshToken?: string;
}

export const GMAIL_SCOPES = {
  readonly: 'https://www.googleapis.com/auth/gmail.readonly',
  compose: 'https://www.googleapis.com/auth/gmail.compose',
  send: 'https://www.googleapis.com/auth/gmail.send',
  modify: 'https://www.googleapis.com/auth/gmail.modify',
  labels: 'https://www.googleapis.com/auth/gmail.labels',
  full: 'https://mail.google.com/',
};

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

export interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages: EmailMessage[];
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface EmailWebhookConfig {
  url: string;
  secret?: string;
  events: EmailWebhookEvent[];
  retries?: number;
  timeout?: number;
}

export type EmailWebhookEvent =
  | 'message.received'
  | 'message.sent'
  | 'message.deleted'
  | 'message.read'
  | 'message.flagged'
  | 'folder.created'
  | 'folder.deleted';

export interface EmailWebhookPayload {
  event: EmailWebhookEvent;
  timestamp: number;
  data: {
    message?: Partial<EmailMessage>;
    folder?: Partial<EmailFolder>;
    account: string;
  };
  signature?: string;
}

// ============================================================================
// Email Service Types
// ============================================================================

export interface EmailServiceConfig {
  imap?: ImapConfig;
  smtp?: SmtpConfig;
  gmail?: GmailConfig;
  webhooks?: EmailWebhookConfig[];
  pollInterval?: number;
  defaultFolder?: string;
}

export interface EmailServiceStats {
  connected: boolean;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  lastSync?: Date;
  uptime: number;
}

export interface EmailServiceEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'message': (message: EmailMessage) => void;
  'sync': (folder: string, count: number) => void;
  'idle': () => void;
}
