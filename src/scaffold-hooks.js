import CitationGraphPlugin from "./plugin-core.js";

async function onStartup() {
  addon.data.rootURI = _globalThis.rootURI;
  CitationGraphPlugin.init({ rootURI: _globalThis.rootURI });
  addon.api = {
    buildCurrentCache(hostWindow, options) {
      return CitationGraphPlugin.buildCurrentCache(hostWindow, options);
    },
    getGraphPayload(hostWindow, options) {
      return CitationGraphPlugin.loadGraphPayload(hostWindow, options);
    },
    getCacheStatus(hostWindow) {
      return CitationGraphPlugin.getCacheStatus(hostWindow);
    },
    clearCache() {
      return CitationGraphPlugin.clearCache();
    },
    openGraphWindow(hostWindow, options) {
      return CitationGraphPlugin.openGraphWindow(hostWindow, options);
    },
    closeGraphView(hostWindow) {
      return CitationGraphPlugin.closeGraphView(hostWindow);
    },
  };
  CitationGraphPlugin.addToAllWindows();
  addon.data.initialized = true;
}

async function onMainWindowLoad(win) {
  CitationGraphPlugin.addToWindow(win);
}

async function onMainWindowUnload(win) {
  CitationGraphPlugin.removeFromWindow(win);
}

function onShutdown() {
  CitationGraphPlugin.removeFromAllWindows();
  addon.data.alive = false;
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};

