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
  var MAX_HISTORY = 2000;
  var VIRTUAL_WINDOW = 150;
  var MAX_HISTORY_IMAGES = 5;
  var MAX_IMAGE_CHARS = 100 * 1024;
  // Client-side resize target. The server refuses anything over 600 KB per
  // photo, so the phone shrinks BEFORE sending: a 12 Mpx camera shot is ~4 MB
  // and would simply be rejected.
  var ATTACH_MAX_DIM = 1280;
  var ATTACH_QUALITY = 0.82;
  var ATTACH_MAX_COUNT = 4;
  var ATTACH_MAX_CHARS = 600 * 1024;
  var MAX_AVATAR_CHARS = 200 * 1024;
  var LONG_PRESS_MS = 400;
  var GROUP_MS = 5 * 60 * 1000;
  var LONG_REPLY = 400;

  var STORAGE = {
    recent: 'codebuddy_mobile_emoji_recent',
    avatar: 'codebuddy_mobile_avatar',
    history: 'codebuddy_mobile_history',
    suggestHidden: 'codebuddy_mobile_suggest_hidden',
    pins: 'codebuddy_mobile_pins',
    lastRead: 'codebuddy_mobile_last_read',
    voiceReply: 'codebuddy_mobile_voice_reply',
    theme: 'codebuddy_mobile_theme',
    font: 'codebuddy_mobile_font',
    wallpaper: 'codebuddy_mobile_wallpaper',
    sounds: 'codebuddy_mobile_sounds',
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
    reconnectTimer: 0,
    reconnectAttempt: 0,
    manualClose: false,
    outbox: [],
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
    attachments: [],
    album: [],
    albumLoading: false,
    lightboxAlbumId: '',
    bound: false,
    replyTo: null,
    editOf: null,
    telegramForward: false,
    selectMode: false,
    selected: {},
    pins: [],
    searchOpen: false,
    searchQuery: '',
    searchHits: [],
    searchHit: 0,
    unreadAnchorId: '',
    swipe: null,
    pendingAckId: '',
    voiceReply: false,
    lastUserWasVoice: false,
    recording: null,
    recordTimer: 0,
    recordStartedAt: 0,
    recordCancelled: false,
    lastSeenAt: 0,
    sounds: true,
    mobilePush: false,
    historyLoading: false,
    historyDone: false,
    theme: 'dark',
    font: '2',
    wallpaper: '0',
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

  var OUTBOX_MAX = 5;

  function wsOpen() {
    return Boolean(state.ws && state.ws.readyState === 1);
  }

  function send(type, payload) {
    var frame = { type: type };
    if (payload !== undefined) frame.payload = payload;
    if (type === 'chat' && !wsOpen()) {
      // Serveur redémarré ou téléphone revenu de veille : on garde le message
      // et on le rejoue dès que la connexion est ré-authentifiée.
      state.outbox.push(frame);
      while (state.outbox.length > OUTBOX_MAX) state.outbox.shift();
      ensureConnected();
      return;
    }
    if (!state.ws || state.ws.readyState !== 1) return;
    state.ws.send(JSON.stringify(frame));
  }

  function flushOutbox() {
    if (!wsOpen()) return;
    var pending = state.outbox;
    state.outbox = [];
    pending.forEach(function (frame) {
      state.ws.send(JSON.stringify(frame));
    });
  }

  function reconnectDelayMs() {
    return Math.min(30000, 1000 * Math.pow(2, Math.min(state.reconnectAttempt, 5)));
  }

  function scheduleReconnect() {
    if (state.reconnectTimer || state.manualClose || !state.token) return;
    var delay = reconnectDelayMs();
    state.reconnectAttempt += 1;
    setPresence('reconnecting');
    state.reconnectTimer = setTimeout(function () {
      state.reconnectTimer = 0;
      connectWs();
    }, delay);
  }

  function ensureConnected() {
    if (wsOpen() || state.manualClose || !state.token) return;
    if (state.ws && state.ws.readyState === 0) return; // connexion en cours
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = 0;
    }
    connectWs();
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

  function formatDuration(ms) {
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function voiceCardHtml(msg) {
    var speed = msg.audioSpeed === 1.5 ? '1.5×' : '1×';
    var transcript = msg.transcript
      ? '<details class="voice-transcript"><summary>Transcription</summary>' + escapeHtml(msg.transcript) + '</details>'
      : '';
    return '<div class="voice-card" data-voice="' + escapeHtml(msg.id) + '">' +
      '<button type="button" class="btn icon touch voice-play" data-voice="' + escapeHtml(msg.id) + '" aria-label="Lecture">' +
      (msg.playing ? '⏸' : '▶') + '</button>' +
      '<span class="voice-dur">' + escapeHtml(formatDuration(msg.durationMs)) + '</span>' +
      '<button type="button" class="btn icon touch voice-speed" data-voice="' + escapeHtml(msg.id) + '" aria-label="Vitesse">' +
      speed + '</button>' +
      transcript +
      '</div>';
  }

  function imageHtml(dataUrl) {
    if (!dataUrl) return '';
    return '<img class="bubble-img selfie" alt="Image" src="' + dataUrl + '">';
  }

  function sentImagesHtml(images) {
    if (!images || !images.length) return '';
    var html = '<div class="bubble-photos">';
    var i;
    for (i = 0; i < images.length; i += 1) {
      html += '<img class="bubble-img sent" alt="Photo envoyée" src="' + images[i] + '">';
    }
    return html + '</div>';
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

  function formatFullTime(ts) {
    return new Date(ts).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
    if (msg.ack === 'read' || msg.ack === 'replied') {
      return '<span class="ack read" aria-label="Lu">✓✓</span>';
    }
    if (msg.ack === 'received') {
      return '<span class="ack received" aria-label="Reçu">✓✓</span>';
    }
    return '<span class="ack sent" aria-label="Envoyé">✓</span>';
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
      state.unreadAnchorId = '';
      rememberLastRead();
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
        edited: msg.edited === true,
        pinned: msg.pinned === true,
        durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : undefined,
        transcript: msg.transcript || undefined,
        hasAudio: msg.hasAudio === true,
      };
      if (msg.replyTo && typeof msg.replyTo.id === 'string') {
        copy.replyTo = {
          id: msg.replyTo.id,
          text: String(msg.replyTo.text || '').slice(0, 280),
          role: msg.replyTo.role || '',
        };
      }
      if (msg.image && images < MAX_HISTORY_IMAGES) {
        var clipped = constrainDataUrl(msg.image, MAX_IMAGE_CHARS);
        if (clipped) {
          copy.image = clipped;
          images += 1;
        }
      }
      if (msg.images && msg.images.length && images < MAX_HISTORY_IMAGES) {
        var kept = [];
        msg.images.forEach(function (dataUrl) {
          if (images >= MAX_HISTORY_IMAGES) return;
          var small = constrainDataUrl(dataUrl, MAX_IMAGE_CHARS);
          if (small) {
            kept.push(small);
            images += 1;
          }
        });
        if (kept.length) copy.images = kept;
      }
      return copy;
    });
    if (!storeSet(STORAGE.history, slim)) {
      var withoutImages = slim.map(function (msg) {
        if (!msg.image && !msg.images) return msg;
        return {
          id: msg.id,
          role: msg.role,
          text: msg.text || '',
          ts: msg.ts,
          reaction: msg.reaction || '',
          ack: msg.ack || '',
          edited: msg.edited === true,
          pinned: msg.pinned === true,
          replyTo: msg.replyTo || undefined,
        };
      });
      if (!storeSet(STORAGE.history, withoutImages)) {
        var candidate = withoutImages;
        while (candidate.length > 1) {
          candidate = candidate.slice(Math.ceil(candidate.length / 2));
          if (storeSet(STORAGE.history, candidate)) {
            break;
          }
        }
      }
    }
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
        edited: item.edited === true,
        pinned: item.pinned === true,
        replyTo: item.replyTo && typeof item.replyTo.id === 'string'
          ? { id: item.replyTo.id, text: String(item.replyTo.text || ''), role: item.replyTo.role || '' }
          : null,
        image: typeof item.image === 'string' ? item.image : '',
        images: Array.isArray(item.images)
          ? item.images.filter(function (entry) { return typeof entry === 'string'; })
          : [],
        durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
        transcript: typeof item.transcript === 'string' ? item.transcript : '',
        hasAudio: item.hasAudio === true,
      };
    });
    var storedPins = storeGet(STORAGE.pins, []);
    state.pins = Array.isArray(storedPins)
      ? storedPins.filter(function (id) { return typeof id === 'string'; })
      : [];
    state.messages.forEach(function (msg) {
      if (state.pins.indexOf(msg.id) !== -1) msg.pinned = true;
    });
    var lastRead = storeGet(STORAGE.lastRead, '');
    if (typeof lastRead === 'string' && lastRead) {
      var lastMsg = state.messages[state.messages.length - 1];
      if (lastMsg && lastMsg.id !== lastRead) state.unreadAnchorId = lastRead;
    }
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
    state.pins = [];
    state.selected = {};
    state.unreadAnchorId = '';
    storeSet(STORAGE.history, []);
    storeSet(STORAGE.pins, []);
    storeSet(STORAGE.lastRead, '');
    renderMessages();
    refreshSuggestions();
  }

  function markUserReplied() {
    var i;
    for (i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'user') {
        state.messages[i].ack = 'read';
      } else {
        break;
      }
    }
  }

  function highlightSearch(html) {
    var q = (state.searchQuery || '').trim();
    if (!q) return html;
    var safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return html.replace(new RegExp(safe, 'gi'), function (match) {
        return '<mark class="search-hit">' + match + '</mark>';
      });
    } catch (_err) {
      return html;
    }
  }

  function renderMessages() {
    var box = el('messages');
    if (!box) return;
    var html = [];
    var lastDay = null;
    var now = Date.now();
    var start = Math.max(0, state.messages.length - VIRTUAL_WINDOW);
    var visible = state.messages.slice(start);
    visible.forEach(function (msg, visIndex) {
      var index = start + visIndex;
      var day = startOfDay(msg.ts);
      if (day !== lastDay) {
        html.push('<div class="day-sep">' + escapeHtml(daySeparatorLabel(msg.ts, now)) + '</div>');
        lastDay = day;
      }
      if (
        state.unreadAnchorId &&
        index > 0 &&
        state.messages[index - 1].id === state.unreadAnchorId
      ) {
        html.push('<div class="new-sep" role="separator">nouveaux messages</div>');
      }
      var group = groupingFor(index, state.messages);
      var avatar = '';
      if (msg.role === 'assistant') {
        avatar = '<img class="msg-avatar" alt="" src="' + escapeHtml(state.avatarUrl) + '">';
      }
      var quote = '';
      if (msg.replyTo && msg.replyTo.text) {
        quote = '<button type="button" class="quote-ref" data-quote="' + escapeHtml(msg.replyTo.id || '') +
          '" aria-label="Aller au message cité">' + escapeHtml(String(msg.replyTo.text).slice(0, 140)) + '</button>';
      }
      var body = highlightSearch(quote + renderMarkdown(msg.text || ''));
      if (msg.image) body += imageHtml(msg.image);
      if (msg.images && msg.images.length) body += sentImagesHtml(msg.images);
      if (msg.hasAudio || msg.audioUrl) body += voiceCardHtml(msg);
      var reaction = msg.reaction
        ? '<div class="bubble-reactions">' + escapeHtml(msg.reaction) + '</div>'
        : '';
      var edited = msg.edited ? '<span class="edited-mark">modifié</span>' : '';
      var selected = state.selected[msg.id] ? ' selected' : '';
      var emojiOnly = isEmojiOnly(msg.text) && !msg.hasAudio && !msg.image && !(msg.images && msg.images.length);
      html.push(
        '<div class="msg-row ' + msg.role + ' ' + group + selected + '" data-id="' + escapeHtml(msg.id) + '" data-role="' + escapeHtml(msg.role) + '">' +
          avatar +
          '<div class="bubble ' + msg.role + ' ' + group + (emojiOnly ? ' emoji-only' : '') + '">' +
            '<div class="bubble-body">' + body + '</div>' +
            '<div class="bubble-meta">' + escapeHtml(formatFullTime(msg.ts)) + edited + ackMark(msg) + '</div>' +
            reaction +
          '</div>' +
        '</div>'
      );
    });
    box.innerHTML = html.join('');
    scrollMessages(false);
    renderPinnedBar();
    hydrateLinkPreviews(box);
  }

  function addMessage(partial) {
    var msg = {
      id: partial.id || nextId(),
      role: partial.role || 'assistant',
      text: partial.text || '',
      ts: partial.ts || Date.now(),
      reaction: partial.reaction || '',
      ack: partial.ack || (partial.role === 'user' ? 'sent' : ''),
      edited: partial.edited === true,
      pinned: partial.pinned === true,
      replyTo: partial.replyTo || null,
      durationMs: partial.durationMs || 0,
      transcript: partial.transcript || '',
      hasAudio: partial.hasAudio === true || Boolean(partial.audioUrl),
      audioUrl: partial.audioUrl || '',
      audioSpeed: partial.audioSpeed || 1,
      image: partial.image || '',
      images: partial.images && partial.images.length ? partial.images.slice(0, ATTACH_MAX_COUNT) : [],
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
    updateTabBadge();
    if (msg.role === 'assistant' && document.visibilityState === 'hidden') {
      notifyIncoming();
    }
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
      } else if (kind === 'last-seen') {
        var when = state.lastSeenAt ? formatTime(state.lastSeenAt) : '';
        line.textContent = when ? 'vu à ' + when : 'vu récemment';
      } else if (kind === 'reconnecting') {
        line.textContent = 'reconnexion…';
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
      state.lastSeenAt = Date.now();
      setPresence(state.connected ? 'last-seen' : 'offline');
    }
  }

  function hydrateLinkPreviews(box) {
    if (!box || !state.token) return;
    box.querySelectorAll('.bubble-body a[href^="http"]').forEach(function (anchor) {
      if (anchor.parentNode && anchor.parentNode.querySelector('.link-preview')) return;
      var href = anchor.getAttribute('href');
      if (!href) return;
      fetchJson(BASE + '/link-preview?url=' + encodeURIComponent(href)).then(function (data) {
        if (!data || !data.title) return;
        var card = document.createElement('a');
        card.className = 'link-preview';
        card.href = href;
        card.target = '_blank';
        card.rel = 'noopener';
        card.innerHTML = '<strong>' + escapeHtml(data.title) + '</strong><span>' + escapeHtml(data.description || '') + '</span>';
        if (anchor.parentNode) anchor.parentNode.appendChild(card);
      }).catch(function () { /* ignore */ });
    });
  }

  function isEmojiOnly(text) {
    var t = String(text || '').trim();
    if (!t || t.length > 32) return false;
    try {
      return /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(t) && !/[A-Za-z0-9]/.test(t);
    } catch (_e) {
      return false;
    }
  }

  function applyPrefs() {
    var theme = state.theme || 'dark';
    if (theme === 'auto') {
      theme = (root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-font', String(state.font || '2'));
    var box = el('messages');
    if (box) {
      box.classList.remove('wp-1', 'wp-2', 'wp-3');
      if (state.wallpaper && state.wallpaper !== '0') box.classList.add('wp-' + state.wallpaper);
    }
    var sounds = el('sounds-toggle');
    if (sounds) sounds.checked = state.sounds !== false;
  }

  function setTheme(theme) {
    state.theme = theme;
    storeSet(STORAGE.theme, theme);
    applyPrefs();
  }

  function setFont(size) {
    state.font = String(size);
    storeSet(STORAGE.font, state.font);
    applyPrefs();
  }

  function setWallpaper(id) {
    state.wallpaper = String(id);
    storeSet(STORAGE.wallpaper, state.wallpaper);
    applyPrefs();
  }

  function applyStatusPayload(data) {
    if (!data || typeof data !== 'object') return;
    state.telegramForward = data.telegramForward === true;
    state.mobilePush = data.mobilePush === true;
    if (state.mobilePush) subscribePush();
    var fwd = el('forward-msg-btn');
    if (fwd) fwd.classList.toggle('hidden', !state.telegramForward);
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

  // --- Photos: pick, shrink on the device, preview, send ---------------------

  function attachmentCount() {
    return state.attachments.length;
  }

  /**
   * Shrink a camera photo in the browser. A phone shot is 3-5 MB; the server
   * caps a message photo at 600 KB. Resizing here means the upload is small on
   * a mobile uplink AND the request is never rejected for size.
   */
  function shrinkImageFile(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type || '')) {
        resolve(null);
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, ATTACH_MAX_DIM / Math.max(img.width || 1, img.height || 1));
          var width = Math.max(1, Math.round((img.width || 1) * scale));
          var height = Math.max(1, Math.round((img.height || 1) * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          var dataUrl = canvas.toDataURL('image/jpeg', ATTACH_QUALITY);
          URL.revokeObjectURL(url);
          if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) {
            resolve(null);
            return;
          }
          resolve({ mimeType: 'image/jpeg', dataUrl: dataUrl });
        } catch (_err) {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function renderAttachPreview() {
    var box = el('attach-preview');
    if (!box) return;
    if (!state.attachments.length) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    var html = [];
    state.attachments.forEach(function (item, index) {
      html.push(
        '<span class="attach-thumb">' +
          '<img alt="Photo à envoyer" src="' + item.dataUrl + '">' +
          '<button type="button" class="attach-remove touch" data-index="' + index + '" aria-label="Retirer la photo">✕</button>' +
        '</span>'
      );
    });
    box.innerHTML = html.join('');
    box.classList.remove('hidden');
  }

  function addAttachments(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve(state.attachments.length);
    var room = ATTACH_MAX_COUNT - state.attachments.length;
    if (room <= 0) {
      setError('4 photos au maximum par message.');
      return Promise.resolve(state.attachments.length);
    }
    return Promise.all(list.slice(0, room).map(shrinkImageFile)).then(function (results) {
      results.forEach(function (item) {
        if (!item) return;
        if (byteLen(item.dataUrl) > ATTACH_MAX_CHARS) return;
        state.attachments.push(item);
      });
      renderAttachPreview();
      return state.attachments.length;
    });
  }

  function removeAttachment(index) {
    if (index < 0 || index >= state.attachments.length) return state.attachments.length;
    state.attachments.splice(index, 1);
    renderAttachPreview();
    return state.attachments.length;
  }

  function clearAttachments() {
    state.attachments = [];
    renderAttachPreview();
  }

  function attachmentPayload() {
    return state.attachments.map(function (item) {
      return { mimeType: item.mimeType, data: item.dataUrl.slice(item.dataUrl.indexOf(',') + 1) };
    });
  }

  function openFilePicker() {
    var input = el('attach-input');
    if (input) input.click();
  }

  function currentChatPayload(message, attachments, extras) {
    var payload = { message: message, stream: true, assistant: 'agent' };
    if (state.assistant === 'companion') {
      payload.assistant = 'companion';
      // Photos are a companion gesture: never sent to the agent or a peer.
      if (attachments && attachments.length) payload.attachments = attachments;
    } else if (state.assistant !== 'agent') {
      payload.assistant = 'peer';
      payload.peerId = state.assistant;
    }
    if (extras && extras.clientMsgId) payload.clientMsgId = extras.clientMsgId;
    if (extras && extras.replyTo) {
      payload.replyTo = {
        id: extras.replyTo.id,
        text: String(extras.replyTo.text || '').slice(0, 280),
      };
    }
    if (extras && extras.editOf) payload.editOf = extras.editOf;
    if (extras && typeof extras.durationMs === 'number') payload.durationMs = extras.durationMs;
    if (state.voiceReply) payload.voiceReply = true;
    return payload;
  }

  function sendText(message) {
    var text = String(message || '').trim();
    var photos = state.assistant === 'companion' ? attachmentPayload() : [];
    // A photo alone IS a message — "regarde" is optional.
    if ((!text && !photos.length) || state.streaming) return false;
    state.lastUserWasVoice = false;
    var thumbs = state.attachments.map(function (item) { return item.dataUrl; });
    var outgoing = text || (photos.length > 1 ? 'Regarde ces photos.' : 'Regarde cette photo.');
    var extras = {};
    var outgoingMsg;
    if (state.editOf) {
      var existing = findMessage(state.editOf);
      if (existing && existing.role === 'user') {
        existing.text = text;
        existing.edited = true;
        existing.ts = Date.now();
        existing.ack = 'sent';
        extras.editOf = existing.id;
        extras.clientMsgId = existing.id;
        outgoingMsg = existing;
        persistHistory();
        renderMessages();
      }
      state.editOf = null;
    }
    if (!outgoingMsg) {
      outgoingMsg = addMessage({
        role: 'user',
        text: text,
        ack: 'sent',
        images: photos.length ? thumbs : [],
        replyTo: state.replyTo
          ? { id: state.replyTo.id, text: state.replyTo.text, role: state.replyTo.role }
          : null,
      });
      extras.clientMsgId = outgoingMsg.id;
      if (state.replyTo) extras.replyTo = state.replyTo;
    }
    state.pendingAckId = extras.clientMsgId || '';
    cancelReply();
    var input = el('message-input');
    if (input) {
      input.value = '';
      autosizeComposer();
    }
    pulseSend();
    haptic();
    closeEmojiPicker();
    state.suggestRotate += 1;
    send('chat', currentChatPayload(outgoing, photos, extras));
    if (photos.length) clearAttachments();
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
    state.lightboxAlbumId = '';
    var actions = el('lightbox-actions');
    if (actions) actions.classList.add('hidden');
    var confirmBox = el('album-del-confirm');
    if (confirmBox) confirmBox.classList.add('hidden');
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

  function mergeServerHistory(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    var known = {};
    state.messages.forEach(function (msg) { known[msg.id] = true; });
    var extra = [];
    rows.forEach(function (row) {
      if (!row || known[row.id]) return;
      extra.push({
        id: String(row.id),
        role: row.role === 'user' ? 'user' : 'assistant',
        text: String(row.text || ''),
        ts: typeof row.ts === 'number' ? row.ts : Date.now(),
        ack: '',
        reaction: '',
        edited: false,
        pinned: false,
        replyTo: null,
        image: '',
        images: [],
      });
      known[row.id] = true;
    });
    if (!extra.length) return 0;
    extra.sort(function (a, b) { return a.ts - b.ts; });
    state.messages = extra.concat(state.messages);
    renderMessages();
    return extra.length;
  }

  function loadOlderHistory() {
    if (state.historyLoading || state.historyDone) return Promise.resolve([]);
    state.historyLoading = true;
    var first = state.messages[0];
    var q = first ? ('?before=' + encodeURIComponent(first.id) + '&limit=50') : '?limit=50';
    return fetchJson(BASE + '/history' + q).then(function (data) {
      var rows = data && Array.isArray(data.messages) ? data.messages : [];
      if (!rows.length) state.historyDone = true;
      mergeServerHistory(rows);
      state.historyLoading = false;
      return rows;
    }).catch(function () {
      state.historyLoading = false;
      return [];
    });
  }

  function rememberLastRead() {
    var last = state.messages[state.messages.length - 1];
    if (last) storeSet(STORAGE.lastRead, last.id);
  }

  function scrollToMessage(id) {
    var row = document.querySelector('.msg-row[data-id="' + id + '"]');
    if (!row) return false;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(function () { row.classList.remove('flash'); }, 800);
    return true;
  }

  function renderReplyQuote() {
    var box = el('reply-quote');
    var text = el('reply-quote-text');
    if (!box) return;
    if (!state.replyTo) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    if (text) text.textContent = String(state.replyTo.text || '').slice(0, 140);
  }

  function startReply(id) {
    var msg = findMessage(id);
    if (!msg) return false;
    state.replyTo = { id: msg.id, text: msg.text || '', role: msg.role };
    state.editOf = null;
    renderReplyQuote();
    hideReactionBar();
    var input = el('message-input');
    if (input && input.focus) input.focus();
    return true;
  }

  function cancelReply() {
    state.replyTo = null;
    renderReplyQuote();
  }

  function lastUserMessage() {
    var last = null;
    state.messages.forEach(function (msg) {
      if (msg.role === 'user') last = msg;
    });
    return last;
  }

  function beginEdit(id) {
    var msg = id ? findMessage(id) : lastUserMessage();
    if (!msg || msg.role !== 'user') return false;
    var last = lastUserMessage();
    if (!last || last.id !== msg.id) return false;
    state.editOf = msg.id;
    cancelReply();
    var input = el('message-input');
    if (input) {
      input.value = msg.text || '';
      autosizeComposer();
      if (input.focus) input.focus();
    }
    hideReactionBar();
    return true;
  }

  function deleteForMe(id) {
    state.messages = state.messages.filter(function (msg) { return msg.id !== id; });
    state.pins = state.pins.filter(function (pin) { return pin !== id; });
    delete state.selected[id];
    storeSet(STORAGE.pins, state.pins);
    persistHistory();
    renderMessages();
    hideReactionBar();
    return true;
  }

  function togglePin(id) {
    var msg = findMessage(id);
    if (!msg) return false;
    var idx = state.pins.indexOf(id);
    if (idx === -1) {
      state.pins.push(id);
      msg.pinned = true;
    } else {
      state.pins.splice(idx, 1);
      msg.pinned = false;
    }
    storeSet(STORAGE.pins, state.pins);
    persistHistory();
    renderMessages();
    hideReactionBar();
    return msg.pinned;
  }

  function renderPinnedBar() {
    var bar = el('pinned-bar');
    var label = el('pinned-label');
    var list = el('pinned-list');
    if (!bar) return;
    var pinned = state.messages.filter(function (msg) { return state.pins.indexOf(msg.id) !== -1; });
    bar.classList.toggle('hidden', pinned.length === 0);
    if (label) {
      label.textContent = pinned.length === 1
        ? '1 message épinglé'
        : pinned.length + ' messages épinglés';
    }
    if (!list) return;
    list.innerHTML = '';
    pinned.forEach(function (msg) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pinned-item touch';
      btn.setAttribute('aria-label', 'Aller au message épinglé');
      btn.textContent = (msg.text || '').slice(0, 80) || '(photo)';
      btn.addEventListener('click', function () { scrollToMessage(msg.id); });
      list.appendChild(btn);
    });
  }

  function setSelectMode(on) {
    state.selectMode = Boolean(on);
    if (!state.selectMode) state.selected = {};
    var bar = el('select-bar');
    if (bar) bar.classList.toggle('hidden', !state.selectMode);
    updateSelectCount();
    renderMessages();
    hideReactionBar();
  }

  function updateSelectCount() {
    var n = Object.keys(state.selected).length;
    var count = el('select-count');
    if (count) count.textContent = String(n);
  }

  function toggleSelected(id) {
    if (state.selected[id]) delete state.selected[id];
    else state.selected[id] = true;
    updateSelectCount();
    var row = document.querySelector('.msg-row[data-id="' + id + '"]');
    if (row) row.classList.toggle('selected', Boolean(state.selected[id]));
  }

  function deleteSelected() {
    var ids = Object.keys(state.selected);
    ids.forEach(function (id) { deleteForMe(id); });
    setSelectMode(false);
  }

  function applyAck(ack, clientMsgId) {
    var target = clientMsgId ? findMessage(clientMsgId) : null;
    if (!target && state.pendingAckId) target = findMessage(state.pendingAckId);
    if (!target) {
      var i;
      for (i = state.messages.length - 1; i >= 0; i -= 1) {
        if (state.messages[i].role === 'user') {
          target = state.messages[i];
          break;
        }
      }
    }
    if (!target || target.role !== 'user') return null;
    var rank = { sent: 1, received: 2, read: 3, replied: 3 };
    var next = ack === 'replied' ? 'read' : ack;
    if ((rank[next] || 0) >= (rank[target.ack] || 0)) {
      target.ack = next;
      persistHistory();
      renderMessages();
    }
    return target.ack;
  }

  function searchConversation(query) {
    state.searchQuery = String(query || '');
    var q = state.searchQuery.trim().toLowerCase();
    state.searchHits = [];
    if (q) {
      state.messages.forEach(function (msg) {
        if ((msg.text || '').toLowerCase().indexOf(q) !== -1) state.searchHits.push(msg.id);
      });
    }
    state.searchHit = 0;
    var count = el('search-count');
    if (count) {
      count.textContent = q
        ? (state.searchHits.length ? (state.searchHit + 1) + '/' + state.searchHits.length : '0')
        : '';
    }
    renderMessages();
    if (state.searchHits.length) scrollToMessage(state.searchHits[0]);
    return state.searchHits.slice();
  }

  function gotoSearch(dir) {
    if (!state.searchHits.length) return '';
    state.searchHit = (state.searchHit + dir + state.searchHits.length) % state.searchHits.length;
    var count = el('search-count');
    if (count) count.textContent = (state.searchHit + 1) + '/' + state.searchHits.length;
    var id = state.searchHits[state.searchHit];
    scrollToMessage(id);
    return id;
  }

  function openSearch() {
    state.searchOpen = true;
    var bar = el('search-bar');
    if (bar) bar.classList.remove('hidden');
    var input = el('search-input');
    if (input && input.focus) input.focus();
  }

  function closeSearch() {
    state.searchOpen = false;
    state.searchQuery = '';
    state.searchHits = [];
    var bar = el('search-bar');
    if (bar) bar.classList.add('hidden');
    var input = el('search-input');
    if (input) input.value = '';
    var count = el('search-count');
    if (count) count.textContent = '';
    renderMessages();
  }

  function forwardMessage(id) {
    var msg = findMessage(id);
    if (!msg || !state.telegramForward) return Promise.resolve(false);
    hideReactionBar();
    return fetch(BASE + '/forward', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + state.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: msg.text || '' }),
    }).then(function (res) { return res.ok; }).catch(function () { return false; });
  }

  function updateTabBadge() {
    var n = state.unread || 0;
    document.title = n > 0 ? '(' + n + ') Lisa' : 'Code Buddy Mobile';
    if (navigator.setAppBadge) {
      if (n > 0) navigator.setAppBadge(n).catch(function () { /* ignore */ });
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () { /* ignore */ });
    }
  }

  function notifyIncoming() {
    haptic();
    try { if (navigator.vibrate) navigator.vibrate([40, 30, 40]); } catch (_e) { /* ignore */ }
    if (state.sounds === false) return;
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (_err) { /* ignore */ }
  }

  function subscribePush() {
    if (!state.mobilePush || !navigator.serviceWorker || !root.PushManager) return;
    fetch(BASE + '/push/vapid', { headers: authHeaders() }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (!data || !data.publicKey) return;
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: data.publicKey,
        });
      });
    }).then(function (sub) {
      if (!sub) return;
      return fetch(BASE + '/push/subscribe', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + state.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub),
      });
    }).catch(function () { /* ignore */ });
  }

  function syncKeyboardInset() {
    var vv = root.visualViewport;
    if (!vv) return;
    var inset = Math.max(0, root.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', inset + 'px');
  }

  var VOICE_MAX_MS = 120000;
  var VOICE_MAX_BYTES = 2 * 1024 * 1024;

  function playVoice(id, _auto) {
    var msg = findMessage(id);
    if (!msg || !msg.audioUrl) return false;
    if (state.playingAudio) {
      try { state.playingAudio.pause(); } catch (_e) { /* ignore */ }
    }
    var audio = new Audio(msg.audioUrl);
    audio.playbackRate = msg.audioSpeed === 1.5 ? 1.5 : 1;
    state.playingAudio = audio;
    msg.playing = true;
    renderMessages();
    audio.addEventListener('ended', function () {
      msg.playing = false;
      renderMessages();
    });
    var play = audio.play();
    if (play && play.catch) play.catch(function () { msg.playing = false; });
    return true;
  }

  function toggleVoiceSpeed(id) {
    var msg = findMessage(id);
    if (!msg) return 1;
    msg.audioSpeed = msg.audioSpeed === 1.5 ? 1 : 1.5;
    if (state.playingAudio) state.playingAudio.playbackRate = msg.audioSpeed;
    renderMessages();
    return msg.audioSpeed;
  }

  function sendVoiceData(opts) {
    var mime = opts.mimeType || 'audio/webm';
    var data = opts.data || '';
    var durationMs = Math.min(VOICE_MAX_MS, Math.max(0, opts.durationMs || 0));
    if (!data) return false;
    var approxBytes = Math.floor(data.length * 0.75);
    if (approxBytes > VOICE_MAX_BYTES || durationMs > VOICE_MAX_MS) {
      addMessage({ role: 'system', text: 'Message vocal trop long (2 Mo / 120 s)' });
      return false;
    }
    var transcript = opts.transcript || '';
    var outgoing = transcript || '(message vocal)';
    var audioUrl = 'data:' + mime + ';base64,' + data;
    var msg = addMessage({
      role: 'user',
      text: outgoing,
      ack: 'sent',
      hasAudio: true,
      durationMs: durationMs,
      transcript: transcript,
      audioUrl: audioUrl,
    });
    state.lastUserWasVoice = true;
    state.pendingAckId = msg.id;
    send('chat', currentChatPayload(outgoing, [{ mimeType: mime, data: data }], { clientMsgId: msg.id, durationMs: durationMs }));
    return true;
  }

  function showRecordOverlay(on, cancelling) {
    var box = el('record-overlay');
    if (!box) return;
    box.classList.toggle('hidden', !on);
    box.classList.toggle('cancel', Boolean(cancelling));
  }

  function tickRecordTimer() {
    var label = el('record-timer');
    if (!label || !state.recordStartedAt) return;
    label.textContent = formatDuration(Date.now() - state.recordStartedAt);
  }

  function drawWaveFrame() {
    var rec = state.recording;
    if (!rec || !rec.analyser) return;
    var canvas = el('record-wave');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var data = new Uint8Array(rec.analyser.fftSize);
    rec.analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#f5a623';
    ctx.beginPath();
    var i;
    for (i = 0; i < data.length; i += 1) {
      var x = (i / data.length) * canvas.width;
      var y = (data[i] / 255) * canvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    rec.waveFrame = root.requestAnimationFrame(drawWaveFrame);
  }

  function stopTracks(stream) {
    if (!stream || !stream.getTracks) return;
    stream.getTracks().forEach(function (track) { track.stop(); });
  }

  function cancelVoiceRecord() {
    state.recordCancelled = true;
    if (state.recordTimer) {
      clearInterval(state.recordTimer);
      state.recordTimer = 0;
    }
    var rec = state.recording;
    if (rec) {
      if (rec.waveFrame) root.cancelAnimationFrame(rec.waveFrame);
      try { if (rec.media && rec.media.state === 'recording') rec.media.stop(); } catch (_e) { /* ignore */ }
      stopTracks(rec.stream);
    }
    state.recording = null;
    showRecordOverlay(false, false);
    var mic = el('mic-btn');
    if (mic) mic.setAttribute('aria-pressed', 'false');
  }

  function beginVoiceRecord() {
    if (state.streaming || state.recording) return false;
    var Rec = root.MediaRecorder;
    if (!Rec || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      startDictation();
      return false;
    }
    state.recordCancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (state.recordCancelled) {
        stopTracks(stream);
        return;
      }
      var mime = Rec.isTypeSupported && Rec.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (Rec.isTypeSupported && Rec.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '');
      var media = mime ? new Rec(stream, { mimeType: mime }) : new Rec(stream);
      var chunks = [];
      media.addEventListener('dataavailable', function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      });
      media.addEventListener('stop', function () {
        stopTracks(stream);
        if (state.recordCancelled) return;
        var blob = new Blob(chunks, { type: media.mimeType || 'audio/webm' });
        if (blob.size > VOICE_MAX_BYTES) {
          addMessage({ role: 'system', text: 'Message vocal trop long (2 Mo / 120 s)' });
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var url = String(reader.result || '');
          var comma = url.indexOf(',');
          var data = comma >= 0 ? url.slice(comma + 1) : '';
          sendVoiceData({
            mimeType: blob.type || 'audio/webm',
            data: data,
            durationMs: Date.now() - state.recordStartedAt,
          });
        };
        reader.readAsDataURL(blob);
      });
      var ctx = root.AudioContext || root.webkitAudioContext;
      var analyser = null;
      if (ctx) {
        var ac = new ctx();
        var src = ac.createMediaStreamSource(stream);
        analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
      }
      state.recording = { media: media, stream: stream, analyser: analyser, waveFrame: 0 };
      state.recordStartedAt = Date.now();
      showRecordOverlay(true, false);
      var mic = el('mic-btn');
      if (mic) mic.setAttribute('aria-pressed', 'true');
      media.start(100);
      if (analyser) drawWaveFrame();
      state.recordTimer = setInterval(function () {
        tickRecordTimer();
        if (Date.now() - state.recordStartedAt >= VOICE_MAX_MS) finishVoiceRecord();
      }, 200);
    }).catch(function () {
      startDictation();
    });
    return true;
  }

  function finishVoiceRecord() {
    var rec = state.recording;
    if (!rec) return;
    if (state.recordTimer) {
      clearInterval(state.recordTimer);
      state.recordTimer = 0;
    }
    if (rec.waveFrame) root.cancelAnimationFrame(rec.waveFrame);
    showRecordOverlay(false, false);
    var mic = el('mic-btn');
    if (mic) mic.setAttribute('aria-pressed', 'false');
    try { if (rec.media && rec.media.state === 'recording') rec.media.stop(); } catch (_e) { /* ignore */ }
    state.recording = null;
  }

  function handleMicPointerDown(event) {
    state.recordPointer = { x: event.clientX || 0, y: event.clientY || 0 };
    beginVoiceRecord();
  }

  function handleMicPointerMove(event) {
    if (!state.recording) return;
    var dx = (event.clientX || 0) - (state.recordPointer && state.recordPointer.x || 0);
    var dy = (event.clientY || 0) - (state.recordPointer && state.recordPointer.y || 0);
    var cancel = dy < -56 || dx < -56;
    showRecordOverlay(true, cancel);
    state.recordWillCancel = cancel;
  }

  function handleMicPointerUp() {
    if (state.recordWillCancel) {
      cancelVoiceRecord();
      state.recordWillCancel = false;
      return;
    }
    finishVoiceRecord();
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
    state.swipe = { id: id, x: event.clientX || 0, y: event.clientY || 0, active: false };
    state.longPressTimer = setTimeout(function () {
      state.swipe = null;
      showReactionBar(id, event.clientX, event.clientY);
      var editBtn = el('edit-msg-btn');
      var last = lastUserMessage();
      if (editBtn) editBtn.classList.toggle('hidden', !(last && last.id === id));
    }, LONG_PRESS_MS);
  }

  function handleBubblePointerMove(event) {
    if (!state.swipe) return;
    var dx = (event.clientX || 0) - state.swipe.x;
    if (Math.abs(dx) > 12) clearTimeout(state.longPressTimer);
    if (dx > 24) {
      state.swipe.active = true;
      var row = document.querySelector('.msg-row[data-id="' + state.swipe.id + '"]');
      if (row) row.style.transform = 'translateX(' + Math.min(dx, 72) + 'px)';
    }
  }

  function handleBubblePointerUp(event) {
    clearTimeout(state.longPressTimer);
    if (state.swipe && state.swipe.active && ((event && event.clientX) || 0) - state.swipe.x > 56) {
      startReply(state.swipe.id);
    }
    if (state.swipe) {
      var row = document.querySelector('.msg-row[data-id="' + state.swipe.id + '"]');
      if (row) row.style.transform = '';
    }
    state.swipe = null;
  }

  function handleBubbleClick(event) {
    var playBtn = event.target.closest ? event.target.closest('.voice-play') : null;
    if (playBtn) {
      event.preventDefault();
      playVoice(playBtn.getAttribute('data-voice') || '');
      return;
    }
    var speedBtn = event.target.closest ? event.target.closest('.voice-speed') : null;
    if (speedBtn) {
      event.preventDefault();
      toggleVoiceSpeed(speedBtn.getAttribute('data-voice') || '');
      return;
    }
    var quote = event.target.closest ? event.target.closest('.quote-ref') : null;
    if (quote) {
      event.preventDefault();
      scrollToMessage(quote.getAttribute('data-quote') || '');
      return;
    }
    var img = event.target.closest ? event.target.closest('img.bubble-img, img.selfie') : null;
    if (img && img.src) {
      event.preventDefault();
      openLightbox(img.src);
      return;
    }
    var id = rowIdFromEvent(event.target);
    if (!id) return;
    if (state.selectMode) {
      toggleSelected(id);
      return;
    }
    var now = Date.now();
    if (state.lastTap.id === id && now - state.lastTap.at < 350) {
      showReactionBar(id, event.clientX, event.clientY);
      var editBtn = el('edit-msg-btn');
      var last = lastUserMessage();
      if (editBtn) editBtn.classList.toggle('hidden', !(last && last.id === id));
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
      state.reconnectAttempt = 0;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = 0;
      }
      setDot('ok');
      setPresence('online');
      flushOutbox();
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
    if (type === 'audio') {
      var audioPayload = data.payload || {};
      var mime = typeof audioPayload.mimeType === 'string' ? audioPayload.mimeType : 'audio/ogg';
      var b64 = typeof audioPayload.data === 'string' ? audioPayload.data : '';
      var lastAsst = null;
      var ai;
      for (ai = state.messages.length - 1; ai >= 0; ai -= 1) {
        if (state.messages[ai].role === 'assistant') { lastAsst = state.messages[ai]; break; }
      }
      if (lastAsst && b64) {
        lastAsst.hasAudio = true;
        lastAsst.durationMs = typeof audioPayload.durationMs === 'number' ? audioPayload.durationMs : 0;
        lastAsst.audioUrl = 'data:' + mime + ';base64,' + b64;
        persistHistory();
        renderMessages();
        if (state.lastUserWasVoice) playVoice(lastAsst.id, true);
      }
      return;
    }
    if (type === 'ack') {
      var ackKind = data.payload && data.payload.ack;
      var ackId = data.payload && data.payload.clientMsgId;
      if (typeof ackKind === 'string') applyAck(ackKind, typeof ackId === 'string' ? ackId : '');
      return;
    }
    if (type === 'stream_start') {
      setStreaming(true);
      applyAck('read', state.pendingAckId);
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
    state.manualClose = false;
    if (state.ws && state.ws.close) {
      state.ws.onclose = null;
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
      if (state.ws !== ws) return; // socket remplacé, on l'ignore
      state.connected = false;
      setStreaming(false);
      setPresence('offline');
      setDot('');
      scheduleReconnect();
    });
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(function () {
      if (state.connected) send('ping');
    }, 25000);
  }

  function persistToken(token) {
    state.token = token;
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_err) { /* ignore */ }
    var input = el('token-input');
    if (input) input.value = token;
  }

  function login(event) {
    if (event) event.preventDefault();
    var token = (el('token-input').value || '').trim();
    if (!token) {
      setError('Jeton requis');
      return;
    }
    persistToken(token);
    setError('');
    connectWs();
  }

  function consumeHashToken() {
    var raw = '';
    try { raw = String(location.hash || ''); } catch (_err) { return false; }
    if (raw.charAt(0) === '#') raw = raw.slice(1);
    if (!raw) return false;
    var token = '';
    try {
      token = String(new URLSearchParams(raw).get('token') || '').trim();
    } catch (_err) {
      return false;
    }
    if (!token) return false;
    persistToken(token);
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (_err) { /* ignore */ }
    return true;
  }

  function logout() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_err) { /* ignore */ }
    state.token = '';
    state.manualClose = true;
    state.outbox = [];
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = 0;
    }
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
    if (id === 'album-section') loadAlbum();
  }

  // --- Album: the photos of the two of them, in one grid ---------------------

  function albumUrl(id) {
    return BASE + '/album/' + encodeURIComponent(id);
  }

  /**
   * An album image is served by an AUTHENTICATED route, so it cannot be an
   * `<img src>`: the browser would send no Authorization header. Fetch it and
   * hand the tile an object URL instead.
   */
  function loadAlbumThumb(img, id) {
    fetch(albumUrl(id), { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        img.src = URL.createObjectURL(blob);
      })
      .catch(function () { /* a tile that fails simply stays blank */ });
  }

  function albumDateLabel(iso) {
    var ts = Date.parse(iso);
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  function renderAlbum() {
    var grid = el('album-grid');
    var empty = el('album-empty');
    if (!grid) return;
    grid.innerHTML = '';
    if (empty) empty.classList.toggle('hidden', state.album.length > 0);
    state.album.forEach(function (entry) {
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'album-tile touch' + (entry.kind === 'selfie' ? ' selfie' : '');
      tile.setAttribute('data-id', entry.id);
      tile.setAttribute('data-kind', entry.kind);
      tile.setAttribute(
        'aria-label',
        (entry.kind === 'selfie' ? 'Selfie de Lisa' : 'Photo partagée') +
          (entry.description ? ' — ' + entry.description : ''),
      );
      var img = document.createElement('img');
      img.alt = '';
      tile.appendChild(img);
      var meta = document.createElement('span');
      meta.className = 'album-meta';
      meta.textContent = (entry.favorite ? '❤️ ' : '') + albumDateLabel(entry.at);
      tile.appendChild(meta);
      grid.appendChild(tile);
      loadAlbumThumb(img, entry.id);
    });
  }

  function loadAlbum() {
    if (state.albumLoading) return Promise.resolve(state.album);
    state.albumLoading = true;
    return fetchJson(BASE + '/album')
      .then(function (data) {
        state.album = Array.isArray(data && data.entries) ? data.entries : [];
        renderAlbum();
        return state.album;
      })
      .catch(function () {
        state.album = [];
        renderAlbum();
        return state.album;
      })
      .then(function (value) {
        state.albumLoading = false;
        return value;
      });
  }

  function albumEntry(id) {
    var i;
    for (i = 0; i < state.album.length; i += 1) {
      if (state.album[i].id === id) return state.album[i];
    }
    return null;
  }

  function syncAlbumActions() {
    var actions = el('lightbox-actions');
    var fav = el('album-fav-btn');
    var entry = state.lightboxAlbumId ? albumEntry(state.lightboxAlbumId) : null;
    // Only a shared photo can be favourited or deleted: a selfie belongs to
    // Lisa's rotating cache, not to the album store.
    var editable = Boolean(entry && entry.kind === 'shared');
    if (actions) actions.classList.toggle('hidden', !editable);
    if (fav) fav.textContent = entry && entry.favorite ? '❤️' : '🤍';
    var confirmBox = el('album-del-confirm');
    if (confirmBox) confirmBox.classList.add('hidden');
  }

  function openAlbumEntry(id) {
    var entry = albumEntry(id);
    if (!entry) return;
    state.lightboxAlbumId = id;
    fetch(albumUrl(id), { headers: authHeaders() })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        openLightbox(URL.createObjectURL(blob));
        syncAlbumActions();
      })
      .catch(function () { /* ignore */ });
  }

  function toggleAlbumFavorite() {
    var entry = state.lightboxAlbumId ? albumEntry(state.lightboxAlbumId) : null;
    if (!entry || entry.kind !== 'shared') return Promise.resolve(false);
    var next = !entry.favorite;
    return fetch(albumUrl(entry.id) + '/favorite', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ favorite: next }),
    })
      .then(function (res) { return res.ok; })
      .then(function (ok) {
        if (ok) {
          entry.favorite = next;
          syncAlbumActions();
          renderAlbum();
        }
        return ok;
      })
      .catch(function () { return false; });
  }

  function deleteAlbumEntry() {
    var id = state.lightboxAlbumId;
    var entry = id ? albumEntry(id) : null;
    if (!entry || entry.kind !== 'shared') return Promise.resolve(false);
    return fetch(albumUrl(id), { method: 'DELETE', headers: authHeaders() })
      .then(function (res) { return res.ok; })
      .then(function (ok) {
        if (ok) {
          state.album = state.album.filter(function (item) { return item.id !== id; });
          state.lightboxAlbumId = '';
          closeLightbox();
          renderAlbum();
        }
        return ok;
      })
      .catch(function () { return false; });
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
      var failoverLine = typeof data.failoverNotice === 'string' && data.failoverNotice
        ? '<article class="status-card"><h3>Repli</h3><div>' + escapeHtml(data.failoverNotice) + '</div></article>'
        : '';
      box.innerHTML =
        '<article class="status-card"><h3>Fournisseur</h3><div>' + escapeHtml(provider) + '</div></article>' +
        '<article class="status-card"><h3>Repli (fichier)</h3><div>' + escapeHtml(file) + '</div></article>' +
        '<article class="status-card"><h3>Repli (chaîne)</h3><div>' + escapeHtml(fallback) + '</div></article>' +
        failoverLine +
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
      closeSearch();
      cancelReply();
      if (state.selectMode) setSelectMode(false);
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && !event.altKey && !event.metaKey) {
      var input = el('message-input');
      var onComposer = input && document.activeElement === input && !input.value;
      if (onComposer && beginEdit()) {
        event.preventDefault();
      }
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
    var micBtn = el('mic-btn');
    if (micBtn) {
      var hasSpeech = Boolean(root.SpeechRecognition || root.webkitSpeechRecognition);
      var hasRec = Boolean(root.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      if (!hasSpeech && !hasRec) {
        micBtn.classList.add('hidden');
        micBtn.hidden = true;
      } else {
        micBtn.classList.remove('hidden');
        micBtn.hidden = false;
        if (hasRec) {
          micBtn.addEventListener('pointerdown', handleMicPointerDown);
          micBtn.addEventListener('pointermove', handleMicPointerMove);
          micBtn.addEventListener('pointerup', handleMicPointerUp);
          micBtn.addEventListener('pointercancel', handleMicPointerUp);
          micBtn.addEventListener('click', function (event) { event.preventDefault(); });
        } else {
          micBtn.addEventListener('click', startDictation);
        }
      }
    }
    document.addEventListener('paste', function (event) {
      var files = event.clipboardData && event.clipboardData.files;
      if (files && files.length) {
        event.preventDefault();
        addAttachments(files);
      }
    });
    var chatSection = el('chat-section');
    if (chatSection) {
      chatSection.addEventListener('dragover', function (event) {
        event.preventDefault();
      });
      chatSection.addEventListener('drop', function (event) {
        event.preventDefault();
        var files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) addAttachments(files);
      });
    }
    document.querySelectorAll('.font-size-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setFont(btn.getAttribute('data-font')); });
    });
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setTheme(btn.getAttribute('data-theme')); });
    });
    document.querySelectorAll('.wallpaper-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { setWallpaper(btn.getAttribute('data-wp')); });
    });
    document.querySelectorAll('.tone-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { insertEmoji(btn.textContent || '👋'); });
    });
    if (el('sounds-toggle')) {
      el('sounds-toggle').addEventListener('change', function (event) {
        state.sounds = Boolean(event.target.checked);
        storeSet(STORAGE.sounds, state.sounds);
      });
    }
    if (el('voice-reply-toggle')) {
      el('voice-reply-toggle').addEventListener('change', function (event) {
        state.voiceReply = Boolean(event.target.checked);
        storeSet(STORAGE.voiceReply, state.voiceReply);
      });
    }
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
    if (el('attach-btn')) {
      el('attach-btn').addEventListener('click', openFilePicker);
    }
    if (el('attach-input')) {
      el('attach-input').addEventListener('change', function (event) {
        var input = event.target;
        addAttachments(input.files).then(function () {
          // Reset so re-picking the same file fires `change` again.
          input.value = '';
        });
      });
    }
    if (el('attach-preview')) {
      el('attach-preview').addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('.attach-remove') : null;
        if (!btn) return;
        removeAttachment(Number(btn.getAttribute('data-index')));
      });
    }
    if (el('refresh-album')) {
      el('refresh-album').addEventListener('click', function () { loadAlbum(); });
    }
    if (el('album-grid')) {
      el('album-grid').addEventListener('click', function (event) {
        var tile = event.target.closest ? event.target.closest('.album-tile') : null;
        if (!tile) return;
        openAlbumEntry(tile.getAttribute('data-id'));
      });
    }
    if (el('album-fav-btn')) {
      el('album-fav-btn').addEventListener('click', function (event) {
        event.stopPropagation();
        toggleAlbumFavorite();
      });
    }
    if (el('album-del-btn')) {
      el('album-del-btn').addEventListener('click', function (event) {
        event.stopPropagation();
        var box = el('album-del-confirm');
        if (box) box.classList.remove('hidden');
      });
    }
    if (el('album-del-yes')) {
      el('album-del-yes').addEventListener('click', function (event) {
        event.stopPropagation();
        deleteAlbumEntry();
      });
    }
    if (el('album-del-no')) {
      el('album-del-no').addEventListener('click', function (event) {
        event.stopPropagation();
        var box = el('album-del-confirm');
        if (box) box.classList.add('hidden');
      });
    }
    var messages = el('messages');
    if (messages) {
      messages.addEventListener('click', handleBubbleClick);
      messages.addEventListener('pointerdown', handleBubblePointerDown);
      messages.addEventListener('pointermove', handleBubblePointerMove);
      messages.addEventListener('pointerup', handleBubblePointerUp);
      messages.addEventListener('pointercancel', handleBubblePointerUp);
      messages.addEventListener('contextmenu', function (event) {
        var id = rowIdFromEvent(event.target);
        if (!id) return;
        event.preventDefault();
        showReactionBar(id, event.clientX, event.clientY);
        var editBtn = el('edit-msg-btn');
        var last = lastUserMessage();
        if (editBtn) editBtn.classList.toggle('hidden', !(last && last.id === id));
      });
      messages.addEventListener('scroll', function () {
        state.atBottom = isNearBottom(messages);
        if (state.atBottom) {
          state.unread = 0;
          state.unreadAnchorId = '';
          rememberLastRead();
          updateTabBadge();
        }
        if (messages.scrollTop < 48) loadOlderHistory();
        try { sessionStorage.setItem('codebuddy_mobile_scroll', String(messages.scrollTop)); } catch (_e) { /* ignore */ }
        updateJumpButton();
      });
    }
    if (el('search-btn')) el('search-btn').addEventListener('click', openSearch);
    if (el('search-close')) el('search-close').addEventListener('click', closeSearch);
    if (el('search-input')) {
      el('search-input').addEventListener('input', function (event) {
        searchConversation(event.target.value);
      });
    }
    if (el('search-prev')) el('search-prev').addEventListener('click', function () { gotoSearch(-1); });
    if (el('search-next')) el('search-next').addEventListener('click', function () { gotoSearch(1); });
    if (el('reply-quote-close')) el('reply-quote-close').addEventListener('click', cancelReply);
    if (el('reply-quote-jump')) {
      el('reply-quote-jump').addEventListener('click', function () {
        if (state.replyTo) scrollToMessage(state.replyTo.id);
      });
    }
    if (el('select-cancel')) el('select-cancel').addEventListener('click', function () { setSelectMode(false); });
    if (el('select-delete')) el('select-delete').addEventListener('click', deleteSelected);
    if (el('pinned-toggle')) {
      el('pinned-toggle').addEventListener('click', function () {
        var list = el('pinned-list');
        if (!list) return;
        var open = list.classList.toggle('hidden') === false;
        el('pinned-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
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
      el('lightbox').addEventListener('click', function (event) {
        var inActions = event.target.closest
          ? event.target.closest('.lightbox-actions, .album-del-confirm')
          : null;
        if (inActions) return;
        closeLightbox();
      });
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
        if (btn.id === 'reply-msg-btn') {
          startReply(state.reactionTarget);
          return;
        }
        if (btn.id === 'forward-msg-btn') {
          forwardMessage(state.reactionTarget);
          return;
        }
        if (btn.id === 'pin-msg-btn') {
          togglePin(state.reactionTarget);
          return;
        }
        if (btn.id === 'edit-msg-btn') {
          beginEdit(state.reactionTarget);
          return;
        }
        if (btn.id === 'delete-msg-btn') {
          deleteForMe(state.reactionTarget);
          return;
        }
        if (btn.id === 'select-msg-btn') {
          setSelectMode(true);
          toggleSelected(state.reactionTarget);
          return;
        }
        var emoji = btn.getAttribute('data-emoji');
        if (emoji) setReaction(state.reactionTarget, emoji);
      });
    }
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKey);
    if (root.visualViewport) {
      root.visualViewport.addEventListener('resize', syncKeyboardInset);
      root.visualViewport.addEventListener('scroll', syncKeyboardInset);
      syncKeyboardInset();
    }
  }

  function onVisibilityOrOnline() {
    if (document.visibilityState === 'hidden') {
      var last = state.messages[state.messages.length - 1];
      if (last && !state.atBottom) state.unreadAnchorId = last.id;
      else if (last) rememberLastRead();
      return;
    }
    ensureConnected();
  }

  function destroy() {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKey);
    document.removeEventListener('visibilitychange', onVisibilityOrOnline);
    root.removeEventListener('online', onVisibilityOrOnline);
    clearTimeout(state.longPressTimer);
    clearInterval(state.pingTimer);
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
    state.bound = false;
  }

  function registerServiceWorker() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.register(BASE + '/sw.js', { scope: BASE + '/' }).catch(function () { /* ignore */ });
  }

  function init() {
    registerServiceWorker();
    bind();
    document.addEventListener('visibilitychange', onVisibilityOrOnline);
    root.addEventListener('online', onVisibilityOrOnline);
    restoreAvatar();
    state.suggestHidden = storeGet(STORAGE.suggestHidden, false) === true;
    state.voiceReply = storeGet(STORAGE.voiceReply, false) === true;
    state.theme = storeGet(STORAGE.theme, 'dark') || 'dark';
    state.font = String(storeGet(STORAGE.font, '2') || '2');
    state.wallpaper = String(storeGet(STORAGE.wallpaper, '0') || '0');
    var soundsPref = storeGet(STORAGE.sounds, true);
    state.sounds = soundsPref !== false;
    applyPrefs();
    var voiceToggle = el('voice-reply-toggle');
    if (voiceToggle) voiceToggle.checked = state.voiceReply;
    restoreHistory();
    var savedScroll = 0;
    try { savedScroll = Number(sessionStorage.getItem('codebuddy_mobile_scroll') || 0); } catch (_e) { savedScroll = 0; }
    if (savedScroll > 0) {
      var box = el('messages');
      if (box) box.scrollTop = savedScroll;
    }
    refreshConfirmationBadge();
    refreshSuggestions();
    autosizeComposer();
    setPresence(state.connected ? 'online' : 'offline');
    consumeHashToken();
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
    startReply: startReply,
    cancelReply: cancelReply,
    beginEdit: beginEdit,
    deleteForMe: deleteForMe,
    togglePin: togglePin,
    searchConversation: searchConversation,
    gotoSearch: gotoSearch,
    openSearch: openSearch,
    closeSearch: closeSearch,
    setSelectMode: setSelectMode,
    toggleSelected: toggleSelected,
    deleteSelected: deleteSelected,
    applyAck: applyAck,
    forwardMessage: forwardMessage,
    scrollToMessage: scrollToMessage,
    formatTime: formatTime,
    formatFullTime: formatFullTime,
    handleBubblePointerDown: handleBubblePointerDown,
    handleBubblePointerMove: handleBubblePointerMove,
    handleBubblePointerUp: handleBubblePointerUp,
    sendVoiceData: sendVoiceData,
    beginVoiceRecord: beginVoiceRecord,
    cancelVoiceRecord: cancelVoiceRecord,
    finishVoiceRecord: finishVoiceRecord,
    playVoice: playVoice,
    toggleVoiceSpeed: toggleVoiceSpeed,
    formatDuration: formatDuration,
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
    ATTACH_MAX_COUNT: ATTACH_MAX_COUNT,
    ATTACH_MAX_DIM: ATTACH_MAX_DIM,
    ATTACH_MAX_CHARS: ATTACH_MAX_CHARS,
    addAttachments: addAttachments,
    removeAttachment: removeAttachment,
    clearAttachments: clearAttachments,
    attachmentCount: attachmentCount,
    attachmentPayload: attachmentPayload,
    renderAttachPreview: renderAttachPreview,
    currentChatPayload: currentChatPayload,
    loadAlbum: loadAlbum,
    renderAlbum: renderAlbum,
    openAlbumEntry: openAlbumEntry,
    toggleAlbumFavorite: toggleAlbumFavorite,
    deleteAlbumEntry: deleteAlbumEntry,
    getAlbum: function () { return state.album.slice(); },
    setAlbum: function (entries) { state.album = entries.slice(); renderAlbum(); },
    syncAlbumActions: syncAlbumActions,
    connectWs: connectWs,
    logout: logout,
    ensureConnected: ensureConnected,
    scheduleReconnect: scheduleReconnect,
    reconnectDelayMs: reconnectDelayMs,
    flushOutbox: flushOutbox,
    updateTabBadge: updateTabBadge,
    notifyIncoming: notifyIncoming,
    subscribePush: subscribePush,
    loadOlderHistory: loadOlderHistory,
    mergeServerHistory: mergeServerHistory,
    applyPrefs: applyPrefs,
    setTheme: setTheme,
    setFont: setFont,
    setWallpaper: setWallpaper,
    isEmojiOnly: isEmojiOnly,
    VIRTUAL_WINDOW: VIRTUAL_WINDOW,
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
