function getPayload() {
  const raw = window.arguments && window.arguments[0];
  return (raw && raw.wrappedJSObject) || raw || {};
}

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  byId(id).textContent = value;
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function renderWarnings(listId, warnings) {
  const list = byId(listId);
  list.textContent = "";

  if (!warnings || !warnings.length) {
    const li = document.createElement("li");
    li.textContent = "None";
    list.appendChild(li);
    return;
  }

  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    list.appendChild(li);
  }
}

function render(statusData) {
  setText("status-message", statusData.message);
  setText("current-scope-label", statusData.currentScope.label);
  setText("current-scope-type", statusData.currentScope.scopeType);
  setText("current-scope-total", formatCount(statusData.currentScope.totalItems));
  setText("current-scope-visible", formatCount(statusData.currentScope.visibleItems));
  setText(
    "current-scope-key",
    `${statusData.currentScope.scopeKey}${
      statusData.currentScope.truncated ? " (rendering capped)" : ""
    }`,
  );

  const cacheSummary = statusData.cacheSummary;
  if (!cacheSummary) {
    setText("cache-generated-at", "Not built");
    setText("cache-scope-label", "-");
    setText("cache-node-count", "0");
    setText("cache-edge-count", "0");
    setText("cache-state", "Missing");
    setText("cache-match", "No");
    renderWarnings("cache-warnings", []);
    return;
  }

  setText("cache-generated-at", cacheSummary.generatedAt || "-");
  setText("cache-scope-label", cacheSummary.scope.label);
  setText("cache-node-count", formatCount(cacheSummary.nodeCount));
  setText("cache-edge-count", formatCount(cacheSummary.edgeCount));
  setText("cache-state", cacheSummary.cacheState || "prepared");
  setText("cache-match", statusData.cacheMatchesCurrent ? "Yes" : "No");
  renderWarnings("cache-warnings", cacheSummary.warnings || []);
}

async function refreshStatus(payload) {
  const hostWindow = payload.hostWindow;
  const statusData = await hostWindow.Zotero.CitationGraph.api.getCacheStatus(hostWindow);
  payload.statusData = statusData;
  render(statusData);
}

function main() {
  const payload = getPayload();
  render(payload.statusData);

  byId("build-cache").addEventListener("click", async () => {
    setText("status-message", "Building citation graph cache...");
    await payload.hostWindow.Zotero.CitationGraph.api.buildCurrentCache(payload.hostWindow);
    await refreshStatus(payload);
  });

  byId("refresh-status").addEventListener("click", async () => {
    setText("status-message", "Refreshing cache status...");
    await refreshStatus(payload);
  });

  byId("clear-cache").addEventListener("click", async () => {
    payload.hostWindow.Zotero.CitationGraph.api.clearCache();
    await refreshStatus(payload);
  });

  byId("open-graph").addEventListener("click", async () => {
    await payload.hostWindow.Zotero.CitationGraph.api.openGraphWindow(payload.hostWindow);
  });
}

window.addEventListener("DOMContentLoaded", main, { once: true });
