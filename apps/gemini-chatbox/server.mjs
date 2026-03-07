import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const repoEnvPath = path.resolve(__dirname, '..', '..', '.env');
const cwdEnvPath = path.resolve(process.cwd(), '.env');

dotenv.config({ path: repoEnvPath });
dotenv.config({ path: cwdEnvPath, override: false });

const PORT = Number(process.env.CHATBOX_PORT || 3333);
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((item) => item && typeof item.role === 'string' && typeof item.content === 'string')
    .map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content.slice(0, 4000) }],
    }))
    .slice(-20);
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    apiConfigured: Boolean(GEMINI_API_KEY),
  });
});

app.post('/api/chat', async (req, res) => {
  if (!GEMINI_API_KEY) {
    res.status(500).json({
      error: 'Gemini API key missing. Set GOOGLE_API_KEY or GEMINI_API_KEY in .env',
    });
    return;
  }

  const { message, history } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'message must be a non-empty string' });
    return;
  }

  const contents = [
    ...normalizeHistory(history),
    { role: 'user', parts: [{ text: message.slice(0, 4000) }] },
  ];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 700,
          },
        }),
      },
    );

    if (!response.ok) {
      const details = await response.text();
      res.status(response.status).json({
        error: 'Gemini API request failed',
        details: details.slice(0, 800),
      });
      return;
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || '')
        .join('')
        .trim() || '';

    if (!text) {
      res.status(502).json({
        error: 'Gemini returned no text response',
        raw: data,
      });
      return;
    }

    res.json({ reply: text, model: GEMINI_MODEL });
  } catch (error) {
    res.status(500).json({
      error: 'Unexpected server error while calling Gemini',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Gemini Chatbox running on http://localhost:${PORT}`);
});
