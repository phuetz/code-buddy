import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';

const app = express();
const port = 3001;

// Configure lowdb to write to JSONFile
const adapter = new JSONFile('db.json');
const db = new Low(adapter, { notes: [] });

// Read data from db.json, this will set db.data content
await db.read();

app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Get all notes
app.get('/api/notes', (req, res) => {
  res.json(db.data.notes);
});

// Get a single note by ID
app.get('/api/notes/:id', (req, res) => {
  const note = db.data.notes.find(n => n.id === req.params.id);
  if (note) {
    res.json(note);
  } else {
    res.status(404).send('Note not found');
  }
});

// Add a new note
app.post('/api/notes', async (req, res) => {
  const newNote = { id: nanoid(), content: req.body.content };
  db.data.notes.push(newNote);
  await db.write();
  res.status(201).json(newNote);
});

// Update a note
app.put('/api/notes/:id', async (req, res) => {
  const index = db.data.notes.findIndex(n => n.id === req.params.id);
  if (index !== -1) {
    db.data.notes[index].content = req.body.content;
    await db.write();
    res.json(db.data.notes[index]);
  } else {
    res.status(404).send('Note not found');
  }
});

// Delete a note
app.delete('/api/notes/:id', async (req, res) => {
  const initialLength = db.data.notes.length;
  db.data.notes = db.data.notes.filter(n => n.id !== req.params.id);
  if (db.data.notes.length < initialLength) {
    await db.write();
    res.status(204).send();
  } else {
    res.status(404).send('Note not found');
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});