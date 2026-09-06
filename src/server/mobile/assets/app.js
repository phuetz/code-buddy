/**
 * Code Buddy Mobile PWA - Main Application Logic
 * Vanilla JavaScript, no framework dependencies
 */

// ============================================================================
// State Management
// ============================================================================

const AppState = {
  token: null,
  ws: null,
  isConnected: false,
  isStreaming: false,
  currentAssistant: 'local',
  assistants: [],
  runs: [],
  confirmations: [],
  messages: [],
  status: {},
  deviceLabel: `mobile-${Math.random().toString(36).substr(2, 8)}`
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Screens
  loginScreen: document.getElementById('login-screen'),
  mainScreen: document.getElementById('main-screen'),
  
  // Login
  tokenInput: document.getElementById('token-input'),
  connectBtn: document.getElementById('connect-btn'),
  qrBtn: document.getElementById('qr-btn'),
  qrContainer: document.getElementById('qr-container'),
  qrCode: document.getElementById('qr-code'),
  qrData: document.getElementById('qr-data'),
  closeQrBtn: document.getElementById('close-qr'),
  errorMessage: document.getElementById('error-message'),
  
  // Main App
  currentAssistant: document.getElementById('current-assistant'),
  connectionStatus: document.getElementById('connection-status'),
  logoutBtn: document.getElementById('logout-btn'),
  menuBtn: document.getElementById('menu-btn'),
  
  // Chat
  messages: document.getElementById('messages'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  stopBtn: document.getElementById('stop-btn'),
  
  // Sections
  chatSection: document.getElementById('chat-section'),
  runsSection: document.getElementById('runs-section'),
  statusSection: document.getElementById('status-section'),
  confirmationsSection: document.getElementById('confirmations-section'),
  
  // Navigation
  navItems: document.querySelectorAll('.nav-item'),
  
  // Lists
  runsList: document.getElementById('runs-list'),
  confirmationsList: document.getElementById('confirmations-list'),
  statusInfo: document.getElementById('status-info'),
  confirmationsBadge: document.getElementById('confirmation-badge'),
  
  // Modals
  assistantModal: document.getElementById('assistant-modal'),
  closeAssistantModal: document.getElementById('close-assistant-modal'),
  assistantsList: document.getElementById('assistants-list'),
  confirmationModal: document.getElementById('confirmation-modal'),
  confirmApprove: document.getElementById('confirm-approve'),
  confirmDeny: document.getElementById('confirm-deny'),
  confirmationContent: document.getElementById('confirmation-content'),
  
  // Actions
  refreshRuns: document.getElementById('refresh-runs')
};

// ============================================================================
// WebSocket Management
// ============================================================================

function connectWebSocket() {
  // Determine WebSocket URL based on current location
  let wsUrl;
  if (window.location.protocol === 'https:') {
    wsUrl = `wss://${window.location.host}/ws`;
  } else {
    wsUrl = `ws://${window.location.host}/ws`;
  }
  
  console.log('Connecting to WebSocket:', wsUrl);
  
  const ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    AppState.isConnected = true;
    updateConnectionStatus();
    
    // Authenticate immediately
    authenticateWebSocket(ws);
  };
  
  ws.onclose = (event) => {
    console.log('WebSocket disconnected:', event.code, event.reason);
    AppState.isConnected = false;
    AppState.isStreaming = false;
    updateConnectionStatus();
    
    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      if (!AppState.isConnected) {
        connectWebSocket();
      }
    }, 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    AppState.isConnected = false;
    updateConnectionStatus();
  };
  
  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data, ws);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };
  
  return ws;
}

function authenticateWebSocket(ws) {
  if (!AppState.token || !ws) return;
  
  const authMessage = {
    type: 'authenticate',
    token: AppState.token
  };
  
  ws.send(JSON.stringify(authMessage));
  
  console.log('WebSocket authentication sent');
}

function disconnectWebSocket() {
  if (AppState.ws) {
    AppState.ws.close();
    AppState.ws = null;
    AppState.isConnected = false;
    updateConnectionStatus();
  }
}

function sendChatMessage(message) {
  if (!AppState.ws || !AppState.isConnected || AppState.isStreaming) {
    return Promise.reject(new Error('Not connected or already streaming'));
  }
  
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}`;
    const messageObj = {
      type: 'chat',
      message: message,
      stream: true,
      requestId: requestId
    };
    
    // Add to pending requests
    const pendingRequest = {
      requestId,
      resolve,
      reject,
      timestamp: Date.now()
    };
    
    AppState.isStreaming = true;
    updateSendButton();
    
    try {
      AppState.ws.send(JSON.stringify(messageObj));
      
      // Set timeout for request
      setTimeout(() => {
        const index = AppState.pendingRequests.findIndex(r => r.requestId === requestId);
        if (index !== -1) {
          AppState.pendingRequests[index].reject(new Error('Request timeout'));
          AppState.pendingRequests.splice(index, 1);
        }
        AppState.isStreaming = false;
        updateSendButton();
      }, 60000); // 1 minute timeout
      
    } catch (error) {
      AppState.isStreaming = false;
      updateSendButton();
      reject(error);
    }
  });
}

function stopStreaming() {
  if (!AppState.ws || !AppState.isConnected || !AppState.isStreaming) return;
  
  AppState.isStreaming = false;
  updateSendButton();
  
  const stopMessage = {
    type: 'stop',
    reason: 'user_request'
  };
  
  AppState.ws.send(JSON.stringify(stopMessage));
}

function sendNonStreamingMessage(message, messageType = 'chat') {
  if (!AppState.ws || !AppState.isConnected) {
    return Promise.reject(new Error('Not connected'));
  }
  
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}`;
    const messageObj = {
      type: messageType,
      message: message,
      stream: false,
      requestId: requestId
    };
    
    try {
      AppState.ws.send(JSON.stringify(messageObj));
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// WebSocket Message Handlers
// ============================================================================

const AppStateWithPending = {
  ...AppState,
  pendingRequests: []
};

function handleWebSocketMessage(data, ws) {
  console.log('WebSocket message received:', data.type);
  
  switch (data.type) {
    case 'auth_success':
      handleAuthSuccess(data);
      break;
      
    case 'auth_failed':
      handleAuthFailed(data);
      break;
      
    case 'chat_response':
      handleChatResponse(data);
      break;
      
    case 'chat_stream':
      handleChatStream(data);
      break;
      
    case 'chat_end':
      handleChatEnd(data);
      break;
      
    case 'chat_error':
      handleChatError(data);
      break;
      
    case 'ask_user':
      handleAskUser(data);
      break;
      
    case 'confirmation_required':
      handleConfirmationRequired(data);
      break;
      
    case 'status_update':
      handleStatusUpdate(data);
      break;
      
    case 'agent_message':
      handleAgentMessage(data);
      break;
      
    case 'pong':
      // Heartbeat response
      break;
      
    default:
      console.log('Unhandled WebSocket message type:', data.type);
  }
}

function handleAuthSuccess(data) {
  console.log('Authentication successful');
  AppState.isConnected = true;
  updateConnectionStatus();
  
  // Load initial data
  loadInitialData();
}

function handleAuthFailed(data) {
  console.error('Authentication failed:', data.error);
  AppState.isConnected = false;
  updateConnectionStatus();
  showError(`Échec de l'authentification: ${data.error || 'Token invalide'}`);
}

function handleChatResponse(data) {
  // Complete response received
  if (data.requestId) {
    const index = AppStateWithPending.pendingRequests.findIndex(r => r.requestId === data.requestId);
    if (index !== -1) {
      AppStateWithPending.pendingRequests[index].resolve(data);
      AppStateWithPending.pendingRequests.splice(index, 1);
    }
  }
  
  AppState.isStreaming = false;
  updateSendButton();
  
  if (data.message) {
    addMessage(data.message, 'assistant');
  }
}

function handleChatStream(data) {
  // Stream chunk received
  if (data.delta) {
    // Handle streaming delta
    const lastMessage = AppState.messages[AppState.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
      lastMessage.content += data.delta;
      updateLastMessage(lastMessage);
    } else {
      addMessage(data.delta, 'assistant', true);
    }
  }
}

function handleChatEnd(data) {
  AppState.isStreaming = false;
  updateSendButton();
  
  if (data.requestId) {
    const index = AppStateWithPending.pendingRequests.findIndex(r => r.requestId === data.requestId);
    if (index !== -1) {
      AppStateWithPending.pendingRequests[index].resolve(data);
      AppStateWithPending.pendingRequests.splice(index, 1);
    }
  }
  
  // Mark the last assistant message as complete
  const lastMessage = AppState.messages[AppState.messages.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    lastMessage.streaming = false;
    updateLastMessage(lastMessage);
  }
}

function handleChatError(data) {
  AppState.isStreaming = false;
  updateSendButton();
  
  if (data.requestId) {
    const index = AppStateWithPending.pendingRequests.findIndex(r => r.requestId === data.requestId);
    if (index !== -1) {
      AppStateWithPending.pendingRequests[index].reject(new Error(data.error || 'Chat error'));
      AppStateWithPending.pendingRequests.splice(index, 1);
    }
  }
  
  addMessage(`Erreur: ${data.error || 'Erreur inconnue'}`, 'system');
}

function handleAskUser(data) {
  console.log('User input requested:', data);
  // For now, show in chat
  addMessage(`Question: ${data.question || data.prompt}`, 'system');
}

function handleConfirmationRequired(data) {
  console.log('Confirmation required:', data);
  
  // Store confirmation
  AppState.confirmations.push({
    id: data.id || Date.now().toString(),
    type: data.type,
    title: data.title || 'Confirmation requise',
    message: data.message || data.prompt || '',
    action: data.action,
    timestamp: Date.now()
  });
  
  updateConfirmationsList();
  updateConfirmationsBadge();
  
  // Show notification
  showNotification('Nouvelle confirmation en attente');
}

function handleStatusUpdate(data) {
  console.log('Status update:', data);
  AppState.status = { ...AppState.status, ...data };
  updateStatusInfo();
}

function handleAgentMessage(data) {
  console.log('Agent message:', data);
  // Handle agent-specific messages
  if (data.message) {
    addMessage(data.message, 'assistant');
  }
}

// ============================================================================
// HTTP API Calls
// ============================================================================

async function fetchWithAuth(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AppState.token}`
    }
  };
  
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };
  
  const response = await fetch(endpoint, mergedOptions);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

async function loadInitialData() {
  try {
    // Load status
    await loadStatus();
    
    // Load runs
    await loadRuns();
    
    // Load assistants
    await loadAssistants();
    
    // Load mobile pairing info
    await loadPairingInfo();
    
  } catch (error) {
    console.error('Error loading initial data:', error);
    showError('Erreur lors du chargement des données initiales');
  }
}

async function loadStatus() {
  try {
    const response = await fetchWithAuth('/api/health');
    AppState.status = response;
    updateStatusInfo();
  } catch (error) {
    console.error('Error loading status:', error);
    AppState.status = { error: error.message };
    updateStatusInfo();
  }
}

async function loadRuns() {
  try {
    // Try to get runs from the API
    // Note: /api/runs might not exist, so we'll try /api/sessions as fallback
    let response;
    
    try {
      response = await fetchWithAuth('/api/runs');
    } catch (error) {
      // Fallback to sessions
      response = await fetchWithAuth('/api/sessions');
    }
    
    AppState.runs = response.sessions || response.runs || [];
    updateRunsList();
  } catch (error) {
    console.error('Error loading runs:', error);
    AppState.runs = [];
    updateRunsList();
  }
}

async function loadAssistants() {
  try {
    // Get fleet peers
    const fleetResponse = await fetchWithAuth('/api/fleet/describe');
    
    AppState.assistants = [
      {
        id: 'local',
        name: 'Code Buddy (Local)',
        description: 'Assistant local principal',
        type: 'local',
        icon: '🤖',
        status: 'active'
      },
      {
        id: 'lisa',
        name: 'Lisa',
        description: 'Persona compagnon',
        type: 'persona',
        icon: '💜',
        status: 'active'
      },
      ...(fleetResponse.peers || []).map(peer => ({
        id: `peer-${peer.id}`,
        name: peer.name || peer.id,
        description: peer.description || 'Pair de la flotte',
        type: 'peer',
        icon: '👥',
        status: peer.status || 'unknown'
      }))
    ];
    
    updateAssistantsList();
  } catch (error) {
    console.error('Error loading assistants:', error);
    // Use default assistants
    AppState.assistants = [
      {
        id: 'local',
        name: 'Code Buddy (Local)',
        description: 'Assistant local principal',
        type: 'local',
        icon: '🤖',
        status: 'active'
      },
      {
        id: 'lisa',
        name: 'Lisa',
        description: 'Persona compagnon',
        type: 'persona',
        icon: '💜',
        status: 'active'
      }
    ];
    updateAssistantsList();
  }
}

async function loadPairingInfo() {
  try {
    const response = await fetchWithAuth('/api/mobile/pairing-status');
    console.log('Pairing status:', response);
    // Could update UI with pairing info if needed
  } catch (error) {
    console.log('Could not load pairing info (might be loopback-only):', error.message);
  }
}

// ============================================================================
// UI Updates
// ============================================================================

function updateConnectionStatus() {
  if (AppState.isConnected) {
    elements.connectionStatus.classList.remove('disconnected');
    elements.connectionStatus.classList.add('connected');
    elements.connectionStatus.textContent = '●';
  } else {
    elements.connectionStatus.classList.remove('connected');
    elements.connectionStatus.classList.add('disconnected');
    elements.connectionStatus.textContent = '○';
  }
}

function updateSendButton() {
  if (AppState.isStreaming) {
    elements.sendBtn.classList.add('hidden');
    elements.stopBtn.classList.remove('hidden');
  } else {
    elements.sendBtn.classList.remove('hidden');
    elements.stopBtn.classList.add('hidden');
  }
}

function updateRunsList() {
  if (!AppState.runs || AppState.runs.length === 0) {
    elements.runsList.innerHTML = '<p class="empty-state">Aucun run trouvé</p>';
    return;
  }
  
  let html = '';
  AppState.runs.forEach(run => {
    const runId = run.id || run.sessionId || 'unknown';
    const title = run.name || run.title || `Run ${runId.substring(0, 8)}`;
    const status = run.status || 'unknown';
    const createdAt = run.createdAt || run.startedAt || run.timestamp;
    
    const date = createdAt ? new Date(createdAt).toLocaleString() : 'Inconnu';
    
    html += `
      <div class="run-item" data-run-id="${runId}">
        <div class="run-header">
          <div>
            <div class="run-title">${escapeHtml(title)}</div>
            <div class="run-id">${escapeHtml(runId)}</div>
          </div>
          <span class="run-status ${status === 'error' || status === 'failed' ? 'error' : ''}">${escapeHtml(status)}</span>
        </div>
        <div class="run-meta">
          <span>${date}</span>
        </div>
      </div>
    `;
  });
  
  elements.runsList.innerHTML = html;
  
  // Add click handlers
  document.querySelectorAll('.run-item').forEach(item => {
    item.addEventListener('click', () => {
      const runId = item.dataset.runId;
      viewRunTrajectory(runId);
    });
  });
}

function updateAssistantsList() {
  let html = '';
  AppState.assistants.forEach(assistant => {
    const isActive = AppState.currentAssistant === assistant.id;
    
    html += `
      <div class="assistant-item ${isActive ? 'active' : ''}" data-assistant-id="${assistant.id}">
        <div class="assistant-icon">${assistant.icon || '🤖'}</div>
        <div class="assistant-info">
          <div class="assistant-name">${escapeHtml(assistant.name)}</div>
          <div class="assistant-desc">${escapeHtml(assistant.description)}</div>
        </div>
        <span class="assistant-status">${escapeHtml(assistant.status)}</span>
      </div>
    `;
  });
  
  elements.assistantsList.innerHTML = html;
  
  // Add click handlers
  document.querySelectorAll('.assistant-item').forEach(item => {
    item.addEventListener('click', () => {
      const assistantId = item.dataset.assistantId;
      selectAssistant(assistantId);
    });
  });
}

function updateStatusInfo() {
  let html = '';
  
  // Server health
  html += `
    <div class="status-card">
      <h4>Santé Serveur</h4>
      <div class="status-value ${AppState.status.error ? 'error' : 'success'}">
        ${AppState.status.error ? '❌ Erreur' : '✅ En ligne'}
      </div>
    </div>
  `;
  
  // Add more status info as available
  if (AppState.status.version) {
    html += `
      <div class="status-card">
        <h4>Version</h4>
        <div class="status-value">${escapeHtml(AppState.status.version)}</div>
      </div>
    `;
  }
  
  if (AppState.status.uptime) {
    html += `
      <div class="status-card">
        <h4>Uptime</h4>
        <div class="status-value">${formatUptime(AppState.status.uptime)}</div>
      </div>
    `;
  }
  
  // Current model/provider
  html += `
    <div class="status-card">
      <h4>Fournisseur</h4>
      <div class="status-value">À déterminer</div>
    </div>
  `;
  
  // Fleet status
  html += `
    <div class="status-card">
      <h4>Flotte</h4>
      <div class="status-value">${AppState.assistants.filter(a => a.type === 'peer').length} pairs connectés</div>
    </div>
  `;
  
  elements.statusInfo.innerHTML = html;
}

function updateConfirmationsList() {
  if (!AppState.confirmations || AppState.confirmations.length === 0) {
    elements.confirmationsList.innerHTML = '<p class="empty-state">Aucune confirmation en attente</p>';
    return;
  }
  
  let html = '';
  AppState.confirmations.forEach(confirmation => {
    html += `
      <div class="confirmation-item" data-confirmation-id="${confirmation.id}">
        <div class="confirmation-header">
          <span class="confirmation-title">${escapeHtml(confirmation.title)}</span>
          <span class="confirmation-type">${escapeHtml(confirmation.type)}</span>
        </div>
        <div class="confirmation-details">${escapeHtml(confirmation.message)}</div>
      </div>
    `;
  });
  
  elements.confirmationsList.innerHTML = html;
  
  // Add click handlers
  document.querySelectorAll('.confirmation-item').forEach(item => {
    item.addEventListener('click', () => {
      const confirmationId = item.dataset.confirmationId;
      showConfirmationModal(confirmationId);
    });
  });
}

function updateConfirmationsBadge() {
  const count = AppState.confirmations.length;
  if (count > 0) {
    elements.confirmationsBadge.textContent = count;
    elements.confirmationsBadge.classList.remove('hidden');
  } else {
    elements.confirmationsBadge.classList.add('hidden');
  }
}

// ============================================================================
// Message Management
// ============================================================================

function addMessage(content, role = 'user', streaming = false) {
  const message = {
    id: Date.now().toString(),
    role: role,
    content: content,
    timestamp: Date.now(),
    streaming: streaming
  };
  
  AppState.messages.push(message);
  renderMessage(message);
  
  // Scroll to bottom
  setTimeout(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }, 50);
}

function updateLastMessage(message) {
  const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
  if (messageElement) {
    const contentElement = messageElement.querySelector('.message-content');
    if (contentElement) {
      contentElement.innerHTML = formatMessageContent(message.content);
    }
  }
  
  // Scroll to bottom
  setTimeout(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }, 50);
}

function renderMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${message.role}`;
  messageElement.dataset.messageId = message.id;
  
  const contentHtml = formatMessageContent(message.content);
  
  let html = '';
  
  if (message.role === 'system') {
    html = `<div class="message-content">${contentHtml}</div>`;
  } else {
    html = `<div class="message-content">${contentHtml}</div>`;
    
    // Add copy button for code blocks
    if (message.content.includes('```') || message.content.includes('`')) {
      html += '<button class="copy-btn" onclick="copyMessageContent(this)">Copier</button>';
    }
  }
  
  // Add streaming indicator
  if (message.streaming) {
    html += '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  }
  
  messageElement.innerHTML = html;
  elements.messages.appendChild(messageElement);
}

function formatMessageContent(content) {
  // Basic markdown formatting
  let formatted = content;
  
  // Escape HTML first
  formatted = escapeHtml(formatted);
  
  // Code blocks
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // Italic
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // Line breaks
  formatted = formatted.replace(/\n/g, '<br>');
  
  return formatted;
}

function copyMessageContent(button) {
  const messageElement = button.parentElement;
  const content = messageElement.querySelector('.message-content').textContent;
  
  navigator.clipboard.writeText(content).then(() => {
    button.textContent = 'Copié!';
    setTimeout(() => {
      button.textContent = 'Copier';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// ============================================================================
// Navigation
// ============================================================================

function switchSection(sectionId) {
  // Update nav items
  elements.navItems.forEach(item => {
    item.classList.remove('active');
    if (item.dataset.section === sectionId) {
      item.classList.add('active');
    }
  });
  
  // Update sections
  document.querySelectorAll('.section').forEach(section => {
    section.classList.remove('active');
  });
  
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
  }
  
  // Scroll to top of main content
  elements.mainContent.scrollTop = 0;
}

// ============================================================================
// Modals
// ============================================================================

function showAssistantModal() {
  elements.assistantModal.classList.remove('hidden');
}

function hideAssistantModal() {
  elements.assistantModal.classList.add('hidden');
}

function selectAssistant(assistantId) {
  AppState.currentAssistant = assistantId;
  const assistant = AppState.assistants.find(a => a.id === assistantId);
  if (assistant) {
    elements.currentAssistant.textContent = assistant.name;
  }
  hideAssistantModal();
  switchSection('chat-section');
}

function showConfirmationModal(confirmationId) {
  const confirmation = AppState.confirmations.find(c => c.id === confirmationId);
  if (!confirmation) return;
  
  elements.confirmationContent.innerHTML = `
    <div class="confirmation-item">
      <div class="confirmation-header">
        <span class="confirmation-title">${escapeHtml(confirmation.title)}</span>
        <span class="confirmation-type">${escapeHtml(confirmation.type)}</span>
      </div>
      <div class="confirmation-details">${escapeHtml(confirmation.message)}</div>
    </div>
  `;
  
  // Store current confirmation for modal buttons
  AppState.currentConfirmation = confirmation;
  
  elements.confirmationModal.classList.remove('hidden');
}

function hideConfirmationModal() {
  elements.confirmationModal.classList.add('hidden');
  AppState.currentConfirmation = null;
}

function handleConfirmationResponse(approve) {
  if (!AppState.currentConfirmation) return;
  
  const confirmation = AppState.currentConfirmation;
  
  // Send response via WebSocket
  if (AppState.ws && AppState.isConnected) {
    const response = {
      type: 'confirmation_response',
      confirmationId: confirmation.id,
      approved: approve,
      action: confirmation.action,
      timestamp: Date.now()
    };
    
    AppState.ws.send(JSON.stringify(response));
  }
  
  // Remove from list
  AppState.confirmations = AppState.confirmations.filter(c => c.id !== confirmation.id);
  updateConfirmationsList();
  updateConfirmationsBadge();
  
  // Hide modal
  hideConfirmationModal();
  
  // Show feedback
  showNotification(approve ? 'Confirmation approuvée' : 'Confirmation refusée');
}

// ============================================================================
// Run Trajectory
// ============================================================================

async function viewRunTrajectory(runId) {
  try {
    const response = await fetchWithAuth(`/api/runs/${runId}/trajectory`);
    
    // For now, just display as a message
    addMessage(`Trajectory for run ${runId}:\n\n${JSON.stringify(response, null, 2)}`, 'system');
    switchSection('chat-section');
  } catch (error) {
    console.error('Error fetching run trajectory:', error);
    showError(`Erreur lors de la récupération de la trajectory: ${error.message}`);
  }
}

// ============================================================================
// Authentication & Login
// ============================================================================

function showLoginScreen() {
  elements.loginScreen.classList.add('active');
  elements.loginScreen.classList.remove('hidden');
  elements.mainScreen.classList.remove('active');
  elements.mainScreen.classList.add('hidden');
  
  // Clear token
  AppState.token = null;
  sessionStorage.removeItem('codebuddy_mobile_token');
  
  // Disconnect WebSocket
  disconnectWebSocket();
  
  // Clear messages
  AppState.messages = [];
  elements.messages.innerHTML = '<div class="welcome-message"><p>Bienvenue sur Code Buddy Mobile</p></div>';
  
  // Focus on token input
  elements.tokenInput.focus();
}

function showMainScreen() {
  elements.loginScreen.classList.remove('active');
  elements.loginScreen.classList.add('hidden');
  elements.mainScreen.classList.add('active');
  elements.mainScreen.classList.remove('hidden');
  
  // Connect WebSocket
  AppState.ws = connectWebSocket();
  
  // Focus on message input
  elements.messageInput.focus();
}

function attemptLogin() {
  const token = elements.tokenInput.value.trim();
  
  if (!token) {
    showError('Veuillez entrer un token JWT');
    return;
  }
  
  // Validate token format (basic check)
  if (!/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(token)) {
    showError('Format de token invalide');
    return;
  }
  
  // Store token
  AppState.token = token;
  sessionStorage.setItem('codebuddy_mobile_token', token);
  
  // Switch to main screen
  showMainScreen();
  
  // Clear error
  hideError();
}

function generateQRCode() {
  const token = elements.tokenInput.value.trim();
  
  if (!token) {
    showError('Veuillez d\'abord entrer un token JWT');
    return;
  }
  
  // For now, we'll use a simple text-based QR code
  // In production, this would use a QR code library
  const qrData = JSON.stringify({
    url: window.location.origin + '/__codebuddy__/mobile/',
    token: token,
    timestamp: Date.now()
  });
  
  // Generate a simple QR code representation
  // Note: This is a placeholder - in production, use a proper QR code library
  elements.qrData.textContent = `URL: ${window.location.origin}/__codebuddy__/mobile/`;
  elements.qrCode.textContent = '📷 QR Code';
  elements.qrCode.style.background = 'var(--bg-tertiary)';
  elements.qrCode.style.color = 'var(--text-primary)';
  elements.qrCode.style.display = 'flex';
  elements.qrCode.style.alignItems = 'center';
  elements.qrCode.style.justifyContent = 'center';
  
  elements.qrContainer.classList.remove('hidden');
  
  // Focus on token input for easy copying
  elements.tokenInput.select();
}

function hideQRCode() {
  elements.qrContainer.classList.add('hidden');
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove('hidden');
}

function hideError() {
  elements.errorMessage.classList.add('hidden');
}

function showNotification(message) {
  // Simple notification (could be enhanced with a toast system)
  console.log('Notification:', message);
  
  // For now, just show a temporary message in the chat
  const notificationMsg = addMessage(message, 'system');
  
  // Remove after 5 seconds
  setTimeout(() => {
    // Could remove the message here if needed
  }, 5000);
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
  // Login screen
  elements.connectBtn.addEventListener('click', attemptLogin);
  elements.tokenInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      attemptLogin();
    }
  });
  
  elements.qrBtn.addEventListener('click', generateQRCode);
  elements.closeQrBtn.addEventListener('click', hideQRCode);
  
  // Main screen
  elements.logoutBtn.addEventListener('click', showLoginScreen);
  elements.menuBtn.addEventListener('click', showAssistantModal);
  
  // Chat
  elements.sendBtn.addEventListener('click', sendMessage);
  elements.stopBtn.addEventListener('click', stopStreaming);
  elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      switchSection(item.dataset.section);
    });
  });
  
  // Refresh runs
  elements.refreshRuns.addEventListener('click', loadRuns);
  
  // Modals
  elements.closeAssistantModal.addEventListener('click', hideAssistantModal);
  elements.confirmApprove.addEventListener('click', () => handleConfirmationResponse(true));
  elements.confirmDeny.addEventListener('click', () => handleConfirmationResponse(false));
  
  // Close modals on backdrop click
  elements.assistantModal.addEventListener('click', (e) => {
    if (e.target === elements.assistantModal) {
      hideAssistantModal();
    }
  });
  
  elements.confirmationModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmationModal) {
      hideConfirmationModal();
    }
  });
  
  // Handle keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape key to close modals
    if (e.key === 'Escape') {
      if (!elements.assistantModal.classList.contains('hidden')) {
        hideAssistantModal();
      } else if (!elements.confirmationModal.classList.contains('hidden')) {
        hideConfirmationModal();
      }
    }
  });
}

// ============================================================================
// Message Sending
// ============================================================================

function sendMessage() {
  const message = elements.messageInput.value.trim();
  
  if (!message) return;
  
  // Add user message to chat
  addMessage(message, 'user');
  
  // Clear input
  elements.messageInput.value = '';
  elements.messageInput.style.height = 'auto';
  
  // Send to WebSocket
  sendChatMessage(message).catch(error => {
    console.error('Error sending message:', error);
    addMessage(`Erreur: ${error.message}`, 'system');
  });
  
  // Focus back on input
  elements.messageInput.focus();
}

// ============================================================================
// Utility Functions
// ============================================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.length > 0 ? parts.join(' ') : `${seconds}s`;
}

// ============================================================================
// Auto-resize Textarea
// ============================================================================

function setupAutoResize() {
  const textarea = elements.messageInput;
  
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  });
  
  // Initial resize
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

// ============================================================================
// Heartbeat
// ============================================================================

function startHeartbeat() {
  setInterval(() => {
    if (AppState.ws && AppState.isConnected) {
      try {
        AppState.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (error) {
        console.error('Heartbeat failed:', error);
      }
    }
  }, 30000); // Send ping every 30 seconds
}

// ============================================================================
// Check for existing token on load
// ============================================================================

function checkForExistingToken() {
  const savedToken = sessionStorage.getItem('codebuddy_mobile_token');
  if (savedToken) {
    AppState.token = savedToken;
    elements.tokenInput.value = savedToken;
    // Auto-connect if token exists
    setTimeout(() => {
      showMainScreen();
    }, 500);
  }
}

// ============================================================================
// Initialize Application
// ============================================================================

function init() {
  console.log('Code Buddy Mobile PWA v1.0.0');
  
  // Check for existing token
  checkForExistingToken();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup auto-resize for textarea
  setupAutoResize();
  
  // Start heartbeat
  startHeartbeat();
  
  // Load initial data if already authenticated
  if (AppState.token) {
    showMainScreen();
  }
  
  console.log('Application initialized');
}

// Make copyMessageContent available globally
window.copyMessageContent = copyMessageContent;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

// Export for debugging
window.AppState = AppState;
