(function (root, factory) {
'use strict';

var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.Delivery = api;

})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

function formatLockedClipName(helperName, rawName) {
  var helper = String(helperName == null ? '' : helperName).trim();
  var name = String(rawName == null ? '' : rawName).trim() || 'Clip';
  if (!helper) return name;
  var prefix = helper + '-';
  if (name.indexOf(prefix) === 0) return name;
  return prefix + name;
}

function buildClipDeliveryPayload(clip) {
  var c = clip || {};
  // v1 intentional exclusions: watermark, imageWatermark, outro, batch fields.
  // The Clipper's universal watermark/outro settings apply on download;
  // the Helper cannot pre-configure per-clip watermark for the Clipper yet.
  return {
    name: String(c.name || ''),
    caption: '',
    postCaption: String(c.postCaption || ''),
    inTime: Number(c.inTime) || 0,
    outTime: Number(c.outTime) || 0,
    m3u8Url: String(c.m3u8Url || ''),
    m3u8Text: c.m3u8Text == null ? null : c.m3u8Text,
    isLive: !!c.isLive,
    seekableStart: Number(c.seekableStart) || 0
  };
}

function buildClipperClipFromDelivery(delivery) {
  var p = (delivery && delivery.payload) || {};
  var helperName = (delivery && delivery.fromUserName) || '';
  return {
    id: 'd_' + (delivery.id || Math.random().toString(36).slice(2)),
    name: formatLockedClipName(helperName, p.name),
    caption: '',
    postCaption: String(p.postCaption || ''),
    inTime: Number(p.inTime) || 0,
    outTime: Number(p.outTime) || 0,
    m3u8Url: String(p.m3u8Url || ''),
    m3u8Text: p.m3u8Text == null ? null : p.m3u8Text,
    isLive: !!p.isLive,
    seekableStart: Number(p.seekableStart) || 0,
    receivedFromDeliveryId: delivery.id || '',
    sentByRangeId: delivery.rangeId || '',
    helperName: helperName,
    helperColor: (delivery && delivery.fromUserColor) || '',
    helperId: (delivery && delivery.fromUserId) || ''
  };
}

function matchExistingClipByDelivery(delivery, pendingClips) {
  if (!delivery || !Array.isArray(pendingClips)) return null;
  var rangeId = delivery.rangeId;
  if (!rangeId) return null;
  for (var i = 0; i < pendingClips.length; i++) {
    if (pendingClips[i] && pendingClips[i].sentByRangeId === rangeId) return pendingClips[i];
  }
  return null;
}

return {
  formatLockedClipName: formatLockedClipName,
  buildClipDeliveryPayload: buildClipDeliveryPayload,
  buildClipperClipFromDelivery: buildClipperClipFromDelivery,
  matchExistingClipByDelivery: matchExistingClipByDelivery
};

});
