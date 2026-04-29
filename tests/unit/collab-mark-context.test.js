import { describe, test, expect } from 'vitest';

// Inline the new helper functions (post-refactor signatures)
function myMember(state) {
  return state.members.find(m => m.id === state.me.id) || null;
}
function myRole(state) { return myMember(state)?.role || 'viewer'; }
function myAssistUserId(state) { return myMember(state)?.assistUserId || null; }

function getMarkContext(state) {
  const meName = (state.me.name || 'You').trim() || 'You';
  const meId = state.me.id;
  if (myRole(state) !== 'helper') {
    return { userId: meId, userName: meName, clipperId: meId, clipperName: meName, helperId: null, helperName: '' };
  }
  const assistId = myAssistUserId(state);
  const assist = state.members.find(m => m.id === assistId);
  if (!assist) {
    return { userId: meId, userName: meName, clipperId: meId, clipperName: meName, helperId: null, helperName: '' };
  }
  const clipperName = (assist.name || 'Clipper').trim() || 'Clipper';
  return { userId: meId, userName: meName, clipperId: assist.id, clipperName, helperId: meId, helperName: meName };
}

describe('getMarkContext (post-refactor)', () => {
  const me = { id: 'me', name: 'Alice' };

  test('clipper: returns me as clipper, no helper', () => {
    const state = {
      me,
      members: [{ id: 'me', name: 'Alice', role: 'clipper', assistUserId: null }],
    };
    const ctx = getMarkContext(state);
    expect(ctx.clipperId).toBe('me');
    expect(ctx.helperId).toBeNull();
  });

  test('helper with valid target: returns target as clipper, me as helper', () => {
    const state = {
      me,
      members: [
        { id: 'me',  name: 'Alice', role: 'helper',  assistUserId: 'bob' },
        { id: 'bob', name: 'Bob',   role: 'clipper', assistUserId: null },
      ],
    };
    const ctx = getMarkContext(state);
    expect(ctx.clipperId).toBe('bob');
    expect(ctx.helperId).toBe('me');
  });

  test('helper with missing target falls back to self-as-clipper', () => {
    const state = {
      me,
      members: [
        { id: 'me', name: 'Alice', role: 'helper', assistUserId: 'missing' },
      ],
    };
    const ctx = getMarkContext(state);
    expect(ctx.clipperId).toBe('me');
    expect(ctx.helperId).toBeNull();
  });

  test('viewer: treated as clipper (no mark activity expected)', () => {
    const state = {
      me,
      members: [{ id: 'me', name: 'Alice', role: 'viewer', assistUserId: null }],
    };
    const ctx = getMarkContext(state);
    expect(ctx.clipperId).toBe('me');
    expect(ctx.helperId).toBeNull();
  });
});
