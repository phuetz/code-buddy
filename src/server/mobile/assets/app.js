/**
 * Code Buddy Mobile PWA — protocol matches src/server/websocket/handler.ts
 * authenticate / chat / stop / ping + stream_* / confirmation_*
 * Reactions are local-only (no WS type "reaction").
 */
(function (root) {
  'use strict';

  var TOKEN_KEY = 'codebuddy_mobile_token';
  var BASE = '/__codebuddy__/mobile';
  var DEFAULT_AVATAR = BASE + '/assets/icon-192.png';
  var REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
  var MAX_RECENT = 10;
  var MAX_HISTORY = 200;
  var MAX_HISTORY_IMAGES = 5;
  var MAX_IMAGE_CHARS = 100 * 1024;
  var MAX_AVATAR_CHARS = 200 * 1024;
  var LONG_PRESS_MS = 400;
  var GROUP_MS = 5 * 60 * 1000;
  var LONG_REPLY = 400;

  var STORAGE = {
    recent: 'codebuddy_mobile_emoji_recent',
    avatar: 'codebuddy_mobile_avatar',
    history: 'codebuddy_mobile_history',
    suggestHidden: 'codebuddy_mobile_suggest_hidden',
  };

  var SUGGEST_START = [
    'Coucou 💕',
    'Raconte-moi ta journée',
    'Envoie-moi une photo de toi 📸',
    'Tu penses à quoi ?',
  ];
  var SUGGEST_IMAGE = ['Encore une ?', 'Trop belle 😍'];
  var SUGGEST_LONG = ['Continue', 'Résume'];

  var state = {
    token: '',
    ws: null,
    connected: false,
    streaming: false,
    assistant: 'companion',
    assistantLabel: 'Lisa',
    peers: [],
    confirmations: [],
    activeConfirmationId: null,
    streamEl: null,
    streamId: null,
    pingTimer: 0,
    messages: [],
    seq: 0,
    avatarUrl: DEFAULT_AVATAR,
    presence: 'offline',
    moodLabel: '',
    pickerOpen: false,
    pickerCat: 'smileys',
    suggestHidden: false,
    suggestRotate: 0,
    atBottom: true,
    unread: 0,
    reactionTarget: null,
    longPressTimer: 0,
    lastTap: { id: '', at: 0 },
    sawChunk: false,
    bound: false,
  };

  try {
    state.token = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch (_err) {
    state.token = '';
  }

  function el(id) {
    return document.getElementById(id);
  }

  function emojiData() {
    return root.CODEBUDDY_EMOJI_DATA || { CATEGORIES: [], EMOJIS: [], searchEmojis: function () { return []; }, byCategory: function () { return []; } };
  }

  function haptic() {
    try {
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (_err) { /* optional */ }
  }

  function storeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_err) {
      return fallback;
    }
  }

  function storeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function linkify(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMarkdown(src) {
    var escaped = linkify(escapeHtml(src));
    return escaped
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function show(id, on) {
    var node = el(id);
    if (!node) return;
    node.classList.toggle('hidden', !on);
    node.classList.toggle('active', on);
  }

  function setError(message) {
    var box = el('error-message');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + state.token };
  }

  async function fetchJson(path) {
    var res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) throw new Error(path + ' → ' + res.status);
    return res.json();
  }

  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function send(type, payload) {
    if (!state.ws || state.ws.readyState !== 1) return;
    var frame = { type: type };
    if (payload !== undefined) frame.payload = payload;
    state.ws.send(JSON.stringify(frame));
  }

  function nextId() {
    state.seq += 1;
    return 'm-' + Date.now() + '-' + state.seq;
  }

  function byteLen(str) {
    return String(str || '').length;
  }

  function constrainDataUrl(dataUrl, maxChars) {
    if (!dataUrl) return '';
    if (byteLen(dataUrl) <= maxChars) return dataUrl;
    return '';
  }

  function imageHtml(dataUrl) {
    if (!dataUrl) return '';
    return '<img class="bubble-img selfie" alt="Image" src="' + dataUrl + '">';
  }

  function dataUrlFromFrame(image) {
    if (!image || typeof image.data !== 'string' || typeof image.mimeType !== 'string') return '';
    var mime = image.mimeType === 'image/jpeg' || image.mimeType === 'image/webp'
      ? image.mimeType
      : 'image/png';
    return 'data:' + mime + ';base64,' + image.data;
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function daySeparatorLabel(ts, now) {
    var then = startOfDay(ts);
    var today = startOfDay(now == null ? Date.now() : now);
    var diff = Math.round((today - then) / 86400000);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === 1) return 'Hier';
    return new Date(ts).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function groupingFor(index, msgs) {
    var cur = msgs[index];
    var prev = msgs[index - 1];
    var next = msgs[index + 1];
    var withPrev = prev && prev.role === cur.role && Math.abs(cur.ts - prev.ts) < GROUP_MS;
    var withNext = next && next.role === cur.role && Math.abs(next.ts - cur.ts) < GROUP_MS;
    if (withPrev && withNext) return 'group-mid';
    if (withPrev) return 'group-end';
    if (withNext) return 'group-start';
    return 'group-alone';
  }

  function ackMark(msg) {
    if (msg.role !== 'user') return '';
    if (msg.ack === 'replied') return '<span class="ack" aria-label="Répondu">✓✓</span>';
    return '<span class="ack" aria-label="Envoyé">✓</span>';
  }

  function isNearBottom(box) {
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  }

  function updateJumpButton() {
    var btn = el('jump-bottom');
    var count = el('unread-count');
    if (!btn) return;
    var showBtn = !state.atBottom;
    btn.classList.toggle('hidden', !showBtn);
    if (count) {
      count.textContent = String(state.unread);
      count.classList.toggle('hidden', state.unread < 1);
    }
  }

  function scrollMessages(force) {
    var box = el('messages');
    if (!box) return;
    if (force || state.atBottom) {
      box.scrollTop = box.scrollHeight;
      state.atBottom = true;
      state.unread = 0;
    }
    updateJumpButton();
  }

  function persistHistory() {
    var images = 0;
    var slim = state.messages.slice(-MAX_HISTORY).map(function (msg) {
      var copy = {
        id: msg.id,
        role: msg.role,
        text: msg.text || '',
        ts: msg.ts,
        reaction: msg.reaction || '',
        ack: msg.ack || '',
      };
      if (msg.image && images < MAX_HISTORY_IMAGES) {
        var clipped = constrainDataUrl(msg.image, MAX_IMAGE_CHARS);
        if (clipped) {
          copy.image = clipped;
          images += 1;
        }
      }
      return copy;
    });
    storeSet(STORAGE.history, slim);
  }

  function restoreHistory() {
    var raw = storeGet(STORAGE.history, []);
    if (!Array.isArray(raw)) raw = [];
    state.messages = raw.filter(function (item) {
      return item && typeof item.id === 'string' && typeof item.role === 'string';
    }).slice(-MAX_HISTORY).map(function (item) {
      return {
        id: item.id,
        role: item.role,
        text: typeof item.text === 'string' ? item.text : '',
        ts: typeof item.ts === 'number' ? item.ts : Date.now(),
        reaction: typeof item.reaction === 'string' ? item.reaction : '',
        ack: typeof item.ack === 'string' ? item.ack : '',
        image: typeof item.image === 'string' ? item.image : '',
      };
    });
    var maxSeq = 0;
    state.messages.forEach(function (msg) {
      var m = /-(\d+)$/.exec(msg.id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]) || 0);
    });
    state.seq = maxSeq;
    renderMessages();
  }

  function clearHistory() {
    state.messages = [];
    storeSet(STORAGE.history, []);
    renderMessages();
    refreshSuggestions();
  }

  function markUserReplied() {
    var i;
    for (i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'user') {
        state.messages[i].ack = 'replied';
      } else {
        break;
      }
    }
  }

  function renderMessages() {
    var box = el('messages');
    if (!box) return;
    var html = [];
    var lastDay = null;
    var now = Date.now();
    state.messages.forEach(function (msg, index) {
      var day = startOfDay(msg.ts);
      if (day !== lastDay) {
        html.push('<div class="day-sep">' + escapeHtml(daySeparatorLabel(msg.ts, now)) + '</div>');
        lastDay = day;
      }
      var group = groupingFor(index, state.messages);
      var avatar = '';
      if (msg.role === 'assistant') {
        avatar = '<img class="msg-avatar" alt="" src="' + escapeHtml(state.avatarUrl) + '">';
      }
      var body = renderMarkdown(msg.text || '');
      if (msg.image) body += imageHtml(msg.image);
      var reaction = msg.reaction
        ? '<div class="bubble-reactions">' + escapeHtml(msg.reaction) + '</div>'
        : '';
      html.push(
        '<div class="msg-row ' + msg.role + ' ' + group + '" data-id="' + escapeHtml(msg.id) + '" data-role="' + escapeHtml(msg.role) + '">' +
          avatar +
          '<div class="bubble ' + msg.role + ' ' + group + '">' +
            '<div class="bubble-body">' + body + '</div>' +
            '<div class="bubble-meta">' + escapeHtml(formatTime(msg.ts)) + ackMark(msg) + '</div>' +
            reaction +
          '</div>' +
        '</div>'
      );
    });
    box.innerHTML = html.join('');
    scrollMessages(false);
  }

  function addMessage(partial) {
    var msg = {
      id: partial.id || nextId(),
      role: partial.role || 'assistant',
      text: partial.text || '',
      ts: partial.ts || Date.now(),
      reaction: partial.reaction || '',
      ack: partial.ack || (partial.role === 'user' ? 'sent' : ''),
      image: partial.image || '',
    };
    if (msg.role === 'assistant') markUserReplied();
    state.messages.push(msg);
    if (state.messages.length > MAX_HISTORY) {
      state.messages = state.messages.slice(-MAX_HISTORY);
    }
    persistHistory();
    var box = el('messages');
    var stick = isNearBottom(box);
    if (!stick && msg.role !== 'user') state.unread += 1;
    state.atBottom = stick || msg.role === 'user';
    renderMessages();
    if (msg.image) maybeAdoptAvatar(msg.image);
    refreshSuggestions();
    return msg;
  }

  function findMessage(id) {
    var i;
    for (i = 0; i < state.messages.length; i += 1) {
      if (state.messages[i].id === id) return state.messages[i];
    }
    return null;
  }

  function maybeAdoptAvatar(dataUrl) {
    var clipped = constrainDataUrl(dataUrl, MAX_AVATAR_CHARS);
    if (!clipped) return;
    state.avatarUrl = clipped;
    storeSet(STORAGE.avatar, clipped);
    var header = el('lisa-avatar');
    if (header) header.src = clipped;
    document.querySelectorAll('.msg-avatar').forEach(function (img) {
      img.src = clipped;
    });
  }

  function restoreAvatar() {
    var saved = storeGet(STORAGE.avatar, '');
    if (typeof saved === 'string' && saved.indexOf('data:image/') === 0 && byteLen(saved) <= MAX_AVATAR_CHARS) {
      state.avatarUrl = saved;
    } else {
      state.avatarUrl = DEFAULT_AVATAR;
    }
    var header = el('lisa-avatar');
    if (header) header.src = state.avatarUrl;
  }

  function setPresence(kind) {
    state.presence = kind;
    var line = el('presence-line');
    var typing = el('typing-indicator');
    if (line) {
      line.classList.remove('online', 'typing');
      if (kind === 'typing') {
        line.textContent = 'écrit…';
        line.classList.add('typing');
      } else if (kind === 'online') {
        line.textContent = 'en ligne';
        line.classList.add('online');
      } else {
        line.textContent = 'hors ligne';
      }
    }
    if (typing) typing.classList.toggle('hidden', kind !== 'typing');
    setDot(kind === 'typing' || state.streaming ? 'busy' : state.connected ? 'ok' : '');
  }

  function setDot(kind) {
    var dot = el('connection-status');
    if (!dot) return;
    dot.classList.remove('ok', 'busy');
    if (kind) dot.classList.add(kind);
  }

  function setStreaming(on) {
    state.streaming = on;
    var sendBtn = el('send-btn');
    var stopBtn = el('stop-btn');
    if (sendBtn) sendBtn.classList.toggle('hidden', on);
    if (stopBtn) stopBtn.classList.toggle('hidden', !on);
    if (!on) {
      state.sawChunk = false;
      setPresence(state.connected ? 'online' : 'offline');
    }
  }

  function applyStatusPayload(data) {
    if (!data || typeof data !== 'object') return;
    var companion = data.companion;
    var chip = el('mood-chip');
    if (!chip) return;
    if (companion && (companion.label || companion.mood != null)) {
      var label = companion.label || String(companion.mood);
      state.moodLabel = label;
      chip.textContent = label;
      chip.classList.remove('hidden');
    } else {
      state.moodLabel = '';
      chip.textContent = '';
      chip.classList.add('hidden');
    }
  }

  function pulseSend() {
    var btn = el('send-btn');
    if (!btn) return;
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
  }

  function autosizeComposer() {
    var input = el('message-input');
    if (!input) return;
    input.style.height = 'auto';
    var max = 132;
    var min = 44;
    var h = Math.min(max, Math.max(min, input.scrollHeight));
    input.style.height = h + 'px';
  }

  function getRecentEmojis() {
    var list = storeGet(STORAGE.recent, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (item) { return typeof item === 'string'; }).slice(0, MAX_RECENT);
  }

  function rememberEmoji(emoji) {
    if (!emoji) return getRecentEmojis();
    var list = getRecentEmojis().filter(function (item) { return item !== emoji; });
    list.unshift(emoji);
    list = list.slice(0, MAX_RECENT);
    storeSet(STORAGE.recent, list);
    return list;
  }

  function searchEmojis(query) {
    return emojiData().searchEmojis(query);
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    var start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : textarea.value.length;
    var end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
    var value = textarea.value || '';
    textarea.value = value.slice(0, start) + text + value.slice(end);
    var pos = start + String(text).length;
    try {
      textarea.setSelectionRange(pos, pos);
    } catch (_err) { /* ignore */ }
    textarea.focus();
    autosizeComposer();
  }

  function insertEmoji(emoji) {
    var input = el('message-input');
    insertAtCursor(input, emoji);
    rememberEmoji(emoji);
    if (state.pickerCat === 'recents') renderEmojiGrid();
  }

  function renderEmojiCats() {
    var bar = el('emoji-cats');
    var data = emojiData();
    if (!bar || !data.CATEGORIES) return;
    bar.innerHTML = '';
    data.CATEGORIES.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-cat' + (cat.id === state.pickerCat ? ' active' : '');
      btn.textContent = cat.icon;
      btn.setAttribute('aria-label', cat.label);
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', function () {
        state.pickerCat = cat.id;
        el('emoji-search').value = '';
        renderEmojiCats();
        renderEmojiGrid();
      });
      bar.appendChild(btn);
    });
  }

  function renderEmojiGrid() {
    var grid = el('emoji-grid');
    var search = el('emoji-search');
    var data = emojiData();
    if (!grid) return;
    var q = search ? search.value : '';
    var items;
    if (q && q.trim()) {
      items = data.searchEmojis(q).map(function (item) { return item.e; });
    } else if (state.pickerCat === 'recents') {
      items = getRecentEmojis();
    } else {
      items = data.byCategory(state.pickerCat).map(function (item) { return item.e; });
    }
    grid.innerHTML = '';
    items.forEach(function (emoji) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-cell';
      btn.textContent = emoji;
      btn.setAttribute('aria-label', emoji);
      btn.addEventListener('click', function () {
        insertEmoji(emoji);
      });
      grid.appendChild(btn);
    });
  }

  function openEmojiPicker() {
    var picker = el('emoji-picker');
    var btn = el('emoji-btn');
    if (!picker) return;
    picker.classList.remove('hidden');
    state.pickerOpen = true;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    renderEmojiCats();
    renderEmojiGrid();
    var search = el('emoji-search');
    if (search) search.focus();
  }

  function closeEmojiPicker() {
    var picker = el('emoji-picker');
    var btn = el('emoji-btn');
    if (!picker) return;
    picker.classList.add('hidden');
    state.pickerOpen = false;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleEmojiPicker() {
    if (state.pickerOpen) closeEmojiPicker();
    else openEmojiPicker();
  }

  function getSuggestions() {
    if (state.suggestHidden) return [];
    var last = null;
    var i;
    for (i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'assistant') {
        last = state.messages[i];
        break;
      }
    }
    var pool = SUGGEST_START;
    if (last && last.image) pool = SUGGEST_IMAGE;
    else if (last && (last.text || '').length >= LONG_REPLY) pool = SUGGEST_LONG;
    var out = [];
    var n = pool.length;
    if (!n) return out;
    var start = state.suggestRotate % n;
    var count = Math.min(3, n);
    var k;
    for (k = 0; k < count; k += 1) {
      out.push(pool[(start + k) % n]);
    }
    return out;
  }

  function refreshSuggestions() {
    var bar = el('suggestions');
    if (!bar) return;
    bar.innerHTML = '';
    if (state.suggestHidden) return;
    getSuggestions().forEach(function (text) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggest-chip';
      btn.textContent = text;
      btn.addEventListener('click', function () {
        sendText(text);
      });
      bar.appendChild(btn);
    });
    var hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'suggest-hide';
    hide.setAttribute('aria-label', 'Masquer les suggestions');
    hide.textContent = '✕';
    hide.addEventListener('click', hideSuggestions);
    bar.appendChild(hide);
  }

  function hideSuggestions() {
    state.suggestHidden = true;
    storeSet(STORAGE.suggestHidden, true);
    refreshSuggestions();
  }

  function currentChatPayload(message) {
    var payload = { message: message, stream: true, assistant: 'agent' };
    if (state.assistant === 'companion') {
      payload.assistant = 'companion';
    } else if (state.assistant !== 'agent') {
      payload.assistant = 'peer';
      payload.peerId = state.assistant;
    }
    return payload;
  }

  function sendText(message) {
    var text = String(message || '').trim();
    if (!text || state.streaming) return false;
    addMessage({ role: 'user', text: text, ack: 'sent' });
    var input = el('message-input');
    if (input) {
      input.value = '';
      autosizeComposer();
    }
    pulseSend();
    haptic();
    closeEmojiPicker();
    state.suggestRotate += 1;
    send('chat', currentChatPayload(text));
    return true;
  }

  function sendChat(event) {
    if (event) event.preventDefault();
    var input = el('message-input');
    return sendText(input ? input.value : '');
  }

  function handleComposerKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChat();
      return true;
    }
    return false;
  }

  function stopChat() {
    send('stop');
  }

  function openLightbox(src) {
    var box = el('lightbox');
    var img = el('lightbox-img');
    if (!box || !img || !src) return;
    img.src = src;
    box.classList.remove('hidden');
  }

  function closeLightbox() {
    var box = el('lightbox');
    var img = el('lightbox-img');
    if (!box) return;
    box.classList.add('hidden');
    if (img) img.removeAttribute('src');
  }

  function hideReactionBar() {
    var bar = el('reaction-bar');
    if (bar) bar.classList.add('hidden');
    state.reactionTarget = null;
  }

  function showReactionBar(msgId, x, y) {
    var bar = el('reaction-bar');
    if (!bar) return;
    state.reactionTarget = msgId;
    bar.classList.remove('hidden');
    var left = Math.max(8, Math.min((x || 80) - 80, window.innerWidth - 280));
    var top = Math.max(8, (y || 120) - 56);
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  function setReaction(id, emoji) {
    var msg = findMessage(id);
    if (!msg) return null;
    if (msg.reaction === emoji) msg.reaction = '';
    else msg.reaction = emoji;
    persistHistory();
    renderMessages();
    hideReactionBar();
    return msg.reaction;
  }

  function copyMessage(id) {
    var msg = findMessage(id);
    if (!msg) return;
    var text = msg.text || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { /* ignore */ });
    }
    hideReactionBar();
  }

  function rowIdFromEvent(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute('data-id')) return node.getAttribute('data-id');
      node = node.parentNode;
    }
    return '';
  }

  function handleBubblePointerDown(event) {
    var id = rowIdFromEvent(event.target);
    if (!id) return;
    clearTimeout(state.longPressTimer);
    state.longPressTimer = setTimeout(function () {
      showReactionBar(id, event.clientX, event.clientY);
    }, LONG_PRESS_MS);
  }

  function handleBubblePointerUp() {
    clearTimeout(state.longPressTimer);
  }

  function handleBubbleClick(event) {
    var img = event.target.closest ? event.target.closest('img.bubble-img, img.selfie') : null;
    if (img && img.src) {
      event.preventDefault();
      openLightbox(img.src);
      return;
    }
    var id = rowIdFromEvent(event.target);
    if (!id) return;
    var now = Date.now();
    if (state.lastTap.id === id && now - state.lastTap.at < 350) {
      showReactionBar(id, event.clientX, event.clientY);
      state.lastTap = { id: '', at: 0 };
      return;
    }
    state.lastTap = { id: id, at: now };
    var row = event.target.closest ? event.target.closest('.msg-row') : null;
    if (row) row.classList.toggle('meta-on');
  }

  function handleFrame(data) {
    var type = data.type;
    if (type === 'connected') return;
    if (type === 'authenticated') {
      state.connected = true;
      setDot('ok');
      setPresence('online');
      show('login-screen', false);
      show('main-screen', true);
      el('login-screen').classList.remove('active');
      el('main-screen').classList.add('active');
      loadAssistants();
      loadStatus();
      refreshSuggestions();
      return;
    }
    if (type === 'error') {
      var code = data.error && data.error.code;
      var msg = (data.error && data.error.message) || 'Erreur';
      if (code === 'AUTH_FAILED' || code === 'UNAUTHORIZED') {
        setError(msg);
        return;
      }
      addMessage({ role: 'system', text: msg });
      return;
    }
    if (type === 'stream_start') {
      setStreaming(true);
      var started = addMessage({ role: 'assistant', text: '' });
      state.streamId = started.id;
      state.sawChunk = false;
      return;
    }
    if (type === 'stream_chunk') {
      var delta = data.payload && data.payload.delta;
      var image = data.payload && data.payload.image;
      if (!state.sawChunk) {
        state.sawChunk = true;
        setPresence('typing');
      }
      var current = state.streamId ? findMessage(state.streamId) : null;
      if (current) {
        if (typeof delta === 'string') current.text += delta;
        var fromFrame = dataUrlFromFrame(image);
        if (fromFrame) {
          current.image = fromFrame;
          maybeAdoptAvatar(fromFrame);
        }
        persistHistory();
        renderMessages();
      }
      return;
    }
    if (type === 'stream_end' || type === 'stream_stopped') {
      setStreaming(false);
      state.streamId = null;
      persistHistory();
      refreshSuggestions();
      return;
    }
    if (type === 'chat_response') {
      if (state.streamId || state.streaming) {
        setStreaming(false);
        state.streamId = null;
        return;
      }
      var content = data.payload && data.payload.content;
      var respImage = dataUrlFromFrame(data.payload && data.payload.image);
      if (typeof content === 'string' || respImage) {
        addMessage({
          role: 'assistant',
          text: typeof content === 'string' ? content : '',
          image: respImage,
        });
      }
      setStreaming(false);
      return;
    }
    if (type === 'pong') return;
    if (type === 'confirmation_required') {
      queueConfirmation(data.payload || {});
    }
  }

  function connectWs() {
    if (state.ws && state.ws.close) {
      try { state.ws.close(); } catch (_e) { /* ignore */ }
    }
    var ws = new WebSocket(wsUrl());
    state.ws = ws;
    ws.addEventListener('open', function () {
      send('authenticate', { token: state.token, approvalCapable: true });
    });
    ws.addEventListener('message', function (ev) {
      try {
        handleFrame(JSON.parse(ev.data));
      } catch (_err) {
        addMessage({ role: 'system', text: 'Trame WS illisible' });
      }
    });
    ws.addEventListener('close', function () {
      state.connected = false;
      setStreaming(false);
      setPresence('offline');
      setDot('');
    });
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(function () {
      if (state.connected) send('ping');
    }, 25000);
  }

  function login(event) {
    if (event) event.preventDefault();
    var token = (el('token-input').value || '').trim();
    if (!token) {
      setError('Jeton requis');
      return;
    }
    state.token = token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_err) { /* ignore */ }
    setError('');
    connectWs();
  }

  function logout() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_err) { /* ignore */ }
    state.token = '';
    if (state.ws) state.ws.close();
    show('main-screen', false);
    show('login-screen', true);
    el('main-screen').classList.remove('active');
    el('login-screen').classList.add('active');
    setPresence('offline');
  }

  function showMain() {
    show('login-screen', false);
    show('main-screen', true);
    el('login-screen').classList.remove('active');
    el('main-screen').classList.add('active');
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
    var list = el('assistants-list');
    if (!list) return;
    var items = [
      { id: 'companion', name: 'Lisa', hint: 'Réponse compagnon' },
      { id: 'agent', name: 'Agent', hint: 'Chat outil Code Buddy' },
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
      var btn = document.createElement('button');
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
      var data = await fetchJson('/api/fleet/peers');
      state.peers = Array.isArray(data.peers) ? data.peers : [];
    } catch (_err) {
      state.peers = [];
    }
    renderAssistants();
  }

  async function loadRuns() {
    var list = el('runs-list');
    var traj = el('trajectory-view');
    if (!list || !traj) return;
    traj.classList.add('hidden');
    try {
      var data = await fetchJson('/api/runs');
      var runs = Array.isArray(data.runs) ? data.runs : [];
      if (runs.length === 0) {
        list.innerHTML = '<p class="empty">Aucun run</p>';
        return;
      }
      list.innerHTML = '';
      runs.forEach(function (run) {
        var btn = document.createElement('button');
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
    var traj = el('trajectory-view');
    if (!traj) return;
    try {
      var data = await fetchJson('/api/runs/' + encodeURIComponent(runId) + '/trajectory');
      traj.textContent = JSON.stringify(data, null, 2);
      traj.classList.remove('hidden');
    } catch (_err) {
      traj.textContent = 'Trajectoire indisponible';
      traj.classList.remove('hidden');
    }
  }

  async function loadStatus() {
    var box = el('status-info');
    try {
      var data = await fetchJson('/api/status');
      applyStatusPayload(data);
      if (!box) return;
      var provider = data.provider
        ? (data.provider.id + ' · ' + (data.provider.model || ''))
        : 'aucun';
      var file = data.providerHealthFile
        ? JSON.stringify(data.providerHealthFile)
        : 'absent';
      var fallback = Array.isArray(data.fallback)
        ? data.fallback.map(function (item) {
          return (item.provider || '?') + (item.healthy === false ? ' (hs)' : '');
        }).join(', ') || '—'
        : '—';
      var peers = data.fleet && Array.isArray(data.fleet.peers) ? data.fleet.peers.length : 0;
      var conn = data.fleet && data.fleet.connections ? data.fleet.connections.total : 0;
      var mood = data.companion && data.companion.label ? data.companion.label : '—';
      box.innerHTML =
        '<article class="status-card"><h3>Fournisseur</h3><div>' + escapeHtml(provider) + '</div></article>' +
        '<article class="status-card"><h3>Repli (fichier)</h3><div>' + escapeHtml(file) + '</div></article>' +
        '<article class="status-card"><h3>Repli (chaîne)</h3><div>' + escapeHtml(fallback) + '</div></article>' +
        '<article class="status-card"><h3>Flotte</h3><div>' + peers + ' pair(s), ' + conn + ' WS</div></article>' +
        '<article class="status-card"><h3>Humeur</h3><div>' + escapeHtml(String(mood)) + '</div></article>';
    } catch (_err) {
      if (box) box.innerHTML = '<p class="empty">Statut indisponible</p>';
    }
    try {
      var mobileStatus = await fetch(BASE + '/status');
      if (mobileStatus.ok) applyStatusPayload(await mobileStatus.json());
    } catch (_mobileErr) { /* optional public status */ }
  }

  function refreshConfirmationBadge() {
    var badge = el('confirmation-badge');
    var n = state.confirmations.length;
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n === 0);
    }
    var list = el('confirmations-list');
    if (!list) return;
    if (n === 0) {
      list.innerHTML = '<p class="empty">Aucune confirmation</p>';
      return;
    }
    list.innerHTML = '';
    state.confirmations.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-item';
      btn.innerHTML = '<strong>' + escapeHtml(item.tool || 'outil') + '</strong><small>'
        + escapeHtml(item.summary || item.id) + '</small>';
      btn.addEventListener('click', function () { openConfirmation(item); });
      list.appendChild(btn);
    });
  }

  function queueConfirmation(payload) {
    var item = {
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
    var body = el('confirmation-content');
    if (!body) return;
    body.innerHTML = '<p class="risk-' + escapeHtml(item.risk) + '">' + escapeHtml(item.risk) + '</p>'
      + '<p>' + escapeHtml(item.tool || '') + '</p>'
      + '<p>' + escapeHtml(item.summary || '') + '</p>';
    var dialog = el('confirmation-modal');
    if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
  }

  function answerConfirmation(approved) {
    var id = state.activeConfirmationId;
    if (!id) return;
    send('confirmation_response', { id: id, approved: approved });
    state.confirmations = state.confirmations.filter(function (item) { return item.id !== id; });
    state.activeConfirmationId = null;
    refreshConfirmationBadge();
    var dialog = el('confirmation-modal');
    if (dialog && dialog.open) dialog.close();
  }

  function startDictation() {
    var Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!Rec) {
      addMessage({ role: 'system', text: 'Dictée indisponible sur ce navigateur' });
      return;
    }
    var rec = new Rec();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.onresult = function (event) {
      var text = event.results[0] && event.results[0][0] && event.results[0][0].transcript;
      if (text) {
        var input = el('message-input');
        input.value = (input.value ? input.value + ' ' : '') + text;
        autosizeComposer();
      }
    };
    rec.start();
  }

  function onDocumentClick(event) {
    var picker = el('emoji-picker');
    var emojiBtn = el('emoji-btn');
    if (state.pickerOpen && picker && !picker.contains(event.target) && event.target !== emojiBtn) {
      closeEmojiPicker();
    }
    var bar = el('reaction-bar');
    if (bar && !bar.classList.contains('hidden') && !bar.contains(event.target)) {
      hideReactionBar();
    }
  }

  function onDocumentKey(event) {
    if (event.key === 'Escape') {
      closeEmojiPicker();
      closeLightbox();
      hideReactionBar();
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    if (el('login-form')) el('login-form').addEventListener('submit', login);
    if (el('copy-url-btn')) {
      el('copy-url-btn').addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(location.origin + BASE + '/').catch(function () { /* ignore */ });
        }
      });
    }
    if (el('logout-btn')) el('logout-btn').addEventListener('click', logout);
    if (el('composer')) el('composer').addEventListener('submit', sendChat);
    if (el('stop-btn')) el('stop-btn').addEventListener('click', stopChat);
    if (el('mic-btn')) el('mic-btn').addEventListener('click', startDictation);
    if (el('emoji-btn')) el('emoji-btn').addEventListener('click', toggleEmojiPicker);
    if (el('emoji-search')) {
      el('emoji-search').addEventListener('input', renderEmojiGrid);
    }
    if (el('assistant-btn')) {
      el('assistant-btn').addEventListener('click', function () {
        renderAssistants();
        var dialog = el('assistant-modal');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      });
    }
    if (el('settings-btn')) {
      el('settings-btn').addEventListener('click', function () {
        var dialog = el('settings-modal');
        var confirm = el('clear-chat-confirm');
        if (confirm) confirm.classList.add('hidden');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      });
    }
    if (el('clear-chat-btn')) {
      el('clear-chat-btn').addEventListener('click', function () {
        var confirm = el('clear-chat-confirm');
        if (confirm) confirm.classList.remove('hidden');
      });
    }
    if (el('clear-chat-yes')) {
      el('clear-chat-yes').addEventListener('click', function () {
        clearHistory();
        var confirm = el('clear-chat-confirm');
        if (confirm) confirm.classList.add('hidden');
        var dialog = el('settings-modal');
        if (dialog && dialog.open) dialog.close();
      });
    }
    if (el('clear-chat-no')) {
      el('clear-chat-no').addEventListener('click', function () {
        var confirm = el('clear-chat-confirm');
        if (confirm) confirm.classList.add('hidden');
      });
    }
    if (el('refresh-runs')) el('refresh-runs').addEventListener('click', loadRuns);
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchSection(btn.getAttribute('data-section'));
      });
    });
    if (el('confirm-approve')) {
      el('confirm-approve').addEventListener('click', function (event) {
        event.preventDefault();
        answerConfirmation(true);
      });
    }
    if (el('confirm-deny')) {
      el('confirm-deny').addEventListener('click', function (event) {
        event.preventDefault();
        answerConfirmation(false);
      });
    }
    if (el('message-input')) {
      el('message-input').addEventListener('keydown', handleComposerKey);
      el('message-input').addEventListener('input', autosizeComposer);
    }
    var messages = el('messages');
    if (messages) {
      messages.addEventListener('click', handleBubbleClick);
      messages.addEventListener('pointerdown', handleBubblePointerDown);
      messages.addEventListener('pointerup', handleBubblePointerUp);
      messages.addEventListener('pointercancel', handleBubblePointerUp);
      messages.addEventListener('contextmenu', function (event) {
        var id = rowIdFromEvent(event.target);
        if (!id) return;
        event.preventDefault();
        showReactionBar(id, event.clientX, event.clientY);
      });
      messages.addEventListener('scroll', function () {
        state.atBottom = isNearBottom(messages);
        if (state.atBottom) state.unread = 0;
        updateJumpButton();
      });
    }
    if (el('jump-bottom')) {
      el('jump-bottom').addEventListener('click', function () {
        state.atBottom = true;
        state.unread = 0;
        scrollMessages(true);
      });
    }
    if (el('lightbox')) {
      el('lightbox').addEventListener('click', closeLightbox);
    }
    var reactionBar = el('reaction-bar');
    if (reactionBar) {
      reactionBar.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('.react-btn') : event.target;
        if (!btn || !state.reactionTarget) return;
        if (btn.id === 'copy-msg-btn') {
          copyMessage(state.reactionTarget);
          return;
        }
        var emoji = btn.getAttribute('data-emoji');
        if (emoji) setReaction(state.reactionTarget, emoji);
      });
    }
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKey);
  }

  function destroy() {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKey);
    clearTimeout(state.longPressTimer);
    clearInterval(state.pingTimer);
    state.bound = false;
  }

  function registerServiceWorker() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(function () { /* ignore */ });
  }

  function init() {
    registerServiceWorker();
    bind();
    restoreAvatar();
    state.suggestHidden = storeGet(STORAGE.suggestHidden, false) === true;
    restoreHistory();
    refreshConfirmationBadge();
    refreshSuggestions();
    autosizeComposer();
    setPresence(state.connected ? 'online' : 'offline');
    if (state.token) {
      var tokenInput = el('token-input');
      if (tokenInput) tokenInput.value = state.token;
      connectWs();
    }
  }

  var api = {
    init: init,
    bind: bind,
    state: state,
    STORAGE: STORAGE,
    REACTIONS: REACTIONS,
    DEFAULT_AVATAR: DEFAULT_AVATAR,
    MAX_RECENT: MAX_RECENT,
    MAX_HISTORY: MAX_HISTORY,
    LONG_PRESS_MS: LONG_PRESS_MS,
    searchEmojis: searchEmojis,
    getRecentEmojis: getRecentEmojis,
    rememberEmoji: rememberEmoji,
    insertEmoji: insertEmoji,
    insertAtCursor: insertAtCursor,
    openEmojiPicker: openEmojiPicker,
    closeEmojiPicker: closeEmojiPicker,
    autosizeComposer: autosizeComposer,
    sendChat: sendChat,
    sendText: sendText,
    handleComposerKey: handleComposerKey,
    addMessage: addMessage,
    getMessages: function () { return state.messages.slice(); },
    renderMessages: renderMessages,
    setReaction: setReaction,
    copyMessage: copyMessage,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    handleFrame: handleFrame,
    setPresence: setPresence,
    applyStatusPayload: applyStatusPayload,
    getSuggestions: getSuggestions,
    refreshSuggestions: refreshSuggestions,
    hideSuggestions: hideSuggestions,
    persistHistory: persistHistory,
    restoreHistory: restoreHistory,
    clearHistory: clearHistory,
    showMain: showMain,
    daySeparatorLabel: daySeparatorLabel,
    renderMarkdown: renderMarkdown,
    haptic: haptic,
    pulseSend: pulseSend,
    showReactionBar: showReactionBar,
    destroy: destroy,
  };

  if (root.CodeBuddyMobile && typeof root.CodeBuddyMobile.destroy === 'function') {
    root.CodeBuddyMobile.destroy();
  }
  root.CodeBuddyMobile = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
