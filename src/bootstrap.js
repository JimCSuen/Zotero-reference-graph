var CitationGraphPlugin;

function log(message) {
  Zotero.debug(`Citation Graph: ${message}`);
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log("Starting");

  Services.scriptloader.loadSubScript(rootURI + "citation-graph-plugin.js");
  CitationGraphPlugin.init({ id, version, rootURI });
  CitationGraphPlugin.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  if (CitationGraphPlugin) {
    CitationGraphPlugin.addToWindow(window);
  }
}

function onMainWindowUnload({ window }) {
  if (CitationGraphPlugin) {
    CitationGraphPlugin.removeFromWindow(window);
  }
}

function shutdown() {
  log("Shutting down");
  if (CitationGraphPlugin) {
    CitationGraphPlugin.removeFromAllWindows();
  }
  CitationGraphPlugin = undefined;
}

function uninstall() {
  log("Uninstalled");
}

