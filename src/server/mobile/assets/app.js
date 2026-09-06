/**
 * Code Buddy Mobile PWA — protocol matches src/server/websocket/handler.ts
 * authenticate / chat / stop / ping + stream_* / confirmation_*
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'codebuddy_mobile_token';
  const BASE = '/__codebuddy__/mobile';

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    ws: null,
    connected: false,
    streaming: false,
    assistant: 'agent',
    assistantLabel: 'Agent',
    peers: [],
    confirmations: [],
    activeConfirmationId: null,
    streamEl: null,
    pingTimer: 0,
  };

  const el = (id) => document.getElementById(id);

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(function () {});
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(src) {
    const escaped = escapeHtml(src);
    return escaped
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function show(id, on) {
    const node = el(id);
    if (!node) return;
    node.classList.toggle('hidden', !on);
    node.classList.toggle('active', on);
  }

  function setError(message) {
    const box = el('error-message');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + state.token };
  }

  async function fetchJson(path) {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) throw new Error(path + ' → ' + res.status);
    return res.json();
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function send(type, payload) {
    if (!state.ws || state.ws.readyState !== 1) return;
    const frame = { type: type };
    if (payload !== undefined) frame.payload = payload;
    state.ws.send(JSON.stringify(frame));
  }

  function addBubble(role, html, replaceEl) {
    const box = el('messages');
    if (!box) return null;
    const div = replaceEl || document.createElement('div');
    div.className = 'bubble ' + role;
    div.innerHTML = html;
    if (!replaceEl) box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function setDot(kind) {
    const dot = el('connection-status');
    if (!dot) return;
    dot.classList.remove('ok', 'busy');
    if (kind) dot.classList.add(kind);
  }

  function setStreaming(on) {
    state.streaming = on;
    el('send-btn').classList.toggle('hidden', on);
    el('stop-btn').classList.toggle('hidden', !on);
    setDot(on ? 'busy' : state.connected ? 'ok' : '');
  }

  function handleFrame(data) {
    const type = data.type;
    if (type === 'connected') return;
    if (type === 'authenticated') {
      state.connected = true;
      setDot('ok');
      show('login-screen', false);
      show('main-screen', true);
      el('login-screen').classList.remove('active');
      el('main-screen').classList.add('active');
      loadAssistants();
      loadStatus();
      return;
    }
    if (type === 'error') {
      const code = data.error && data.error.code;
      const msg = (data.error && data.error.message) || 'Erreur';
      if (code === 'AUTH_FAILED' || code === 'UNAUTHORIZED') {
        setError(msg);
        return;
      }
      addBubble('system', escapeHtml(msg));
      return;
    }
    if (type === 'stream_start') {
      setStreaming(true);
      state.streamEl = addBubble('assistant', '');
      return;
    }
    if (type === 'stream_chunk') {
      const delta = data.payload && data.payload.delta;
      const image = data.payload && data.payload.image;
      if (state.streamEl) {
        if (typeof delta === 'string') {
          state.streamEl.dataset.raw = (state.streamEl.dataset.raw || '') + delta;
        }
        var html = renderMarkdown(state.streamEl.dataset.raw || '');
        if (image && typeof image.data === 'string' && typeof image.mimeType === 'string') {
          var mime = image.mimeType === 'image/jpeg' || image.mimeType === 'image/webp'
            ? image.mimeType
            : 'image/png';
          html += '<img class="selfie" alt="" src="data:' + mime + ';base64,' + image.data + '">';
        }
        state.streamEl.innerHTML = html;
        el('messages').scrollTop = el('messages').scrollHeight;
      }
      return;
    }
    if (type === 'stream_end' || type === 'stream_stopped') {
      setStreaming(false);
      state.streamEl = null;
      return;
    }
    if (type === 'chat_response') {
      const content = data.payload && data.payload.content;
      const image = data.payload && data.payload.image;
      var html = typeof content === 'string' ? renderMarkdown(content) : '';
      if (image && typeof image.data === 'string' && typeof image.mimeType === 'string') {
        var mime = image.mimeType === 'image/jpeg' || image.mimeType === 'image/webp'
          ? image.mimeType
          : 'image/png';
        html += '<img class="selfie" alt="" src="data:' + mime + ';base64,' + image.data + '">';
      }
      if (html) addBubble('assistant', html);
      setStreaming(false);
      return;
    }
    if (type === 'pong') return;
    if (type === 'confirmation_required') {
      queueConfirmation(data.payload || {});
    }
  }

  function connectWs() {
    if (state.ws) {
      try { state.ws.close(); } catch (_e) { /* ignore */ }
    }
    const ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.addEventListener('open', function () {
      send('authenticate', { token: state.token, approvalCapable: true });
    });
    ws.addEventListener('message', function (ev) {
      try {
        handleFrame(JSON.parse(ev.data));
      } catch (_err) {
        addBubble('system', 'Trame WS illisible');
      }
    });
    ws.addEventListener('close', function () {
      state.connected = false;
      setStreaming(false);
      setDot('');
    });
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(function () {
      if (state.connected) send('ping');
    }, 25000);
  }

  function login(event) {
    if (event) event.preventDefault();
    const token = (el('token-input').value || '').trim();
    if (!token) {
      setError('Jeton requis');
      return;
    }
    state.token = token;
    sessionStorage.setItem(TOKEN_KEY, token);
    setError('');
    connectWs();
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = '';
    if (state.ws) state.ws.close();
    show('main-screen', false);
    show('login-screen', true);
    el('main-screen').classList.remove('active');
    el('login-screen').classList.add('active');
  }

  function currentChatPayload(message) {
    const payload = { message: message, stream: true, assistant: 'agent' };
    if (state.assistant === 'companion') {
      payload.assistant = 'companion';
    } else if (state.assistant !== 'agent') {
      payload.assistant = 'peer';
      payload.peerId = state.assistant;
    }
    return payload;
  }

  function sendChat(event) {
    if (event) event.preventDefault();
    const input = el('message-input');
    const message = (input.value || '').trim();
    if (!message || state.streaming) return;
    addBubble('user', escapeHtml(message));
    input.value = '';
    send('chat', currentChatPayload(message));
  }

  function stopChat() {
    send('stop');
  }

  function switchSection(id) {
    document.querySelectorAll('.panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === id);
      panel.classList.toggle('hidden', panel.id !== id);
    });
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-section') === id);
    });
    if (id === 'runs-section') loadRuns();
    if (id === 'status-section') loadStatus();
  }

  function renderAssistants() {
    const list = el('assistants-list');
    const items = [
      { id: 'agent', name: 'Agent', hint: 'Chat outil Code Buddy' },
      { id: 'companion', name: 'Lisa', hint: 'Réponse compagnon' },
    ];
    state.peers.forEach(function (peer) {
      items.push({
        id: peer.id,
        name: peer.id,
        hint: peer.describe && peer.describe.hostname
          ? String(peer.describe.hostname)
          : peer.url,
      });
    });
    list.innerHTML = '';
    items.forEach(function (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-item';
      btn.innerHTML = '<strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.hint) + '</small>';
      btn.addEventListener('click', function () {
        state.assistant = item.id;
        state.assistantLabel = item.name;
        el('current-assistant').textContent = item.name;
        el('assistant-modal').close();
      });
      list.appendChild(btn);
    });
  }

  async function loadAssistants() {
    try {
      const data = await fetchJson('/api/fleet/peers');
      state.peers = Array.isArray(data.peers) ? data.peers : [];
    } catch (_err) {
      state.peers = [];
    }
    renderAssistants();
  }

  async function loadRuns() {
    const list = el('runs-list');
    const traj = el('trajectory-view');
    traj.classList.add('hidden');
    try {
      const data = await fetchJson('/api/runs');
      const runs = Array.isArray(data.runs) ? data.runs : [];
      if (runs.length === 0) {
        list.innerHTML = '<p class="empty">Aucun run</p>';
        return;
      }
      list.innerHTML = '';
      runs.forEach(function (run) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-item';
        btn.innerHTML = '<strong>' + escapeHtml(run.objective || run.runId) + '</strong><small>'
          + escapeHtml((run.status || '') + ' · ' + (run.runId || '')) + '</small>';
        btn.addEventListener('click', function () { viewTrajectory(run.runId); });
        list.appendChild(btn);
      });
    } catch (_err) {
      list.innerHTML = '<p class="empty">Runs indisponibles</p>';
    }
  }

  async function viewTrajectory(runId) {
    const traj = el('trajectory-view');
    try {
      const data = await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/trajectory');
      traj.textContent = JSON.stringify(data, null, 2);
      traj.classList.remove('hidden');
    } catch (_err) {
      traj.textContent = 'Trajectoire indisponible';
      traj.classList.remove('hidden');
    }
  }

  async function loadStatus() {
    const box = el('status-info');
    try {
      const data = await fetchJson('/api/status');
      const provider = data.provider
        ? (data.provider.id + ' · ' + (data.provider.model || ''))
        : 'aucun';
      const file = data.providerHealthFile
        ? JSON.stringify(data.providerHealthFile)
        : 'absent';
      const fallback = Array.isArray(data.fallback)
        ? data.fallback.map(function (item) {
          return (item.provider || '?') + (item.healthy === false ? ' (hs)' : '');
        }).join(', ') || '—'
        : '—';
      const peers = data.fleet && Array.isArray(data.fleet.peers) ? data.fleet.peers.length : 0;
      const conn = data.fleet && data.fleet.connections ? data.fleet.connections.total : 0;
      box.innerHTML =
        '<article class="status-card"><h3>Fournisseur</h3><div>' + escapeHtml(provider) + '</div></article>' +
        '<article class="status-card"><h3>Repli (fichier)</h3><div>' + escapeHtml(file) + '</div></article>' +
        '<article class="status-card"><h3>Repli (chaîne)</h3><div>' + escapeHtml(fallback) + '</div></article>' +
        '<article class="status-card"><h3>Flotte</h3><div>' + peers + ' pair(s), ' + conn + ' WS</div></article>';
    } catch (_err) {
      box.innerHTML = '<p class="empty">Statut indisponible</p>';
    }
  }

  function refreshConfirmationBadge() {
    const badge = el('confirmation-badge');
    const n = state.confirmations.length;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    const list = el('confirmations-list');
    if (n === 0) {
      list.innerHTML = '<p class="empty">Aucune confirmation</p>';
      return;
    }
    list.innerHTML = '';
    state.confirmations.forEach(function (item) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-item';
      btn.innerHTML = '<strong>' + escapeHtml(item.tool || 'outil') + '</strong><small>'
        + escapeHtml(item.summary || item.id) + '</small>';
      btn.addEventListener('click', function () { openConfirmation(item); });
      list.appendChild(btn);
    });
  }

  function queueConfirmation(payload) {
    const item = {
      id: payload.id,
      tool: payload.tool,
      summary: payload.summary,
      risk: payload.risk || 'medium',
    };
    if (!item.id) return;
    state.confirmations.push(item);
    refreshConfirmationBadge();
    openConfirmation(item);
  }

  function openConfirmation(item) {
    state.activeConfirmationId = item.id;
    const body = el('confirmation-content');
    body.innerHTML = '<p class="risk-' + escapeHtml(item.risk) + '">' + escapeHtml(item.risk) + '</p>'
      + '<p>' + escapeHtml(item.tool || '') + '</p>'
      + '<p>' + escapeHtml(item.summary || '') + '</p>';
    const dialog = el('confirmation-modal');
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function answerConfirmation(approved) {
    const id = state.activeConfirmationId;
    if (!id) return;
    send('confirmation_response', { id: id, approved: approved });
    state.confirmations = state.confirmations.filter(function (item) { return item.id !== id; });
    state.activeConfirmationId = null;
    refreshConfirmationBadge();
    const dialog = el('confirmation-modal');
    if (dialog.open) dialog.close();
  }

  function startDictation() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      addBubble('system', 'Dictée indisponible sur ce navigateur');
      return;
    }
    const rec = new Rec();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.onresult = function (event) {
      const text = event.results[0] && event.results[0][0] && event.results[0][0].transcript;
      if (text) {
        const input = el('message-input');
        input.value = (input.value ? input.value + ' ' : '') + text;
      }
    };
    rec.start();
  }

  function bind() {
    el('login-form').addEventListener('submit', login);
    el('copy-url-btn').addEventListener('click', function () {
      navigator.clipboard.writeText(location.origin + BASE + '/').catch(function () {});
    });
    el('logout-btn').addEventListener('click', logout);
    el('composer').addEventListener('submit', sendChat);
    el('stop-btn').addEventListener('click', stopChat);
    el('mic-btn').addEventListener('click', startDictation);
    el('assistant-btn').addEventListener('click', function () {
      renderAssistants();
      const dialog = el('assistant-modal');
      if (typeof dialog.showModal === 'function') dialog.showModal();
    });
    el('refresh-runs').addEventListener('click', loadRuns);
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchSection(btn.getAttribute('data-section'));
      });
    });
    el('confirm-approve').addEventListener('click', function (event) {
      event.preventDefault();
      answerConfirmation(true);
    });
    el('confirm-deny').addEventListener('click', function (event) {
      event.preventDefault();
      answerConfirmation(false);
    });
    el('message-input').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChat();
      }
    });
  }

  function init() {
    registerServiceWorker();
    bind();
    refreshConfirmationBadge();
    if (state.token) {
      el('token-input').value = state.token;
      connectWs();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
