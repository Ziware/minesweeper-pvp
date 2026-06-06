#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for the local log viewer.
 *
 * Каждая партия теперь хранится отдельной директорией с двумя файлами:
 *   <session-dir>/meta.json        — полная метаинформация о партии,
 *   <session-dir>/game.log.jsonl   — упрощённые игровые события,
 *   <session-dir>/aux.log.jsonl    — необязательный «вспомогательный» лог
 *                                    (телеметрия бота и т.п., не нужен
 *                                    просмотрщику).
 *
 *   GET /                      → public/index.html
 *   GET /<static-file>         → public/<static-file>
 *   GET /api/sessions          → JSON список сессий (читает meta.json'ы)
 *   GET /api/session/<id>      → { meta, events } для одной сессии
 *
 * Run with:
 *   node server.js              (port 5174 by default)
 *   PORT=5180 node server.js
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT        = parseInt(process.env.PORT || '5174', 10);
const ROOT        = __dirname;
const PUBLIC_DIR  = path.join(ROOT, 'public');
const LOGS_DIR    = path.join(ROOT, 'logs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Найти все session-директории внутри LOGS_DIR. Сессия = любая папка
 * (на любой глубине), где есть meta.json. Рекурсивно — но без захода
 * внутрь самой session-папки.
 */
function findSessionDirs() {
  ensureLogsDir();
  const out = [];
  function visit(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    // Если в текущей папке лежит meta.json — считаем её session-папкой
    // и не идём глубже.
    if (entries.some((e) => e.isFile() && e.name === 'meta.json')) {
      out.push(dir);
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) visit(path.join(dir, e.name));
    }
  }
  visit(LOGS_DIR);
  return out;
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return null; }
}

function summarizeSession(dir) {
  const meta = readJsonSafe(path.join(dir, 'meta.json')) || {};
  const rel  = path.relative(LOGS_DIR, dir);
  const id   = Buffer.from(rel).toString('base64url');
  return {
    id,
    relPath: rel,
    label: rel,
    mode: meta.mode || 'unknown',
    sessionId: meta.sessionId || null,
    startedAt: meta.startedAt || null,
    startedAtLocal: meta.startedAtLocal || null,
    endedAt: meta.endedAt || null,
    endedAtLocal: meta.endedAtLocal || null,
    durationMs: meta.durationMs ?? null,
    players: meta.players || {},
    result: meta.result || null,
    totals: meta.totals || null,
    config: meta.config || null,
  };
}

function listSessions() {
  const dirs = findSessionDirs();
  const sessions = dirs.map(summarizeSession);
  sessions.sort((a, b) => {
    const ta = a.startedAt ? Date.parse(a.startedAt) : 0;
    const tb = b.startedAt ? Date.parse(b.startedAt) : 0;
    return tb - ta;
  });
  return sessions;
}

function readSession(id) {
  let rel;
  try { rel = Buffer.from(id, 'base64url').toString('utf8'); }
  catch (_) { return { error: 'bad id' }; }
  const target = path.resolve(LOGS_DIR, rel);
  if (!target.startsWith(LOGS_DIR + path.sep) && target !== LOGS_DIR) {
    return { error: 'bad path' };
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return { error: 'session not found' };
  }
  const meta = readJsonSafe(path.join(target, 'meta.json'));
  if (!meta) return { error: 'meta.json missing' };

  const events = [];
  const logFile = path.join(target, 'game.log.jsonl');
  if (fs.existsSync(logFile)) {
    const raw = fs.readFileSync(logFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try { events.push(JSON.parse(t)); }
      catch (_) { /* skip malformed lines silently */ }
    }
  }
  return { meta, events };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, mime = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': mime,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendStatic(res, fsPath) {
  fs.stat(fsPath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }
    const ext = path.extname(fsPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(fsPath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method not allowed');
  }

  if (pathname === '/api/sessions') {
    try { return sendJson(res, 200, { sessions: listSessions() }); }
    catch (e) { return sendJson(res, 500, { error: String(e && e.message || e) }); }
  }

  const sessionMatch = pathname.match(/^\/api\/session\/([A-Za-z0-9_\-]+)$/);
  if (sessionMatch) {
    const result = readSession(sessionMatch[1]);
    if (result.error) return sendJson(res, 404, { error: result.error });
    return sendJson(res, 200, result);
  }

  // Static assets from public/.
  let staticPath;
  if (pathname === '/' || pathname === '') {
    staticPath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    const safe = pathname.replace(/^\/+/, '');
    if (safe.includes('..')) return sendText(res, 400, 'Bad path');
    staticPath = path.join(PUBLIC_DIR, safe);
  }
  sendStatic(res, staticPath);
});

server.listen(PORT, () => {
  ensureLogsDir();
  // eslint-disable-next-line no-console
  console.log(`[log-viewer] running at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[log-viewer] drop session directories into ${LOGS_DIR}/`);
});
