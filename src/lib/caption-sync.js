(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CaptionSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function resolveCaption(input) {
    var local = input && input.local;
    var remote = input && input.remote;
    if (!remote) {
      return local ? { value: local.value || '', updatedAt: local.updatedAt || 0, source: 'local' } : { value: '', updatedAt: 0, source: 'local' };
    }
    if (!local) return { value: remote.value || '', updatedAt: remote.updatedAt || 0, source: 'remote' };
    var lt = Number(local.updatedAt) || 0;
    var rt = Number(remote.updatedAt) || 0;
    if (rt > lt) return { value: remote.value || '', updatedAt: rt, source: 'remote' };
    if (lt > rt) return { value: local.value || '', updatedAt: lt, source: 'local' };
    // tie: prefer non-empty
    if (!local.value && remote.value) return { value: remote.value, updatedAt: rt, source: 'remote' };
    return { value: local.value || '', updatedAt: lt, source: 'local' };
  }

  var STATUS_TO_STAGE = {
    marking: 'pending',
    queued: 'pending',
    downloading: 'downloading',
    done: 'downloaded',
    error: 'pending'
  };

  function projectRangeToTimelineClip(range) {
    if (!range || !range.id) return null;
    var status = String(range.status || 'done').toLowerCase();
    var stage = STATUS_TO_STAGE[status] || 'downloaded';
    var clipperName = range.clipperName || range.userName || 'Clip';
    return {
      id: range.id,
      name: range.name || (clipperName + ' - ' + range.id.slice(-4)),
      caption: range.caption || '',
      postCaption: range.postCaption || '',
      postCaptionUpdatedAt: Number(range.postCaptionUpdatedAt) || 0,
      stage: stage,
      fileName: range.fileName || '',
      filePath: range.filePath || '',
      displayPath: range.displayPath || '',
      postThumbnailDataUrl: range.postThumbnailDataUrl || '',
      inTime: Number(range.inTime) || 0,
      outTime: Number(range.outTime) || 0,
      clipperId: range.clipperId || range.userId || '',
      clipperName: clipperName,
      helperId: range.helperId || null,
      helperName: range.helperName || '',
      sentBy: range.sentBy || '',
      sentByName: range.sentByName || '',
      sentAt: Number(range.sentAt) || 0
    };
  }

  return {
    resolveCaption: resolveCaption,
    projectRangeToTimelineClip: projectRangeToTimelineClip
  };
});
