#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for the local log viewer.
 *
 *   GET /                  → public/index.html
 *   GET /<static-file>     → public/<static-file>
 *   GET /api/logs          → JSON list of available log files in ./logs
 *   GET /api/log/<name>    → raw text of the log file (jsonl)
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
 * Recursively walk LOGS_DIR and collect any *.jsonl files.
 * Returns array of objects:
 *   { id, label, relPath, size, mtime }
 *
 * `id` is a URL-safe identifier (base64 of relative path) used in the
 * /api/log/<id> endpoint. `label` is a human-friendly name (folder/file).
 */
function listLogs() {
  ensureLogsDir();
  const results = [];

  function visit(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && /\.jsonl$/i.test(entry.name)) {
        const rel = path.relative(LOGS_DIR, full);
        const stat = fs.statSync(full);
        // Label = parent folder name + file name (skip if both equal "logs").
        const parent = path.basename(path.dirname(full));
        const baseLabel = parent === path.basename(LOGS_DIR)
          ? entry.name
          : `${parent}/${entry.name}`;
        results.push({
          id: Buffer.from(rel).toString('base64url'),
          label: baseLabel,
          relPath: rel,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }
    }
  }
  visit(LOGS_DIR);
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
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

  // API: list logs.
  if (pathname === '/api/logs') {
    try {
      return sendJson(res, 200, { logs: listLogs() });
    } catch (e) {
      return sendJson(res, 500, { error: String(e && e.message || e) });
    }
  }

  // API: fetch single log content by id.
  const logMatch = pathname.match(/^\/api\/log\/([A-Za-z0-9_\-]+)$/);
  if (logMatch) {
    let rel;
    try { rel = Buffer.from(logMatch[1], 'base64url').toString('utf8'); }
    catch (_) { return sendText(res, 400, 'Bad id'); }
    // Prevent path traversal.
    const target = path.resolve(LOGS_DIR, rel);
    if (!target.startsWith(LOGS_DIR + path.sep) && target !== LOGS_DIR) {
      return sendText(res, 400, 'Bad path');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return sendText(res, 404, 'Log not found');
    }
    fs.readFile(target, 'utf8', (err, data) => {
      if (err) return sendText(res, 500, String(err));
      return sendText(res, 200, data, 'text/plain; charset=utf-8');
    });
    return;
  }

  // Static assets from public/.
  let staticPath;
  if (pathname === '/' || pathname === '') {
    staticPath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    // Strip leading "/" and disallow ".."
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
  console.log(`[log-viewer] drop *.jsonl logs into ${LOGS_DIR}/`);
});
