'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('vaultbrowse', {
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  createPassword: (password, confirmPassword) =>
    ipcRenderer.invoke('auth:createPassword', password, confirmPassword),
  verifyPassword: (password) => ipcRenderer.invoke('auth:verifyPassword', password),
  changePassword: (currentPassword, newPassword, confirmPassword) =>
    ipcRenderer.invoke('auth:changePassword', currentPassword, newPassword, confirmPassword),

  getHomeUrl: () => ipcRenderer.invoke('browser:getHomeUrl'),
  navigate: (action) => ipcRenderer.invoke('browser:nav', action),
  navigateTo: (url) => ipcRenderer.invoke('browser:navigateTo', url),
  getUrl: () => ipcRenderer.invoke('browser:getUrl'),
  openSpace: (spaceId, url) => ipcRenderer.invoke('browser:openSpace', spaceId, url),
  openRecent: (domain) => ipcRenderer.invoke('browser:openRecent', domain),
  showDashboard: () => ipcRenderer.invoke('shell:showDashboard'),
  showSettings: () => ipcRenderer.invoke('shell:showSettings'),
  showPersonal: (section) => ipcRenderer.invoke('shell:showPersonal', section),

  listPrivateFiles: (spaceId, category, relativePath) =>
    ipcRenderer.invoke('personal:listFiles', spaceId, category, relativePath),
  getPrivateStats: (spaceId) => ipcRenderer.invoke('personal:getStats', spaceId),
  createPrivateFolder: (spaceId, category, relativeParent, folderName) =>
    ipcRenderer.invoke('personal:createFolder', spaceId, category, relativeParent, folderName),
  renamePrivateFile: (spaceId, category, relativePath, newName) =>
    ipcRenderer.invoke('personal:renameFile', spaceId, category, relativePath, newName),
  deletePrivateFile: (spaceId, category, relativePath) =>
    ipcRenderer.invoke('personal:deleteFile', spaceId, category, relativePath),
  importPrivateFiles: (spaceId, category) =>
    ipcRenderer.invoke('personal:importFiles', spaceId, category),
  importDroppedFiles: (spaceId, category, filePaths) =>
    ipcRenderer.invoke('personal:importDroppedFiles', spaceId, category, filePaths),
  getPrivateMediaUrl: (spaceId, category, relativePath) =>
    ipcRenderer.invoke('personal:getMediaUrl', spaceId, category, relativePath),
  getRecentFiles: (spaceId) => ipcRenderer.invoke('personal:getRecent', spaceId),
  openRecentFile: (spaceId, category, relativePath) =>
    ipcRenderer.invoke('personal:openRecentFile', spaceId, category, relativePath),
  getPersonalServices: () => ipcRenderer.invoke('personal:getServices'),

  getPrivateClipboard: () => ipcRenderer.invoke('clipboard:get'),
  setPrivateClipboard: (text) => ipcRenderer.invoke('clipboard:set', text),
  clearPrivateClipboard: () => ipcRenderer.invoke('clipboard:clear'),
  getPrivateClipboardStatus: () => ipcRenderer.invoke('clipboard:status'),
  getPrivacySettings: () => ipcRenderer.invoke('privacy:get'),
  updatePrivacySettings: (partial) => ipcRenderer.invoke('privacy:update', partial),

  listNotes: () => ipcRenderer.invoke('notes:list'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  createNote: (title, body) => ipcRenderer.invoke('notes:create', title, body),
  updateNote: (id, title, body) => ipcRenderer.invoke('notes:update', id, title, body),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),

  exportVaultBackup: (password) => ipcRenderer.invoke('backup:exportWithPassword', password),
  importVaultBackup: (password) => ipcRenderer.invoke('backup:importWithPassword', password),

  /**
   * Resolve OS paths for dropped File objects (main still re-validates).
   */
  pathsForDroppedFiles: (fileList) => {
    if (!fileList || typeof fileList.length !== 'number') {
      return [];
    }
    const paths = [];
    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList[i];
      try {
        const p = webUtils.getPathForFile(file);
        if (typeof p === 'string' && p) {
          paths.push(p);
        }
      } catch {
        // ignore unreadable entries
      }
    }
    return paths;
  },

  getLockState: () => ipcRenderer.invoke('lock:getState'),
  lock: () => ipcRenderer.invoke('lock:lock'),
  panicLock: () => ipcRenderer.invoke('lock:panic'),
  unlock: (password) => ipcRenderer.invoke('lock:unlock', password),
  setAutoLockMinutes: (minutes) => ipcRenderer.invoke('lock:setAutoLockMinutes', minutes),
  noteActivity: () => ipcRenderer.invoke('lock:noteActivity'),

  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listSpaces: () => ipcRenderer.invoke('spaces:list'),
  createSpace: (name, domains) => ipcRenderer.invoke('spaces:create', name, domains),
  switchSpace: (spaceId) => ipcRenderer.invoke('spaces:switch', spaceId),
  addDomain: (spaceId, domain, allowSubdomains) =>
    ipcRenderer.invoke('domains:add', spaceId, domain, allowSubdomains),
  removeDomain: (spaceId, domain) =>
    ipcRenderer.invoke('domains:remove', spaceId, domain),
  clearActivity: () => ipcRenderer.invoke('activity:clear'),

  onUrlChange: (cb) => on('browser:url', cb),
  onTitleChange: (cb) => on('browser:title', cb),
  onLockChange: (cb) => on('lock:changed', cb),
  onShellMode: (cb) => on('shell:mode', cb),
  onRecentUpdated: (cb) => on('recent:updated', cb),
});
