import { z } from 'zod';

const User = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  xHandle: z.string().optional(),
  color: z.string().optional(),
  pfpDataUrl: z.string().optional()
});

const AdminAuth = z.object({
  token: z.string().optional(),
  name: z.string().min(1).max(32)
});

export const Inbound = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), user: User, serverToken: z.string().optional(), admin: AdminAuth.optional() }),
  z.object({ type: z.literal('lobby:create'), name: z.string(), password: z.string().default(''), code: z.string().optional() }),
  z.object({ type: z.literal('lobby:join'),   code: z.string(), password: z.string().default('') }),
  z.object({ type: z.literal('lobby:leave') }),
  z.object({ type: z.literal('chat:send'),    text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('member:set-role'),   memberId: z.string(), role: z.enum(['clipper', 'helper', 'viewer']) }),
  z.object({ type: z.literal('member:set-assist'), assistUserId: z.string().nullable() }),
  z.object({ type: z.literal('clip:upsert-range'), range: z.record(z.any()) }),
  z.object({ type: z.literal('clip:remove-range'), id: z.string() }),
  z.object({ type: z.literal('clip:delivery-create'),  delivery: z.record(z.any()) }),
  z.object({ type: z.literal('clip:delivery-consume'), ids: z.array(z.string()) }),
  z.object({ type: z.literal('transcript:start'), channelId: z.string(), videoUrl: z.string().url() }),
  z.object({ type: z.literal('transcript:stop') }),
  z.object({ type: z.literal('admin:list-lobbies') }),
  z.object({ type: z.literal('admin:send-chat'), code: z.string(), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('admin:delete-lobby'), code: z.string() }),
  z.object({ type: z.literal('admin:subscribe-events') }),
  z.object({ type: z.literal('admin:unsubscribe-events') }),
  z.object({ type: z.literal('ping') })
]);

const Member = z.object({
  id: z.string(), name: z.string(), role: z.string(),
  joinedAt: z.number(), lastSeenAt: z.number(),
  xHandle: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  pfpDataUrl: z.string().nullable().optional(),
  assistUserId: z.string().nullable().optional(),
  isAdmin: z.boolean().optional()
});

const LobbySummary = z.object({
  code: z.string(),
  name: z.string(),
  hostId: z.string().optional().nullable(),
  memberCount: z.number(),
  chatCount: z.number(),
  rangeCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number()
});
const Lobby = z.object({
  code: z.string(), id: z.string().optional(), name: z.string(),
  hostId: z.string().optional(),
  members: z.array(Member),
  chat: z.array(z.record(z.any())),
  clipRanges: z.array(z.record(z.any())),
  deliveries: z.array(z.record(z.any()))
});

export const Outbound = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello:ack'), serverVersion: z.string(), isAdmin: z.boolean().optional(), authTried: z.boolean().optional() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('lobby:state'), lobby: Lobby }),
  z.object({ type: z.literal('lobby:closed'), code: z.string() }),
  z.object({ type: z.literal('member:joined'), member: Member }),
  z.object({ type: z.literal('member:left'),   memberId: z.string() }),
  z.object({ type: z.literal('member:updated'), member: Member }),
  z.object({ type: z.literal('chat:message'),  message: z.record(z.any()) }),
  z.object({ type: z.literal('clip:range-upserted'), range: z.record(z.any()) }),
  z.object({ type: z.literal('clip:range-removed'),  id: z.string() }),
  z.object({ type: z.literal('clip:delivery'),       delivery: z.record(z.any()) }),
  z.object({ type: z.literal('clip:delivery-pending'), deliveries: z.array(z.record(z.any())) }),
  z.object({ type: z.literal('transcript:status'), status: z.enum(['idle', 'running', 'stopped', 'error']), error: z.string().optional() }),
  z.object({ type: z.literal('transcript:chunk'),  chunk: z.object({ tStart: z.number(), tEnd: z.number(), text: z.string() }) }),
  z.object({ type: z.literal('admin:lobbies'), lobbies: z.array(LobbySummary) }),
  z.object({ type: z.literal('admin:ack'), action: z.string(), code: z.string().optional() }),
  z.object({ type: z.literal('admin:event'), event: z.record(z.any()) }),
  z.object({ type: z.literal('admin:event-batch'), events: z.array(z.record(z.any())) }),
  z.object({ type: z.literal('pong') })
]);
