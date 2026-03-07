echo "require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('frontend')); // Serve frontend files

// Configuration de l'API Gemini
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error(\"Erreur: Clé API Gemini non configurée. Veuillez définir GOOGLE_API_KEY ou GEMINI_API_KEY dans votre fichier .env.\");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: \"gemini-pro\"});

// Endpoint de santé
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Endpoint de chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Le message est vide.' });
  }

  try {
    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();
    res.json({ reply: text });
  } catch (error) {
    console.error('Erreur lors de l\\\'appel à l\\\'API Gemini:', error);
    res.status(500).json({ error: 'Erreur interne du serveur lors de la communication avec l\\\'API Gemini.' });
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});" > backend/server.js