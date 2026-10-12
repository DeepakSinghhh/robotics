#!/usr/bin/env node
// DRONA unit server: zero-dependency static hosting + REST API over a JSON datastore.
// Run on one laptop; trainees on the same LAN open http://<host>:8080 in any browser.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { FileStore, sessionsCsv } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const MAX_BODY = 8 * 1024 * 1024;

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(publicDir, urlPath, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(publicDir, `.${rel}`);
  if (!file.startsWith(publicDir + path.sep) && file !== publicDir) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

export function createServer({ dataDir = path.join(ROOT, 'data'), publicDir = path.join(ROOT, 'public'), quiet = false } = {}) {
  const store = new FileStore(dataDir);
  const pub = path.resolve(publicDir);

  const api = async (req, res, url) => {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const q = Object.fromEntries(url.searchParams);
    const m = req.method;
    const body = m === 'POST' || m === 'PUT' ? await readBody(req) : null;
    const [res0, id] = parts;

    if (res0 === 'health') return send(res, 200, { ok: true, app: 'DRONA', version: VERSION, mode: 'server', host: os.hostname() });

    if (res0 === 'units') {
      if (m === 'GET') return send(res, 200, store.listUnits());
      if (m === 'POST') {
        if (!body.name) return send(res, 400, { error: 'name required' });
        return send(res, 201, store.createUnit(body));
      }
    }

    if (res0 === 'trainees') {
      if (!id && m === 'GET') return send(res, 200, store.listTrainees(q.unitId));
      if (!id && m === 'POST') {
        if (!body.name) return send(res, 400, { error: 'name required' });
        return send(res, 201, store.createTrainee(body));
      }
      if (id && m === 'GET') {
        const t = store.getTrainee(id);
        return t ? send(res, 200, t) : send(res, 404, { error: 'not found' });
      }
      if (id && m === 'PUT') {
        const t = store.updateTrainee(id, body);
        return t ? send(res, 200, t) : send(res, 404, { error: 'not found' });
      }
    }

    if (res0 === 'sessions') {
      if (!id && m === 'GET') return send(res, 200, store.listSessions({ traineeId: q.traineeId, unitId: q.unitId, limit: q.limit ? Number(q.limit) : undefined }));
      if (!id && m === 'POST') {
        if (!body.traineeId) return send(res, 400, { error: 'traineeId required' });
        return send(res, 201, await store.saveSession(body));
      }
      if (id && m === 'GET') {
        const s = store.getSession(id);
        return s ? send(res, 200, s) : send(res, 404, { error: 'not found' });
      }
    }

    if (res0 === 'scenarios') {
      if (!id && m === 'GET') return send(res, 200, store.listScenarios());
      if (!id && m === 'POST') {
        if (!body.name || !Array.isArray(body.waves)) return send(res, 400, { error: 'name and waves required' });
        return send(res, 201, store.saveScenario(body));
      }
      if (id && m === 'DELETE') return send(res, store.deleteScenario(id) ? 200 : 404, { ok: true });
    }

    if (res0 === 'export' && id === 'sessions.csv' && m === 'GET') {
      const csv = sessionsCsv(store.listSessions({ unitId: q.unitId, traineeId: q.traineeId }), store.listTrainees(), store.listUnits());
      return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="drona-sessions.csv"' });
    }

    return send(res, 404, { error: 'unknown endpoint' });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const started = Date.now();
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(pub, url.pathname, res);
      else send(res, 405, 'Method not allowed');
    } catch (err) {
      send(res, err.status || 500, { error: err.message || 'server error' });
    }
    if (!quiet && url.pathname.startsWith('/api/')) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  });
  server.store = store;
  return server;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = process.env.DRONA_DATA ? path.resolve(process.env.DRONA_DATA) : path.join(ROOT, 'data');
  const server = createServer({ dataDir });
  // Free cloud hosts often wipe the disk on restart. DRONA_SEED_DEMO=1 reloads the
  // demo unit whenever the datastore starts empty.
  if (process.env.DRONA_SEED_DEMO === '1' && server.store.listUnits().length === 0) {
    const { seedDemo, fileStoreAdapter } = await import('../public/js/ai/demo.js');
    const res = await seedDemo(fileStoreAdapter(server.store), { perTrainee: Number(process.env.DRONA_SEED_SESSIONS) || 6 });
    await server.store.save();
    console.log(`  Seeded demo unit: ${res.sessions} sessions`);
  }
  server.listen(port, host, () => {
    console.log(`\n  DRONA v${VERSION} — C-UAS Threat Simulation Trainer`);
    console.log(`  Local:   http://localhost:${port}`);
    for (const a of lanAddresses()) console.log(`  LAN:     http://${a}:${port}   (share with trainees)`);
    console.log(`  Data:    ${dataDir}\n`);
  });
}
