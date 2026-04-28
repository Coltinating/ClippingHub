import { startStub } from '../transcribe-stub.js';

const sessionsByLobby = new Map();

export function start({ ws, msg, send, broadcast, presence }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join a lobby first' });
  if (sessionsByLobby.has(ent.code)) {
    return send(ws, { type: 'error', code: 'already_running', message: 'transcription already active in this lobby' });
  }
  const stop = startStub({
    channelId: msg.channelId,
    videoUrl: msg.videoUrl,
    onChunk: (chunk) => broadcast(ent.code, { type: 'transcript:chunk', chunk }),
    onError: (e) => broadcast(ent.code, { type: 'transcript:status', status: 'error', error: e.message })
  });
  sessionsByLobby.set(ent.code, { stop, channelId: msg.channelId, videoUrl: msg.videoUrl });
  broadcast(ent.code, { type: 'transcript:status', status: 'running' });
}

export function stop({ ws, presence, broadcast }) {
  const ent = presence.who(ws);
  if (!ent?.code) return;
  const session = sessionsByLobby.get(ent.code);
  if (!session) return;
  session.stop();
  sessionsByLobby.delete(ent.code);
  broadcast(ent.code, { type: 'transcript:status', status: 'stopped' });
}
