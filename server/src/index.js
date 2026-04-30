import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
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

// Load server/.env into process.env if it exists.
function loadEnvFileIfPresent() {
  const candidates = [
    resolve(here, '..', '.env'),
    resolve(process.cwd(), '.env')
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try { process.loadEnvFile(p); break; }
    catch (e) {
      console.warn(`[env] failed to parse ${p}: ${e.message}`);
    }
  }
}

export async function startServer(overrides = {}) {
  loadEnvFileIfPresent();
  const cfg = { ...loadConfig(process.env), ...overrides };
  console.log('Environment check - ADMIN_TOKEN present:', !!process.env.ADMIN_TOKEN);
  if (process.env.ADMIN_TOKEN) {
  console.log('ADMIN_TOKEN length:', process.env.ADMIN_TOKEN.length);
  }
  const dbFile = cfg.dataDir === ':memory:' ? ':memory:' : `${cfg.dataDir}/clippinghub.db`;
  const db = openDb(dbFile);
  const logger = makeLogger(cfg.logLevel);
  const store = new LobbyStore(db);
  const presence = new Presence();
  const handlers = {
    hello: auth.hello,
    'lobby:create': auth.lobbyCreate,
    'lobby:join': auth.lobbyJoin,
    'lobby:leave': auth.lobbyLeave,
    'profile:update': auth.profileUpdate,
    'chat:send': chat.chatSend,
    'member:set-role': roles.setRole,
    'member:set-assist': roles.setAssist,
    'clip:upsert-range': clips.upsertRange,
    'clip:remove-range': clips.removeRange,
    'clip:delivery-create': clips.deliveryCreate,
    'clip:delivery-consume': clips.deliveryConsume,
    'transcript:start': transcription.start,
    'transcript:stop': transcription.stop,
    'admin:list-lobbies': admin.listLobbies,
    'admin:send-chat': admin.sendChat,
    'admin:delete-lobby': admin.deleteLobby,
    'admin:subscribe-events': admin.subscribeEventsHandler,
    'admin:unsubscribe-events': admin.unsubscribeEventsHandler,
    'ping': ({ ws, send }) => send(ws, { type: 'pong' })
  };
  const router = makeRouter({ store, presence, handlers, logger });
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  // Admin web panel — static files served from src/admin/public.
  app.use('/admin', express.static(join(here, 'admin', 'public')));

  const http = createServer(app);

  // 1 MB per-frame cap
  const wss = new WebSocketServer({ 
    server: http, 
    path: '/ws', 
    maxPayload: 1024 * 1024 
  });

  // Per-connection inbound rate limiter
  const RATE_MAX = 60;
  const RATE_OVERFLOW_KILL_SEC = 3;

  wss.on('connection', (ws) => {
    let windowStart = Date.now();
    let count = 0;
    let overflowSeconds = 0;

    ws.on('message', (raw) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        if (count > RATE_MAX) {
          overflowSeconds += 1;
          if (overflowSeconds >= RATE_OVERFLOW_KILL_SEC) {
            logger.warn({ evt: 'ws:rate-kill', overflowSeconds });
            try { ws.close(1008, 'rate limit'); } catch {}
            return;
          }
        } else {
          overflowSeconds = 0;
        }
        windowStart = now;
        count = 0;
      }
      count += 1;
      if (count > RATE_MAX) {
        if (count === RATE_MAX + 1) {
          logger.warn({ evt: 'ws:rate-drop', max: RATE_MAX });
        }
        return;
      }
      router.onMessage(ws, raw);
    });

    ws.on('close', () => { 
      admin.detachAdminSubscription(ws); 
      router.onClose(ws); 
    });
    ws.on('error', (e) => logger.warn({ evt: 'ws:error', err: e.message }));
  });

  // FIXED: Listen on 0.0.0.0 + use Render's PORT
  const port = parseInt(process.env.PORT) || cfg.port || 10000;
  await new Promise((resolve) => {
    http.listen(port, "0.0.0.0", () => {
      console.log(`listening on 0.0.0.0:${port}`);
      resolve();
    });
  });

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
