import { describe, test, expect } from 'vitest';

// groupMembers is not exported from collab-ui (IIFE); we inline it for testing.
function groupMembers(members) {
  const clipperById = new Map();
  const orphanHelpers = [];
  const viewers = [];
  for (const m of members) {
    if (m.role === 'clipper') clipperById.set(m.id, { ...m, helpers: [] });
    else if (m.role === 'viewer') viewers.push(m);
  }
  for (const m of members) {
    if (m.role !== 'helper') continue;
    const target = clipperById.get(m.assistUserId);
    if (target) target.helpers.push(m);
    else orphanHelpers.push(m);
  }
  return { clippers: [...clipperById.values()], orphanHelpers, viewers };
}

describe('groupMembers', () => {
  test('buckets plain roles correctly', () => {
    const members = [
      { id: 'c1', role: 'clipper', name: 'Alice', assistUserId: null },
      { id: 'v1', role: 'viewer',  name: 'Diana', assistUserId: null },
    ];
    const { clippers, viewers, orphanHelpers } = groupMembers(members);
    expect(clippers).toHaveLength(1);
    expect(clippers[0].id).toBe('c1');
    expect(viewers).toHaveLength(1);
    expect(orphanHelpers).toHaveLength(0);
  });

  test('nests helpers under their clipper', () => {
    const members = [
      { id: 'c1', role: 'clipper', name: 'Alice', assistUserId: null },
      { id: 'h1', role: 'helper',  name: 'Bob',   assistUserId: 'c1' },
      { id: 'h2', role: 'helper',  name: 'Charlie', assistUserId: 'c1' },
    ];
    const { clippers } = groupMembers(members);
    expect(clippers[0].helpers).toHaveLength(2);
    expect(clippers[0].helpers.map(h => h.id)).toEqual(['h1', 'h2']);
  });

  test('orphan helper (stale state) goes to orphanHelpers', () => {
    const members = [
      { id: 'h1', role: 'helper', name: 'Bob', assistUserId: 'gone_clipper' },
    ];
    const { clippers, orphanHelpers } = groupMembers(members);
    expect(clippers).toHaveLength(0);
    expect(orphanHelpers).toHaveLength(1);
  });

  test('preserves input order within each bucket', () => {
    const members = [
      { id: 'c1', role: 'clipper', name: 'A', assistUserId: null },
      { id: 'c2', role: 'clipper', name: 'B', assistUserId: null },
      { id: 'v1', role: 'viewer',  name: 'V', assistUserId: null },
    ];
    const { clippers, viewers } = groupMembers(members);
    expect(clippers.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(viewers.map(v => v.id)).toEqual(['v1']);
  });
});
