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

// Load server/.env into process.env if it exists. Native to Node 20.6+,
// no extra dep. Existing process.env values win (so explicit env beats file).
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
  const dbFile = cfg.dataDir === ':memory:' ? ':memory:' : `${cfg.dataDir}/clippinghub.db`;
  const db = openDb(dbFile);
  const logger = makeLogger(cfg.logLevel);
  const store = new LobbyStore(db);
  const presence = new Presence();

  // Collab message types served by this Node server are slated for replacement
  // by the rthub Cloudflare Workers broker. While the rthub client adapter is
  // rolling out behind the `rthubEnabled` flag, this server still serves them
  // by default. Operators set LEGACY_COLLAB=0 once the rthub cutover is complete
  // to start returning DEPRECATED errors so misconfigured clients fail loudly.
  // Transcript and admin handlers are unaffected (rthub spec doesn't cover them).
  const COLLAB_DEPRECATED = process.env.LEGACY_COLLAB === '0';
  const deprecatedCollabHandler = ({ ws, send, msg }) => send(ws, {
    type: 'error',
    code: 'deprecated',
    message: 'collab moved to rthub broker; reconnect via the rthub WebSocket endpoint'
  });

  const handlers = {
    hello: auth.hello,
    'lobby:create': COLLAB_DEPRECATED ? deprecatedCollabHandler : auth.lobbyCreate,
    'lobby:join':   COLLAB_DEPRECATED ? deprecatedCollabHandler : auth.lobbyJoin,
    'lobby:leave':  COLLAB_DEPRECATED ? deprecatedCollabHandler : auth.lobbyLeave,
    'profile:update': COLLAB_DEPRECATED ? deprecatedCollabHandler : auth.profileUpdate,
    'chat:send':    COLLAB_DEPRECATED ? deprecatedCollabHandler : chat.chatSend,
    'member:set-role':       COLLAB_DEPRECATED ? deprecatedCollabHandler : roles.setRole,
    'member:set-assist':     COLLAB_DEPRECATED ? deprecatedCollabHandler : roles.setAssist,
    'clip:upsert-range':     COLLAB_DEPRECATED ? deprecatedCollabHandler : clips.upsertRange,
    'clip:remove-range':     COLLAB_DEPRECATED ? deprecatedCollabHandler : clips.removeRange,
    'clip:delivery-create':  COLLAB_DEPRECATED ? deprecatedCollabHandler : clips.deliveryCreate,
    'clip:delivery-consume': COLLAB_DEPRECATED ? deprecatedCollabHandler : clips.deliveryConsume,
    'transcript:start': transcription.start,
    'transcript:stop':  transcription.stop,
    'admin:list-lobbies':       admin.listLobbies,
    'admin:send-chat':          admin.sendChat,
    'admin:delete-lobby':       admin.deleteLobby,
    'admin:subscribe-events':   admin.subscribeEventsHandler,
    'admin:unsubscribe-events': admin.unsubscribeEventsHandler,
    'ping': ({ ws, send }) => send(ws, { type: 'pong' })
  };
  if (COLLAB_DEPRECATED) {
    logger?.info?.({ evt: 'collab:deprecated', msg: 'LEGACY_COLLAB=0; collab handlers return deprecated errors' });
  }
  const router = makeRouter({ store, presence, handlers, logger });

  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // Admin web panel — static files served from src/admin/public.
  app.use('/admin', express.static(join(here, 'admin', 'public')));

  const http = createServer(app);
  // 1 MB per-frame cap stops a single client from spending unbounded server
  // memory on one message. ws will close the connection with code 1009 when
  // exceeded.
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024 * 1024 });

  // Per-connection inbound rate limiter. Sliding 1s window, drops messages
  // over RATE_MAX without killing the connection (keeps laggy clients alive).
  // Connection is closed only on sustained abuse (>3s of overflow).
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
        // Drop silently; client may be flooding. Logged once per drop window.
        if (count === RATE_MAX + 1) {
          logger.warn({ evt: 'ws:rate-drop', max: RATE_MAX });
        }
        return;
      }
      router.onMessage(ws, raw);
    });
    ws.on('close',   () => { admin.detachAdminSubscription(ws); router.onClose(ws); });
    ws.on('error',   (e) => logger.warn({ evt: 'ws:error', err: e.message }));
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
