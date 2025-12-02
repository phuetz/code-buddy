/**
 * Chat View Provider for VS Code Sidebar
 */

import * as vscode from 'vscode';
import { GrokClient } from '../grok-client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class GrokChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'grok.chatView';

  private _view?: vscode.WebviewView;
  private _messages: ChatMessage[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _grokClient: GrokClient
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleUserMessage(data.message);
          break;
        case 'clearHistory':
          this._messages = [];
          this.updateWebview();
          break;
      }
    });
  }

  /**
   * Send a message programmatically
   */
  public async sendMessage(message: string): Promise<void> {
    await this.handleUserMessage(message);
  }

  /**
   * Handle user message
   */
  private async handleUserMessage(message: string): Promise<void> {
    // Add user message
    this._messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    this.updateWebview();

    try {
      // Get response from Grok
      const messages = this._messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add system prompt
      const systemPrompt = {
        role: 'system' as const,
        content: `You are Grok, an AI coding assistant in VS Code. You help developers with:
- Code explanation and understanding
- Bug fixing and debugging
- Refactoring and optimization
- Test generation
- Best practices and patterns

Be concise but thorough. Use code blocks with language specifiers. Be friendly and helpful.`,
      };

      let response = '';

      // Stream the response
      for await (const chunk of this._grokClient.chatStream([systemPrompt, ...messages])) {
        response += chunk;
        // Update with partial response
        this.updateWebviewWithPartial(response);
      }

      // Add assistant message
      this._messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });
      this.updateWebview();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this._messages.push({
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      });
      this.updateWebview();
    }
  }

  /**
   * Update webview with current messages
   */
  private updateWebview(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateMessages',
        messages: this._messages,
      });
    }
  }

  /**
   * Update webview with partial response (streaming)
   */
  private updateWebviewWithPartial(content: string): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'partialResponse',
        content,
      });
    }
  }

  /**
   * Get HTML for webview
   */
  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grok Chat</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .message {
      margin-bottom: 16px;
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 95%;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-left: auto;
    }
    .message.assistant {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .message code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .input-container {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }
    #messageInput {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    #messageInput:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .header {
      padding: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h3 {
      font-size: 14px;
      font-weight: 600;
    }
    .clear-btn {
      background: transparent;
      color: var(--vscode-foreground);
      padding: 4px 8px;
      font-size: 12px;
    }
    .typing {
      opacity: 0.7;
      font-style: italic;
    }
    .timestamp {
      font-size: 10px;
      opacity: 0.6;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h3>🤖 Grok Chat</h3>
    <button class="clear-btn" onclick="clearHistory()">Clear</button>
  </div>
  <div class="chat-container" id="chatContainer">
    <div class="message assistant">
      <p>Hello! I'm Grok, your AI coding assistant. How can I help you today?</p>
    </div>
  </div>
  <div class="input-container">
    <textarea
      id="messageInput"
      placeholder="Ask Grok anything..."
      rows="1"
      onkeydown="handleKeyDown(event)"
    ></textarea>
    <button onclick="sendMessage()">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chatContainer');
    const messageInput = document.getElementById('messageInput');
    let isStreaming = false;

    function sendMessage() {
      const message = messageInput.value.trim();
      if (!message || isStreaming) return;

      vscode.postMessage({ type: 'sendMessage', message });
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }

    function clearHistory() {
      vscode.postMessage({ type: 'clearHistory' });
    }

    function handleKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    }

    // Auto-resize textarea
    messageInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'updateMessages':
          renderMessages(message.messages);
          isStreaming = false;
          break;
        case 'partialResponse':
          updatePartialResponse(message.content);
          isStreaming = true;
          break;
      }
    });

    function renderMessages(messages) {
      chatContainer.innerHTML = messages.map(msg => \`
        <div class="message \${msg.role}">
          <div>\${formatContent(msg.content)}</div>
          <div class="timestamp">\${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
      \`).join('');
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updatePartialResponse(content) {
      // Find or create streaming message
      let streamingMsg = document.querySelector('.message.streaming');
      if (!streamingMsg) {
        streamingMsg = document.createElement('div');
        streamingMsg.className = 'message assistant streaming';
        chatContainer.appendChild(streamingMsg);
      }
      streamingMsg.innerHTML = formatContent(content) + '<span class="typing">▌</span>';
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function formatContent(content) {
      // Basic markdown formatting
      return content
        .replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code class="language-$1">$2</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\n/g, '<br>');
    }
  </script>
</body>
</html>`;
  }
}
