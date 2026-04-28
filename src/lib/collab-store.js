export class CollabStore {
  constructor() {
    this.state = null;
    this.subs = new Set();
  }
  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  _emit() { for (const fn of this.subs) fn(this.state); }

  apply(msg) {
    switch (msg.type) {
      case 'lobby:state':
        this.state = msg.lobby;
        break;
      case 'lobby:closed':
        this.state = null;
        break;
      case 'member:joined':
        if (this.state && !this.state.members.find(m => m.id === msg.member.id)) {
          this.state.members.push(msg.member);
        }
        break;
      case 'member:left':
        if (this.state) {
          this.state.members = this.state.members.filter(m => m.id !== msg.memberId);
        }
        break;
      case 'member:updated':
        if (this.state) {
          const i = this.state.members.findIndex(m => m.id === msg.member.id);
          if (i >= 0) this.state.members[i] = msg.member;
        }
        break;
      case 'chat:message':
        if (this.state) this.state.chat.push(msg.message);
        break;
      case 'clip:range-upserted':
        if (this.state) {
          const i = this.state.clipRanges.findIndex(r => r.id === msg.range.id);
          if (i >= 0) this.state.clipRanges[i] = msg.range;
          else this.state.clipRanges.push(msg.range);
        }
        break;
      case 'clip:range-removed':
        if (this.state) {
          this.state.clipRanges = this.state.clipRanges.filter(r => r.id !== msg.id);
        }
        break;
    }
    this._emit();
  }
}
