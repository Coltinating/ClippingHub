import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const tree = require('../../src/split-tree.js');

describe('split-tree data model', () => {

  describe('default tree', () => {
    it('has correct leaf count', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      expect(tree.getAllLeaves()).toHaveLength(4);
    });

    it('contains all panel types', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var types = tree.getAllLeaves().map(l => l.panelType).sort();
      expect(types).toEqual(['clipper', 'clips', 'media', 'timeline']);
    });
  });

  describe('splitArea', () => {
    it('splits a leaf into branch + 2 leaves', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var media = tree.getLeafByPanelType('media');
      var result = tree.splitArea(media.id, 'vertical', 0.5);
      expect(result).not.toBeNull();
      expect(tree.getAllLeaves()).toHaveLength(5);
      var parent = tree.findParent(media.id);
      expect(parent.type).toBe('branch');
      expect(parent.direction).toBe('vertical');
    });

    it('new leaf has panelType empty', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var media = tree.getLeafByPanelType('media');
      var result = tree.splitArea(media.id, 'horizontal', 0.5);
      var newLeaf = tree.findNode(result.newLeafId);
      expect(newLeaf.panelType).toBe('empty');
    });
  });

  describe('joinAreas', () => {
    it('removes sibling and promotes kept leaf', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var preview = tree.getLeafByPanelType('clipper');
      var timeline = tree.getLeafByPanelType('timeline');
      tree.joinAreas(preview.id, timeline.id);
      expect(tree.getAllLeaves()).toHaveLength(3);
      expect(tree.getLeafByPanelType('timeline')).toBeNull();
      expect(tree.getLeafByPanelType('clipper')).not.toBeNull();
    });
  });

  describe('swapAreas', () => {
    it('exchanges panel types', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var media = tree.getLeafByPanelType('media');
      var clips = tree.getLeafByPanelType('clips');
      var mediaId = media.id;
      var clipsId = clips.id;
      tree.swapAreas(mediaId, clipsId);
      expect(tree.findNode(mediaId).panelType).toBe('clips');
      expect(tree.findNode(clipsId).panelType).toBe('media');
    });
  });

  describe('findAdjacentLeaf', () => {
    it('finds right neighbor of media', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var media = tree.getLeafByPanelType('media');
      var adj = tree.findAdjacentLeaf(media.id, 'right');
      expect(adj).not.toBeNull();
      expect(adj.panelType).toBe('clipper');
    });

    it('returns null at left edge', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var media = tree.getLeafByPanelType('media');
      var adj = tree.findAdjacentLeaf(media.id, 'left');
      expect(adj).toBeNull();
    });

    it('finds down neighbor of preview', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var preview = tree.getLeafByPanelType('clipper');
      var adj = tree.findAdjacentLeaf(preview.id, 'down');
      expect(adj).not.toBeNull();
      expect(adj.panelType).toBe('timeline');
    });
  });

  describe('serialize/deserialize', () => {
    it('round-trips without data loss', () => {
      tree.deserialize(tree.DEFAULT_TREE);
      var serialized = tree.serialize();
      tree.deserialize(serialized);
      expect(tree.getAllLeaves()).toHaveLength(4);
      var types = tree.getAllLeaves().map(l => l.panelType).sort();
      expect(types).toEqual(['clipper', 'clips', 'media', 'timeline']);
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
