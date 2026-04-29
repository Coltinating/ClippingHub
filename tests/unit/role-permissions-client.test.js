import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const RP = require('../../src/lib/role-permissions.js');

describe('normalizeRole client helpers', () => {
  it('maps host->clipper, editor->viewer', () => {
    expect(RP.normalizeRole('host')).toBe('clipper');
    expect(RP.normalizeRole('editor')).toBe('viewer');
    expect(RP.normalizeRole('HELPER')).toBe('helper');
    expect(RP.normalizeRole(undefined)).toBe('viewer');
    expect(RP.normalizeRole('garbage')).toBe('viewer');
  });
});

describe('canMarkClips', () => {
  it('clipper and helper allowed; viewer blocked', () => {
    expect(RP.canMarkClips('clipper')).toBe(true);
    expect(RP.canMarkClips('helper')).toBe(true);
    expect(RP.canMarkClips('viewer')).toBe(false);
    expect(RP.canMarkClips(null)).toBe(false);
  });
});

describe('canSendDelivery', () => {
  it('only helper can send', () => {
    expect(RP.canSendDelivery('helper')).toBe(true);
    expect(RP.canSendDelivery('clipper')).toBe(false);
    expect(RP.canSendDelivery('viewer')).toBe(false);
  });
});

describe('canConsumeDeliveries', () => {
  it('only clipper consumes', () => {
    expect(RP.canConsumeDeliveries('clipper')).toBe(true);
    expect(RP.canConsumeDeliveries('helper')).toBe(false);
    expect(RP.canConsumeDeliveries('viewer')).toBe(false);
  });
});

describe('canAssistClipper', () => {
  it('viewer and helper can assist; clipper cannot', () => {
    expect(RP.canAssistClipper('viewer')).toBe(true);
    expect(RP.canAssistClipper('helper')).toBe(true);
    expect(RP.canAssistClipper('clipper')).toBe(false);
  });
});
