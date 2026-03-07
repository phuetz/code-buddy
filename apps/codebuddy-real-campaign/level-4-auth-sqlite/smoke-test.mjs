import request from 'supertest';
import assert from 'assert';
import fs from 'fs';
import { before, after, describe, it, beforeEach, afterEach } from 'mocha';
import { app, closeDb } from './server.mjs'; // Import app and closeDb from server.mjs

// Clean up previous test data
const cleanup = () => {
  try { fs.unlinkSync('database.db.json'); } catch (e) { /* ignore */ }
  try { fs.unlinkSync('database.db.json.tmp'); } catch (e) { /* ignore */ }
};

describe('Task Manager API Smoke Test', () => {
  let agent;

  before(async () => {
    cleanup(); // Clean up before starting tests
    agent = request.agent(app); // Use the imported app instance
  });

  after(() => {
    closeDb(); // Close the database connection after all tests
    cleanup(); // Clean up after tests
  });

  beforeEach(async () => {
    // No specific per-test cleanup needed for this smoke test
    // The global cleanup in before() is sufficient for now
  });

  afterEach(async () => {
    // No specific per-test cleanup needed for this smoke test
  });

  it('should respond to /health', async () => {
    const res = await agent.get('/health');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { status: 'ok' });
  });

  it('should register a new user', async () => {
    const res = await agent.post('/register')
      .send({ username: 'testuser', password: 'password123' });
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.message, 'User registered successfully');
  });

  it('should not register a duplicate user', async () => {
    const res = await agent.post('/register')
      .send({ username: 'testuser', password: 'anotherpassword' });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.message, 'Username already exists');
  });

  it('should login the registered user', async () => {
    const res = await agent.post('/login')
      .send({ username: 'testuser', password: 'password123' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, 'Logged in successfully');

    const sessionRes = await agent.get('/session');
    assert.strictEqual(sessionRes.statusCode, 200);
    assert.strictEqual(sessionRes.body.authenticated, true);
  });

  it('should not login with invalid credentials', async () => {
    const res = await agent.post('/login')
      .send({ username: 'testuser', password: 'wrongpassword' });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.message, 'Invalid credentials');
  });

  it('should create a new task', async () => {
    const res = await agent.post('/tasks')
      .send({ title: 'Buy groceries' });
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.title, 'Buy groceries');
    assert.strictEqual(res.body.completed, 0);
    assert.ok(res.body.id);
  });

  it('should get tasks for the logged-in user', async () => {
    const res = await agent.get('/tasks');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].title, 'Buy groceries');
  });

  it('should update a task', async () => {
    const tasksRes = await agent.get('/tasks');
    const taskId = tasksRes.body[0].id;

    const res = await agent.put(`/tasks/${taskId}`)
      .send({ title: 'Buy groceries and milk', completed: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, 'Task updated successfully');

    const updatedTasksRes = await agent.get('/tasks');
    assert.strictEqual(updatedTasksRes.body[0].title, 'Buy groceries and milk');
    assert.strictEqual(updatedTasksRes.body[0].completed, 1);
  });

  it('should delete a task', async () => {
    const tasksRes = await agent.get('/tasks');
    const taskId = tasksRes.body[0].id;

    const res = await agent.delete(`/tasks/${taskId}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, 'Task deleted successfully');

    const emptyTasksRes = await agent.get('/tasks');
    assert.strictEqual(emptyTasksRes.body.length, 0);
  });

  it('should logout the user', async () => {
    const res = await agent.post('/logout');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, 'Logged out successfully');

    const sessionRes = await agent.get('/session');
    assert.strictEqual(sessionRes.statusCode, 200);
    assert.strictEqual(sessionRes.body.authenticated, false);
  });
});
