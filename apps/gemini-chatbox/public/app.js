const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const messagesEl = document.getElementById('messages');
const statusEl = document.getElementById('status');
const sendBtn = document.getElementById('send-btn');

const history = [];

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(isBusy, text) {
  sendBtn.disabled = isBusy;
  input.disabled = isBusy;
  statusEl.textContent = text;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  setBusy(true, 'Envoi au modèle Gemini...');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    const reply = data.reply || '(Réponse vide)';
    addMessage('assistant', reply);

    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: reply });
    statusEl.textContent = `Réponse reçue (${data.model || 'modèle inconnu'})`;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    addMessage('assistant', `Erreur: ${errorText}`);
    statusEl.textContent = 'Échec de la requête';
  } finally {
    setBusy(false, statusEl.textContent);
    input.focus();
  }
});

addMessage('assistant', 'Bonjour, je suis connecté à Gemini. Pose-moi une question.');
