const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatBridge', {
  onStateUpdate: (cb) => ipcRenderer.on('float:state-update', (_, state) => cb(state)),
  sendMessage: (floatId, channel, data) => ipcRenderer.send('float:message', { floatId, channel, data }),
  getParams: () => {
    const params = new URLSearchParams(window.location.search);
    return {
      floatId: params.get('floatId'),
      panelType: params.get('panelType'),
      title: params.get('title')
    };
  },
  requestDock: (floatId) => ipcRenderer.invoke('float:dock', floatId),
  requestClose: (floatId) => ipcRenderer.invoke('float:close', floatId)
});
