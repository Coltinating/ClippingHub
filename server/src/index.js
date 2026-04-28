import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { loadConfig } from './config.js';
import { LobbyStore } from './lobby-store.js';
import { Presence } from './presence.js';
import { makeRouter } from './wire/router.js';
import { makeLogger } from './log.js';
import * as auth from './handlers/auth.js';
import * as chat from './handlers/chat.js';
import * as roles from './handlers/roles.js';
import * as clips from './handlers/clips.js';
import * as transcription from './handlers/transcription.js';
import * as admin from './handlers/admin.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function startServer(overrides = {}) {
  const cfg = { ...loadConfig(process.env), ...overrides };
  const dbFile = cfg.dataDir === ':memory:' ? ':memory:' : `${cfg.dataDir}/clippinghub.db`;
  const db = openDb(dbFile);
  const logger = makeLogger(cfg.logLevel);
  const store = new LobbyStore(db);
  const presence = new Presence();

  const handlers = {
    hello: auth.hello,
    'lobby:create': auth.lobbyCreate,
    'lobby:join':   auth.lobbyJoin,
    'lobby:leave':  auth.lobbyLeave,
    'chat:send':    chat.chatSend,
    'member:set-role':       roles.setRole,
    'member:set-assist':     roles.setAssist,
    'clip:upsert-range':     clips.upsertRange,
    'clip:remove-range':     clips.removeRange,
    'clip:delivery-create':  clips.deliveryCreate,
    'clip:delivery-consume': clips.deliveryConsume,
    'transcript:start': transcription.start,
    'transcript:stop':  transcription.stop,
    'admin:list-lobbies': admin.listLobbies,
    'admin:send-chat':    admin.sendChat,
    'ping': ({ ws, send }) => send(ws, { type: 'pong' })
  };
  const router = makeRouter({ store, presence, handlers, logger });

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Admin web panel — static files served from src/admin/public.
  app.use('/admin', express.static(join(here, 'admin', 'public')));

  const http = createServer(app);
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => router.onMessage(ws, raw));
    ws.on('close',   () => router.onClose(ws));
    ws.on('error',   (e) => logger.warn({ err: e.message }, 'ws error'));
  });

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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(h => console.log(`listening on :${h.port}`));
}
