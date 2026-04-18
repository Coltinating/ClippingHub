'use strict';

const fs = require('fs');
const path = require('path');

function sanitizeLayoutKey(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'layout';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function layoutFilePath(layoutDir, key) {
  return path.join(layoutDir, `${key}.json`);
}

function normalizeLayout(layout, fallbackName) {
  const src = (layout && typeof layout === 'object') ? layout : {};
  const out = Object.assign({}, src);
  out.name = String(out.name || fallbackName || 'Layout');
  out.version = Number(out.version) || 1;
  if (!out.tree || typeof out.tree !== 'object') {
    throw new Error('Layout must contain a tree object');
  }
  if (!Array.isArray(out.floating)) out.floating = [];
  return out;
}

function ensureDefaultLayouts(layoutDir, defaultsByKey) {
  ensureDir(layoutDir);
  const keys = Object.keys(defaultsByKey || {});
  for (let i = 0; i < keys.length; i++) {
    const key = sanitizeLayoutKey(keys[i]);
    const filePath = layoutFilePath(layoutDir, key);
    if (fs.existsSync(filePath)) continue;
    const normalized = normalizeLayout(defaultsByKey[keys[i]], key);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  }
}

function nextAvailableLayoutKey(layoutDir, requestedKey) {
  const base = sanitizeLayoutKey(requestedKey);
  let key = base;
  let n = 2;
  while (fs.existsSync(layoutFilePath(layoutDir, key))) {
    key = `${base}-${n}`;
    n += 1;
  }
  return key;
}

function saveLayoutFile(layoutDir, opts) {
  ensureDir(layoutDir);
  const input = opts || {};
  const sourceLayout = input.layout || {};
  const rawName = input.name || sourceLayout.name || input.key || 'Layout';
  const requestedKey = input.key ? sanitizeLayoutKey(input.key) : sanitizeLayoutKey(rawName);
  const key = input.key ? requestedKey : nextAvailableLayoutKey(layoutDir, requestedKey);
  const normalized = normalizeLayout(Object.assign({}, sourceLayout, { name: rawName }), rawName);
  const filePath = layoutFilePath(layoutDir, key);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return { key, layout: normalized, filePath };
}

function deleteLayoutFile(layoutDir, key, defaultKeys) {
  const safeKey = sanitizeLayoutKey(key);
  const defaults = defaultKeys instanceof Set ? defaultKeys : new Set(defaultKeys || []);
  if (defaults.has(safeKey)) return { success: false, reason: 'default_layout' };
  const filePath = layoutFilePath(layoutDir, safeKey);
  if (!fs.existsSync(filePath)) return { success: false, reason: 'missing' };
  fs.unlinkSync(filePath);
  return { success: true };
}

function listLayoutFiles(layoutDir, defaultKeys) {
  const defaults = defaultKeys instanceof Set ? defaultKeys : new Set(defaultKeys || []);
  if (!fs.existsSync(layoutDir)) return [];
  const files = fs.readdirSync(layoutDir).filter(function (f) { return f.endsWith('.json'); }).sort();
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = file.slice(0, -5);
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(layoutDir, file), 'utf-8'));
      const normalized = normalizeLayout(parsed, key);
      out.push({
        key,
        _filename: key,
        _isDefault: defaults.has(key),
        isDefault: defaults.has(key),
        name: normalized.name,
        version: normalized.version,
        tree: normalized.tree,
        floating: normalized.floating
      });
    } catch (_) {
      // Skip invalid files.
    }
  }
  return out;
}

module.exports = {
  sanitizeLayoutKey,
  ensureDefaultLayouts,
  saveLayoutFile,
  deleteLayoutFile,
  listLayoutFiles,
  nextAvailableLayoutKey
};
