import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const cfg = require('../../src/lib/layout-config.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ch-layouts-'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('layout-config', () => {
  it('creates missing default layout files and preserves existing files', () => {
    const dir = makeTempDir();
    const defaults = {
      default: { name: 'Default', version: 1, tree: { type: 'leaf', panelType: 'clipper' } },
      editing: { name: 'Editing', version: 1, tree: { type: 'leaf', panelType: 'timeline' } },
      minimal: { name: 'Minimal', version: 1, tree: { type: 'leaf', panelType: 'media' } }
    };

    fs.writeFileSync(path.join(dir, 'default.json'), JSON.stringify({ name: 'Custom Default', version: 1, tree: { type: 'leaf', panelType: 'clips' } }, null, 2));
    cfg.ensureDefaultLayouts(dir, defaults);

    expect(readJson(path.join(dir, 'default.json')).name).toBe('Custom Default');
    expect(readJson(path.join(dir, 'editing.json')).name).toBe('Editing');
    expect(readJson(path.join(dir, 'minimal.json')).name).toBe('Minimal');
  });

  it('saves layouts with stable slug keys and avoids collisions', () => {
    const dir = makeTempDir();
    const layout = { name: 'My Layout', version: 1, tree: { type: 'leaf', panelType: 'clipper' } };

    const first = cfg.saveLayoutFile(dir, { name: 'My Layout', layout });
    const second = cfg.saveLayoutFile(dir, { name: 'My Layout', layout });

    expect(first.key).toBe('my-layout');
    expect(second.key).toBe('my-layout-2');
    expect(fs.existsSync(path.join(dir, 'my-layout.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'my-layout-2.json'))).toBe(true);
  });

  it('lists layout json files with parsed metadata', () => {
    const dir = makeTempDir();
    const defaults = new Set(['default']);
    fs.writeFileSync(path.join(dir, 'default.json'), JSON.stringify({ name: 'Default', version: 1, tree: { type: 'leaf', panelType: 'clipper' } }, null, 2));
    fs.writeFileSync(path.join(dir, 'custom_one.json'), JSON.stringify({ name: 'Custom One', version: 1, tree: { type: 'leaf', panelType: 'media' } }, null, 2));
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope');

    const layouts = cfg.listLayoutFiles(dir, defaults);
    const keys = layouts.map(l => l.key);

    expect(keys).toEqual(['custom_one', 'default']);
    expect(layouts.find(l => l.key === 'default').isDefault).toBe(true);
    expect(layouts.find(l => l.key === 'custom_one').name).toBe('Custom One');
  });
});
