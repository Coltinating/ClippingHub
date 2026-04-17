(function (root, factory) {
'use strict';

var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.CollabUtils = api;

})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

function cleanName(value, fallback) {
  var name = String(value || '').trim();
  return name || String(fallback || '').trim() || 'Editor';
}

function getDisplayActor(range) {
  var clipperName = cleanName(range && (range.clipperName || range.userName), 'Editor');
  var helperName = String(range && range.helperName || '').trim();
  if (!helperName || helperName.toLowerCase() === clipperName.toLowerCase()) return clipperName;
  return clipperName + ' (' + helperName + ')';
}

function getActivityVerb(status) {
  switch (String(status || '').toLowerCase()) {
    case 'marking': return 'selected';
    case 'queued': return 'queued';
    case 'downloading': return 'downloading';
    case 'done': return 'downloaded';
    case 'error': return 'failed';
    default: return String(status || 'updated').toLowerCase();
  }
}

function buildIndicatorAtTime(ranges, timeSec) {
  if (!Array.isArray(ranges) || !isFinite(timeSec)) return null;
  var names = [];
  for (var i = 0; i < ranges.length; i++) {
    var r = ranges[i];
    if (!r) continue;
    var inTime = Number(r.inTime);
    var outTime = Number(r.outTime);
    if (!isFinite(inTime) || !isFinite(outTime)) continue;
    var start = Math.min(inTime, outTime);
    var end = Math.max(inTime, outTime);
    if (timeSec < start || timeSec > end) continue;
    var name = getDisplayActor(r);
    if (names.indexOf(name) === -1) names.push(name);
  }
  if (!names.length) return null;
  return {
    text: 'Clipped/Being Clipped by ' + names.join(', '),
    names: names
  };
}

function formatClipAttribution(range) {
  var label = getDisplayActor(range);
  // getDisplayActor always returns something; detect "no identity" by checking raw fields
  var hasIdentity = !!(range && (range.clipperName || range.userName));
  if (!hasIdentity) return '';
  return 'by ' + label;
}

return {
  cleanName: cleanName,
  getDisplayActor: getDisplayActor,
  getActivityVerb: getActivityVerb,
  buildIndicatorAtTime: buildIndicatorAtTime,
  formatClipAttribution: formatClipAttribution
};

});
