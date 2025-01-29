const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    startMisskonParse: (data) => ipcRenderer.invoke('start-misskon-parse', data),
    downloadImages: (data) => ipcRenderer.invoke('download-images', data),
    chooseDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    saveSettings: async (settings) => {
        try {
            return await ipcRenderer.invoke('save-settings', settings);
        } catch (error) {
            throw new Error(error.message || '保存设置失败');
        }
    },
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    getDefaultPicturesDir: () => ipcRenderer.invoke('get-default-pictures-dir'),
    testProxy: (proxyUrl) => ipcRenderer.invoke('test-proxy', proxyUrl),
    onRequestStatus: (callback) => ipcRenderer.on('request-status', callback),
    onImageFound: (callback) => ipcRenderer.on('image-found', callback),
    onProgress: (callback) => ipcRenderer.on('download-progress', callback)
});
