(function () {
  'use strict';

  var params = window.floatBridge.getParams();
  var floatId = params.floatId;
  var panelType = params.panelType;

  document.getElementById('floatTitle').textContent = params.title || panelType;

  document.getElementById('floatDockBtn').addEventListener('click', function () {
    window.floatBridge.requestDock(floatId);
  });
  document.getElementById('floatCloseBtn').addEventListener('click', function () {
    window.floatBridge.requestClose(floatId);
  });

  // Receive state updates from main renderer
  window.floatBridge.onStateUpdate(function (state) {
    // Handle panel-specific state updates
    // Extended per panel type as needed
  });

  // Send messages back to main renderer
  function sendToMain(channel, data) {
    window.floatBridge.sendMessage(floatId, channel, data);
  }

  window._floatPanel = { params: params, sendToMain: sendToMain };
})();
