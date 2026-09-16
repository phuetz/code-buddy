#!/usr/bin/env node
/**
 * GK21 mini app — one process, no extra deps.
 * Pages: form + voluntary console.error + a button that navigates.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error('PORT must be a positive integer');
  process.exit(1);
}

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveFile(res, rel) {
  const filePath = path.join(publicDir, rel);
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, 'forbidden', 'text/plain');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'not found', 'text/plain');
      return;
    }
    const ext = path.extname(filePath);
    const type =
      ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'text/plain';
    send(res, 200, data, type);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  console.log(`GK21 hit ${req.method} ${url.pathname}${url.search}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    serveFile(res, 'index.html');
    return;
  }
  if (url.pathname === '/about.html' || url.pathname === '/about') {
    serveFile(res, 'about.html');
    return;
  }
  if (url.pathname === '/greet') {
    const name = (url.searchParams.get('name') || '').trim() || 'anonyme';
    send(
      res,
      200,
      `<!doctype html><title>Hello</title><h1 id="hello">Hello ${name}</h1><p>Form received.</p>`,
    );
    return;
  }
  send(res, 404, 'not found', 'text/plain');
});

server.listen(port, host, () => {
  console.log(`GK21 listening on http://${host}:${port}/`);
});
