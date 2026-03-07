import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'database.db.json');
const app = express();
const PORT = Number(process.env.PORT || 3000);

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      counters: {
        userId: Number(parsed?.counters?.userId || 1),
        taskId: Number(parsed?.counters?.taskId || 1),
      },
    };
  } catch {
    return {
      users: [],
      tasks: [],
      counters: { userId: 1, taskId: 1 },
    };
  }
}

let store = loadStore();

function persistStore() {
  const tempPath = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tempPath, DATA_FILE);
}

export const closeDb = () => {
  // No database handle to close in file-backed mode.
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  }),
);

const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
    return;
  }
  res.status(401).json({ message: 'Unauthorized' });
};

const validateInput = (data, fields) => {
  for (const field of fields) {
    if (!data[field] || typeof data[field] !== 'string' || data[field].trim() === '') {
      return `Missing or invalid field: ${field}`;
    }
  }
  return null;
};

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/register', async (req, res) => {
  const validationError = validateInput(req.body, ['username', 'password']);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const username = req.body.username.trim();
  const password = req.body.password;
  const existing = store.users.find((user) => user.username === username);
  if (existing) {
    res.status(409).json({ message: 'Username already exists' });
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: store.counters.userId++,
      username,
      password: hashedPassword,
    };
    store.users.push(newUser);
    persistStore();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  const validationError = validateInput(req.body, ['username', 'password']);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const username = req.body.username.trim();
  const password = req.body.password;
  const user = store.users.find((entry) => entry.username === username);

  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  try {
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ message: 'Invalid credentials' });
      return;
    }

    req.session.userId = user.id;
    res.status(200).json({ message: 'Logged in successfully' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/logout', isAuthenticated, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ message: 'Could not log out' });
      return;
    }
    res.clearCookie('connect.sid');
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

app.get('/session', (req, res) => {
  if (req.session.userId) {
    res.status(200).json({ authenticated: true, userId: req.session.userId });
    return;
  }
  res.status(200).json({ authenticated: false });
});

app.post('/tasks', isAuthenticated, (req, res) => {
  const validationError = validateInput(req.body, ['title']);
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const title = req.body.title.trim();
  const task = {
    id: store.counters.taskId++,
    userId: req.session.userId,
    title,
    completed: 0,
  };
  store.tasks.push(task);
  persistStore();
  res.status(201).json({ id: task.id, title: task.title, completed: task.completed });
});

app.get('/tasks', isAuthenticated, (req, res) => {
  const userTasks = store.tasks
    .filter((task) => task.userId === req.session.userId)
    .map((task) => ({ id: task.id, title: task.title, completed: task.completed }));
  res.status(200).json(userTasks);
});

app.put('/tasks/:id', isAuthenticated, (req, res) => {
  const { title, completed } = req.body;
  if (typeof title !== 'string' || title.trim() === '') {
    res.status(400).json({ message: 'Invalid title' });
    return;
  }
  if (typeof completed !== 'boolean') {
    res.status(400).json({ message: 'Invalid completed status' });
    return;
  }

  const taskId = Number(req.params.id);
  const task = store.tasks.find(
    (entry) => entry.id === taskId && entry.userId === req.session.userId,
  );
  if (!task) {
    res.status(404).json({ message: 'Task not found or not authorized' });
    return;
  }

  task.title = title.trim();
  task.completed = completed ? 1 : 0;
  persistStore();
  res.status(200).json({ message: 'Task updated successfully' });
});

app.delete('/tasks/:id', isAuthenticated, (req, res) => {
  const taskId = Number(req.params.id);
  const index = store.tasks.findIndex(
    (entry) => entry.id === taskId && entry.userId === req.session.userId,
  );
  if (index < 0) {
    res.status(404).json({ message: 'Task not found or not authorized' });
    return;
  }

  store.tasks.splice(index, 1);
  persistStore();
  res.status(200).json({ message: 'Task deleted successfully' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  app.listen(PORT, () => {
    console.log(`Task manager listening on http://localhost:${PORT}`);
  });
}

export { app };
