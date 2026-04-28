import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { openDb } from './db.js';
import { loadConfig } from './config.js';

export async function startServer(overrides = {}) {
  const cfg = { ...loadConfig(process.env), ...overrides };
  const dbFile = cfg.dataDir === ':memory:' ? ':memory:' : `${cfg.dataDir}/clippinghub.db`;
  const db = openDb(dbFile);
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (ws) => { ws.on('message', () => {}); });

  await new Promise((r) => http.listen(cfg.port, r));
  const port = http.address().port;
  return {
    port,
    close: () => new Promise((r) => {
      wss.close();
      http.close(() => { db.close(); r(); });
    })
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  startServer().then(h => console.log(`listening on :${h.port}`));
}
