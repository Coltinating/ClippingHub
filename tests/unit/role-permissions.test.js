import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const rp = require('../../src/lib/role-permissions.js');

describe('normalizeRole', () => {
  it('accepts viewer/clipper/helper', () => {
    expect(rp.normalizeRole('viewer')).toBe('viewer');
    expect(rp.normalizeRole('clipper')).toBe('clipper');
    expect(rp.normalizeRole('helper')).toBe('helper');
  });
  it('maps legacy values', () => {
    expect(rp.normalizeRole('host')).toBe('clipper');
    expect(rp.normalizeRole('editor')).toBe('viewer');
  });
  it('returns viewer for unknown', () => {
    expect(rp.normalizeRole('')).toBe('viewer');
    expect(rp.normalizeRole(null)).toBe('viewer');
    expect(rp.normalizeRole('admin')).toBe('viewer');
  });
});

describe('getDefaultJoinRole', () => {
  it('returns viewer', () => { expect(rp.getDefaultJoinRole()).toBe('viewer'); });
});

describe('role predicates', () => {
  it('isClipperRole', () => {
    expect(rp.isClipperRole('clipper')).toBe(true);
    expect(rp.isClipperRole('helper')).toBe(false);
  });
  it('isHelperRole', () => {
    expect(rp.isHelperRole('helper')).toBe(true);
    expect(rp.isHelperRole('clipper')).toBe(false);
  });
  it('isViewerRole', () => {
    expect(rp.isViewerRole('viewer')).toBe(true);
    expect(rp.isViewerRole('helper')).toBe(false);
  });
});

describe('canAssignRole', () => {
  const clipper = { id: 'c1', role: 'clipper' };
  const helper = { id: 'h1', role: 'helper' };
  const viewer = { id: 'v1', role: 'viewer' };

  it('clippers can promote any member', () => {
    expect(rp.canAssignRole(clipper, viewer, 'helper')).toBe(true);
    expect(rp.canAssignRole(clipper, viewer, 'clipper')).toBe(true);
    expect(rp.canAssignRole(clipper, helper, 'viewer')).toBe(true);
  });
  it('helpers cannot assign roles', () => {
    expect(rp.canAssignRole(helper, viewer, 'helper')).toBe(false);
  });
  it('viewers cannot assign roles', () => {
    expect(rp.canAssignRole(viewer, helper, 'viewer')).toBe(false);
  });
  it('no actor fails closed', () => {
    expect(rp.canAssignRole(null, viewer, 'helper')).toBe(false);
  });
  it('rejects unknown target roles', () => {
    expect(rp.canAssignRole(clipper, viewer, 'godmode')).toBe(false);
  });
});
