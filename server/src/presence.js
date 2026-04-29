export class Presence {
  constructor() {
    this.byWs = new Map();
    this.byCode = new Map();
  }
  attach(ws, user) { this.byWs.set(ws, { userId: user.id, userName: user.name, user }); }
  update(ws, user) {
    const ent = this.byWs.get(ws);
    if (!ent) return null;
    ent.userName = user.name || ent.userName;
    ent.user = { ...(ent.user || {}), ...user };
    return ent;
  }
  bind(ws, code) {
    const ent = this.byWs.get(ws);
    if (!ent) return;
    ent.code = code;
    if (!this.byCode.has(code)) this.byCode.set(code, new Set());
    this.byCode.get(code).add(ws);
  }
  unbind(ws) {
    const ent = this.byWs.get(ws);
    if (!ent?.code) return null;
    const set = this.byCode.get(ent.code);
    set?.delete(ws);
    if (set && !set.size) this.byCode.delete(ent.code);
    const code = ent.code;
    ent.code = null;
    return code;
  }
  detach(ws) { const code = this.unbind(ws); this.byWs.delete(ws); return code; }
  who(ws) { return this.byWs.get(ws); }
  membersOf(code) { return this.byCode.get(code) || new Set(); }
}
