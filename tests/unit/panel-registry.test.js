import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const registry = require('../../src/panel-registry.js');

describe('panel-registry', () => {
  it('contains core panel types', () => {
    const all = registry.getPanelTypes();
    expect(all).toContain('media');
    expect(all).toContain('clipper');
    expect(all).toContain('viewer');
    expect(all).toContain('clips');
  });

  it('contains collaboration panel type', () => {
    const all = registry.getPanelTypes();
    expect(all).toContain('collab');
  });

  it('returns grouped dropdown options with players then core then collaboration', () => {
    const groups = registry.getPanelOptionGroups();
    expect(groups.map(g => g.key)).toEqual(['players', 'core', 'collab']);
    expect(groups[0].options.some(o => o.type === 'clipper')).toBe(true);
    expect(groups[0].options.some(o => o.type === 'viewer')).toBe(true);
    expect(groups[1].options.some(o => o.type === 'clips')).toBe(true);
    expect(groups[2].options.some(o => o.type === 'collab')).toBe(true);
  });

  it('knows valid and invalid panel types', () => {
    expect(registry.isPanelType('clipper')).toBe(true);
    expect(registry.isPanelType('preview')).toBe(true); // legacy alias
    expect(registry.isPanelType('badType')).toBe(false);
    expect(registry.isPanelType('timeline')).toBe(false);
  });

  describe('registerLifecycle', () => {
    it('attaches lifecycle hooks to a panel definition', () => {
      const hooks = {
        mount: () => {},
        unmount: () => {},
        saveState: () => ({ draft: 'hello' }),
        restoreState: () => {}
      };
      registry.registerLifecycle('clips', hooks);
      const info = registry.getPanelInfo('clips');
      expect(info.lifecycle).toBe(hooks);
      expect(typeof info.lifecycle.mount).toBe('function');
      expect(typeof info.lifecycle.saveState).toBe('function');
    });

    it('normalizes alias types before registering', () => {
      const hooks = { mount: () => {} };
      registry.registerLifecycle('preview', hooks);
      // 'preview' normalizes to 'clipper'
      const info = registry.getPanelInfo('clipper');
      expect(info.lifecycle).toBe(hooks);
    });

    it('ignores unknown panel types gracefully', () => {
      // Should not throw
      registry.registerLifecycle('nonExistentPanel', { mount: () => {} });
      expect(registry.getPanelInfo('nonExistentPanel')).toBe(null);
    });

    it('overwrites previous lifecycle hooks', () => {
      const first = { mount: () => 'first' };
      const second = { mount: () => 'second' };
      registry.registerLifecycle('media', first);
      expect(registry.getPanelInfo('media').lifecycle).toBe(first);
      registry.registerLifecycle('media', second);
      expect(registry.getPanelInfo('media').lifecycle).toBe(second);
    });
  });
});
