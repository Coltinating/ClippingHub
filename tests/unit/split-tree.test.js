import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tree = require('../../src/split-tree.js');

describe('split-tree data model', () => {

  describe('default tree', () => {
    it('has correct leaf count', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      expect(tree.getAllLeaves()).toHaveLength(2);
    });

    it('contains expected panel types', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var types = tree.getAllLeaves().map(l => l.panelType).sort();
      expect(types).toEqual(['clipper', 'clips']);
    });
  });

  describe('splitArea', () => {
    it('splits a leaf into branch + 2 leaves', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var result = tree.splitArea(clipper.id, 'vertical', 0.5);
      expect(result).not.toBeNull();
      expect(tree.getAllLeaves()).toHaveLength(3);
      var parent = tree.findParent(clipper.id);
      expect(parent.type).toBe('branch');
      expect(parent.direction).toBe('vertical');
    });

    it('new leaf has panelType empty', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var result = tree.splitArea(clipper.id, 'horizontal', 0.5);
      var newLeaf = tree.findNode(result.newLeafId);
      expect(newLeaf.panelType).toBe('empty');
    });
  });

  describe('joinAreas', () => {
    it('removes sibling and promotes kept leaf', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var clips = tree.getLeafByPanelType('clips');
      tree.joinAreas(clipper.id, clips.id);
      expect(tree.getAllLeaves()).toHaveLength(1);
      expect(tree.getLeafByPanelType('clips')).toBeNull();
      expect(tree.getLeafByPanelType('clipper')).not.toBeNull();
    });
  });

  describe('swapAreas', () => {
    it('exchanges panel types', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var clips = tree.getLeafByPanelType('clips');
      var clipperId = clipper.id;
      var clipsId = clips.id;
      tree.swapAreas(clipperId, clipsId);
      expect(tree.findNode(clipperId).panelType).toBe('clips');
      expect(tree.findNode(clipsId).panelType).toBe('clipper');
    });
  });

  describe('findAdjacentLeaf', () => {
    it('finds right neighbor of clipper', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var adj = tree.findAdjacentLeaf(clipper.id, 'right');
      expect(adj).not.toBeNull();
      expect(adj.panelType).toBe('clips');
    });

    it('returns null at left edge', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var clipper = tree.getLeafByPanelType('clipper');
      var adj = tree.findAdjacentLeaf(clipper.id, 'left');
      expect(adj).toBeNull();
    });
  });

  describe('serialize/deserialize', () => {
    it('round-trips without data loss', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var serialized = tree.serialize();
      tree.deserialize(serialized);
      expect(tree.getAllLeaves()).toHaveLength(2);
      var types = tree.getAllLeaves().map(l => l.panelType).sort();
      expect(types).toEqual(['clipper', 'clips']);
    });
  });

  describe('setRatio', () => {
    it('clamps to valid range', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var root = tree.getRoot();
      tree.setRatio(root.id, -0.5);
      expect(root.ratio).toBe(0.05);
      tree.setRatio(root.id, 1.5);
      expect(root.ratio).toBe(0.95);
    });
  });
});
