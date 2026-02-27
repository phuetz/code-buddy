import * as vscode from 'vscode';
import { CodeBuddyClient } from './api-client';
import type { WebviewMessage } from './types';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codebuddy.chatView';

  private view: vscode.WebviewView | undefined;
  private client: CodeBuddyClient;

  constructor(
    private readonly extensionUri: vscode.Uri,
    client: CodeBuddyClient
  ) {
    this.client = client;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'sendMessage':
          await this.handleSendMessage(message.payload ?? '');
          break;
        case 'clearChat':
          this.client.resetSession();
          break;
        case 'getStatus':
          await this.handleGetStatus();
          break;
      }
    });
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.view) {
      return;
    }
    this.postMessage({ type: 'loading', payload: '' });
    try {
      const response = await this.client.chat(text);
      this.postMessage({ type: 'response', payload: response });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'error', payload: errorMsg });
    }
  }

  private async handleSendMessage(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    await this.sendMessage(text);
  }

  private async handleGetStatus(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      this.postMessage({ type: 'status', payload: JSON.stringify(status) });
    } catch {
      this.postMessage({ type: 'status', payload: JSON.stringify({ status: 'disconnected' }) });
    }
  }

  private postMessage(message: { type: string; payload: string }): void {
    this.view?.webview.postMessage(message);
  }

  private getHtmlContent(_webview: vscode.Webview): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Code Buddy Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .message {
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .message.user {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, transparent);
    }
    .message.error {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .message .role {
      font-weight: bold;
      font-size: 0.85em;
      margin-bottom: 4px;
      opacity: 0.8;
    }
    .message code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 6px 0;
    }
    .message pre code {
      background: none;
      padding: 0;
    }
    .loading {
      opacity: 0.6;
      font-style: italic;
    }
    #input-container {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background);
    }
    #message-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      border-radius: 4px;
      outline: none;
      resize: none;
      min-height: 32px;
      max-height: 120px;
    }
    #message-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    #send-btn {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
      white-space: nowrap;
      align-self: flex-end;
    }
    #send-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      font-size: 0.85em;
    }
    #toolbar button {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: inherit;
      padding: 2px 6px;
    }
    #toolbar button:hover {
      text-decoration: underline;
    }
    #status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    #status-dot.connected { background: #4caf50; }
    #status-dot.disconnected { background: #f44336; }
    #status-dot.checking { background: #ff9800; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span><span id="status-dot" class="checking"></span><span id="status-text">Checking...</span></span>
    <button id="clear-btn" title="Clear chat">Clear</button>
  </div>
  <div id="chat-container"></div>
  <div id="input-container">
    <textarea id="message-input" placeholder="Ask Code Buddy..." rows="1"></textarea>
    <button id="send-btn">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chat-container');
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    let isLoading = false;

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderMarkdown(text) {
      // Basic markdown: code blocks, inline code, bold, italic
      let html = escapeHtml(text);
      // Code blocks
      html = html.replace(/\`\`\`(\\w*)\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
      // Inline code
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // Bold
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Italic
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      return html;
    }

    function addMessage(role, content, isError) {
      const el = document.createElement('div');
      el.className = 'message ' + (isError ? 'error' : role);
      const roleLabel = document.createElement('div');
      roleLabel.className = 'role';
      roleLabel.textContent = role === 'user' ? 'You' : (isError ? 'Error' : 'Code Buddy');
      el.appendChild(roleLabel);
      const body = document.createElement('div');
      body.innerHTML = renderMarkdown(content);
      el.appendChild(body);
      chatContainer.appendChild(el);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function removeLoading() {
      const loader = chatContainer.querySelector('.loading');
      if (loader) loader.remove();
    }

    function setLoading(on) {
      isLoading = on;
      sendBtn.disabled = on;
      if (on) {
        const el = document.createElement('div');
        el.className = 'message assistant loading';
        el.textContent = 'Thinking...';
        chatContainer.appendChild(el);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      } else {
        removeLoading();
      }
    }

    function sendMessage() {
      const text = input.value.trim();
      if (!text || isLoading) return;
      addMessage('user', text);
      input.value = '';
      input.style.height = 'auto';
      vscode.postMessage({ type: 'sendMessage', payload: text });
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    clearBtn.addEventListener('click', () => {
      chatContainer.innerHTML = '';
      vscode.postMessage({ type: 'clearChat' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loading':
          setLoading(true);
          break;
        case 'response':
          setLoading(false);
          addMessage('assistant', msg.payload);
          break;
        case 'error':
          setLoading(false);
          addMessage('assistant', msg.payload, true);
          break;
        case 'status':
          try {
            const s = JSON.parse(msg.payload);
            const connected = s.status === 'ok';
            statusDot.className = 'connected';
            if (!connected) statusDot.className = 'disconnected';
            statusText.textContent = connected ? 'Connected' : 'Disconnected';
          } catch {
            statusDot.className = 'disconnected';
            statusText.textContent = 'Disconnected';
          }
          break;
      }
    });

    // Check status on load
    vscode.postMessage({ type: 'getStatus' });
  </script>
</body>
</html>`;
  }
}
