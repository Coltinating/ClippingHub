import { generateLobbyCode, sanitizeCode, makeId } from './util/codes.js';

export class LobbyStore {
  constructor(db) {
    this.db = db;
    this._prep();
  }

  _prep() {
    this.q = {
      insertLobby: this.db.prepare(`INSERT INTO lobbies(code,id,name,password,host_id,created_at,updated_at)
                                    VALUES (?,?,?,?,?,?,?)`),
      lobbyByCode: this.db.prepare('SELECT * FROM lobbies WHERE code = ?'),
      bumpLobby:   this.db.prepare('UPDATE lobbies SET updated_at=? WHERE code=?'),
      setHost:     this.db.prepare('UPDATE lobbies SET host_id=?, updated_at=? WHERE code=?'),
      upsertMember: this.db.prepare(`
        INSERT INTO members(lobby_code,id,name,role,joined_at,last_seen_at,x_handle,color,pfp_data_url,assist_user_id,is_admin)
        VALUES (@lobby_code,@id,@name,@role,@joined_at,@last_seen_at,@x_handle,@color,@pfp_data_url,@assist_user_id,@is_admin)
        ON CONFLICT(lobby_code,id) DO UPDATE SET
          name=excluded.name, role=excluded.role, last_seen_at=excluded.last_seen_at,
          x_handle=excluded.x_handle, color=excluded.color, pfp_data_url=excluded.pfp_data_url,
          assist_user_id=excluded.assist_user_id, is_admin=excluded.is_admin`),
      updateMemberRole: this.db.prepare(`UPDATE members SET role=?, last_seen_at=? WHERE lobby_code=? AND id=?`),
      updateMemberAssist: this.db.prepare(`UPDATE members SET assist_user_id=?, last_seen_at=? WHERE lobby_code=? AND id=?`),
      memberById: this.db.prepare('SELECT * FROM members WHERE lobby_code=? AND id=?'),
      members: this.db.prepare('SELECT * FROM members WHERE lobby_code=? ORDER BY joined_at ASC'),
      deleteMember: this.db.prepare('DELETE FROM members WHERE lobby_code=? AND id=?'),
      insertChat: this.db.prepare(`INSERT INTO chat(id,lobby_code,user_id,user_name,text,created_at)
                                   VALUES (?,?,?,?,?,?)`),
      chat: this.db.prepare('SELECT * FROM chat WHERE lobby_code=? ORDER BY created_at ASC LIMIT 200'),
      upsertRange: this.db.prepare(`
        INSERT INTO clip_ranges(id,lobby_code,payload,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`),
      ranges: this.db.prepare('SELECT * FROM clip_ranges WHERE lobby_code=? ORDER BY updated_at ASC'),
      removeRange: this.db.prepare('DELETE FROM clip_ranges WHERE lobby_code=? AND id=?'),
      findUndeliveredSame: this.db.prepare(`
        SELECT id FROM deliveries
        WHERE lobby_code=? AND from_user_id=? AND to_user_id=? AND range_id=? AND delivered=0
        LIMIT 1`),
      insertDelivery: this.db.prepare(`
        INSERT INTO deliveries(id,lobby_code,type,from_user_id,to_user_id,range_id,payload,created_at,delivered)
        VALUES (?,?,?,?,?,?,?,?,0)`),
      updateDelivery: this.db.prepare(`UPDATE deliveries SET type=?, payload=?, created_at=? WHERE id=?`),
      pendingFor: this.db.prepare(`
        SELECT * FROM deliveries WHERE lobby_code=? AND to_user_id=? AND delivered=0
        ORDER BY created_at ASC`),
      markDelivered: this.db.prepare(`UPDATE deliveries SET delivered=1, delivered_at=? WHERE id=?`),
      allLobbiesSummary: this.db.prepare(`
        SELECT
          l.*,
          (SELECT COUNT(*) FROM members WHERE lobby_code = l.code) AS member_count,
          (SELECT COUNT(*) FROM chat WHERE lobby_code = l.code) AS chat_count,
          (SELECT COUNT(*) FROM clip_ranges WHERE lobby_code = l.code) AS range_count
        FROM lobbies l
        ORDER BY l.updated_at DESC`)
    };
  }

  createLobby({ name, password = '', user, code: requested, isAdmin = false }) {
    const code = sanitizeCode(requested) || generateLobbyCode();
    if (this.q.lobbyByCode.get(code)) throw new Error('Lobby code already exists');
    const now = Date.now();
    const id = makeId('lobby');
    this.q.insertLobby.run(code, id, name || 'Collab Lobby', password, user.id, now, now);
    this._writeMember(code, user, 'clipper', now, isAdmin);
    return this.getLobby(code);
  }

  joinLobby({ code, password = '', user, isAdmin = false }) {
    const c = sanitizeCode(code);
    const lobby = this.q.lobbyByCode.get(c);
    if (!lobby) throw new Error('Lobby not found');
    if (!isAdmin && (lobby.password || '') !== password) throw new Error('Wrong password');
    const existing = this.q.memberById.get(c, user.id);
    const now = Date.now();
    if (existing) {
      this._writeMember(c, user, existing.role, now, isAdmin || !!existing.is_admin);
    } else {
      // Admins always join as clipper-equivalent. Regular new joins are viewer
      // unless the lobby is unhosted, in which case they become the host/clipper.
      const role = isAdmin ? 'clipper' : (lobby.host_id ? 'viewer' : 'clipper');
      this._writeMember(c, user, role, now, isAdmin);
      if (!isAdmin && !lobby.host_id) this.q.setHost.run(user.id, now, c);
    }
    this.q.bumpLobby.run(now, c);
    return this.getLobby(c);
  }

  leaveLobby(code, userId) {
    const c = sanitizeCode(code);
    this.q.deleteMember.run(c, userId);
    const lobby = this.q.lobbyByCode.get(c);
    if (lobby && lobby.host_id === userId) {
      const remaining = this.q.members.all(c);
      const next = remaining[0];
      this.q.setHost.run(next ? next.id : '', Date.now(), c);
    } else {
      this.q.bumpLobby.run(Date.now(), c);
    }
  }

  setMemberRole(code, memberId, role) {
    const c = sanitizeCode(code);
    this.q.updateMemberRole.run(role, Date.now(), c, memberId);
    return this.getMember(c, memberId);
  }

  setMemberAssist(code, memberId, assistUserId) {
    const c = sanitizeCode(code);
    this.q.updateMemberAssist.run(assistUserId, Date.now(), c, memberId);
    return this.getMember(c, memberId);
  }

  getMember(code, memberId) {
    const r = this.q.memberById.get(sanitizeCode(code), memberId);
    return r ? this._memberRow(r) : null;
  }

  addChat({ code, userId, userName, text }) {
    const c = sanitizeCode(code);
    const id = makeId('msg');
    const createdAt = Date.now();
    this.q.insertChat.run(id, c, userId, userName, text, createdAt);
    this.q.bumpLobby.run(createdAt, c);
    return { id, userId, userName, text, createdAt };
  }

  upsertRange(code, range) {
    const c = sanitizeCode(code);
    const id = String(range.id || makeId('range'));
    const payload = { ...range, id };
    this.q.upsertRange.run(id, c, JSON.stringify(payload), Date.now());
    return payload;
  }

  removeRange(code, id) {
    this.q.removeRange.run(sanitizeCode(code), id);
  }

  createDelivery(code, delivery) {
    const c = sanitizeCode(code);
    const existing = this.q.findUndeliveredSame.get(
      c, delivery.fromUserId, delivery.toUserId, delivery.rangeId
    );
    const now = Date.now();
    if (existing) {
      this.q.updateDelivery.run(delivery.type, JSON.stringify(delivery.payload || {}), now, existing.id);
      return { ...delivery, id: existing.id, createdAt: now };
    }
    const id = makeId('dlv');
    this.q.insertDelivery.run(id, c, delivery.type, delivery.fromUserId, delivery.toUserId,
      delivery.rangeId, JSON.stringify(delivery.payload || {}), now);
    return { ...delivery, id, createdAt: now };
  }

  pendingDeliveriesFor(code, userId) {
    return this.q.pendingFor.all(sanitizeCode(code), userId).map(r => ({
      id: r.id,
      type: r.type,
      fromUserId: r.from_user_id,
      toUserId: r.to_user_id,
      rangeId: r.range_id,
      createdAt: r.created_at,
      payload: JSON.parse(r.payload)
    }));
  }

  markDelivered(ids) {
    if (!ids || !ids.length) return;
    const now = Date.now();
    const tx = this.db.transaction((arr) => arr.forEach(id => this.q.markDelivered.run(now, id)));
    tx(ids);
  }

  getLobby(code) {
    const c = sanitizeCode(code);
    const l = this.q.lobbyByCode.get(c);
    if (!l) return null;
    return {
      code: l.code,
      id: l.id,
      name: l.name,
      hostId: l.host_id,
      members: this.q.members.all(c).map(this._memberRow),
      chat: this.q.chat.all(c).map(r => ({
        id: r.id, userId: r.user_id, userName: r.user_name, text: r.text, createdAt: r.created_at
      })),
      clipRanges: this.q.ranges.all(c).map(r => JSON.parse(r.payload)),
      deliveries: []
    };
  }

  _writeMember(code, user, role, now, isAdmin = false) {
    this.q.upsertMember.run({
      lobby_code: code,
      id: user.id,
      name: user.name,
      role,
      joined_at: now,
      last_seen_at: now,
      x_handle: user.xHandle || null,
      color: user.color || null,
      pfp_data_url: user.pfpDataUrl || null,
      assist_user_id: null,
      is_admin: isAdmin ? 1 : 0
    });
  }

  _memberRow(r) {
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      joinedAt: r.joined_at,
      lastSeenAt: r.last_seen_at,
      xHandle: r.x_handle,
      color: r.color,
      pfpDataUrl: r.pfp_data_url,
      assistUserId: r.assist_user_id,
      isAdmin: !!r.is_admin
    };
  }

  listAllLobbies() {
    return this.q.allLobbiesSummary.all().map(r => ({
      code: r.code,
      name: r.name,
      hostId: r.host_id || null,
      memberCount: r.member_count,
      chatCount: r.chat_count,
      rangeCount: r.range_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}
