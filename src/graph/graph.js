import cytoscape from "cytoscape";

function getPayload() {
  const raw = window.arguments?.[0];
  return raw?.wrappedJSObject || raw || {};
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

function createElements(graphData) {
  const nodes = graphData.nodes.map((node) => ({
    data: {
      id: node.id,
      itemID: node.itemID,
      label: node.label,
      shortLabel: node.shortLabel,
      creatorSummary: node.creatorSummary,
      year: node.year,
      doi: node.doi,
      degree: node.degree,
      external: node.external ? 1 : 0,
    },
    classes: node.external ? "external-node" : "internal-node",
  }));

  const edges = graphData.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    },
    classes: edge.kind === "external" ? "external-edge" : "internal-edge",
  }));

  return [...nodes, ...edges];
}

function getLayoutOptions(layoutName) {
  switch (layoutName) {
    case "breadthfirst":
      return {
        name: "breadthfirst",
        directed: true,
        padding: 28,
        spacingFactor: 1.2,
        fit: true,
        animate: false,
      };
    case "concentric":
      return {
        name: "concentric",
        padding: 28,
        fit: true,
        animate: false,
      };
    case "cose":
    default:
      return {
        name: "cose",
        fit: true,
        animate: false,
        padding: 28,
        nodeRepulsion: 350000,
        idealEdgeLength: 90,
      };
  }
}

function renderWarnings(warnings) {
  const panel = byId("warnings-panel");
  const list = byId("warnings-list");
  list.textContent = "";

  if (!warnings?.length) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  for (const warning of warnings) {
    const li = document.createElement("li");
    li.textContent = warning;
    list.appendChild(li);
  }
}

function applySearch(cy, query) {
  const normalized = query.trim().toLowerCase();
  cy.batch(() => {
    cy.elements().removeClass("match");
    if (!normalized) {
      return;
    }

    cy.nodes().forEach((node) => {
      const haystack = [
        node.data("label"),
        node.data("shortLabel"),
        node.data("creatorSummary"),
        node.data("doi"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (haystack.includes(normalized)) {
        node.addClass("match");
      }
    });
  });

  const matches = cy.nodes(".match");
  if (matches.length) {
    cy.fit(matches, 80);
  }
}

function applyExternalFilter(cy, hidden) {
  cy.batch(() => {
    const externalNodes = cy.nodes(".external-node");
    const connectedEdges = externalNodes.connectedEdges();
    const displayValue = hidden ? "none" : "element";

    externalNodes.style("display", displayValue);
    connectedEdges.style("display", displayValue);
  });
}

function createSelectionController(payload) {
  let selectedNode = null;

  async function focusItem() {
    const actionStatus = byId("action-status");
    actionStatus.textContent = "";

    if (!selectedNode?.itemID) {
      actionStatus.textContent = "This node is external, so there is no Zotero item to focus.";
      return;
    }

    const hostWindow = payload.hostWindow;
    if (!hostWindow?.ZoteroPane) {
      actionStatus.textContent = "Host Zotero window is not available.";
      return;
    }

    try {
      if (typeof hostWindow.ZoteroPane.selectItem === "function") {
        await hostWindow.ZoteroPane.selectItem(selectedNode.itemID);
      }
      else if (typeof hostWindow.ZoteroPane.selectItems === "function") {
        await hostWindow.ZoteroPane.selectItems([selectedNode.itemID]);
      }

      hostWindow.focus();
      actionStatus.textContent = `Focused Zotero item ${selectedNode.itemID}.`;
    }
    catch (error) {
      actionStatus.textContent = `Could not focus item: ${error.message || error}`;
    }
  }

  function showNode(nodeData) {
    selectedNode = nodeData;
    byId("selection-empty").hidden = true;
    byId("selection-content").hidden = false;
    setText("selection-title", nodeData.shortLabel || nodeData.label || "Untitled");
    setText("selection-authors", nodeData.creatorSummary || "-");
    setText("selection-year", nodeData.year || "-");
    setText("selection-doi", nodeData.doi || "-");
    setText("selection-degree", String(nodeData.degree || 0));
    byId("open-item").disabled = !nodeData.itemID;
  }

  function clear() {
    selectedNode = null;
    byId("selection-empty").hidden = false;
    byId("selection-content").hidden = true;
    byId("action-status").textContent = "";
  }

  byId("open-item").addEventListener("click", () => {
    void focusItem();
  });

  return { showNode, clear };
}

function main() {
  const payload = getPayload();
  const graphData = payload.graphData || { nodes: [], edges: [], warnings: [], citationSources: [], scope: {} };

  const internalCount = graphData.nodes.filter((node) => !node.external).length;
  const externalCount = graphData.nodes.filter((node) => node.external).length;

  setText(
    "scope-summary",
    `${graphData.scope.label || "Current scope"} • ${formatCount(graphData.scope.visibleItems)} visible papers`
      + (graphData.scope.truncated ? ` (capped from ${formatCount(graphData.scope.totalItems)})` : ""),
  );
  setText("internal-count", formatCount(internalCount));
  setText("external-count", formatCount(externalCount));
  setText("edge-count", formatCount(graphData.edges.length));
  setText("source-count", formatCount(graphData.citationSources?.length || 0));
  renderWarnings(graphData.warnings || []);

  const selection = createSelectionController(payload);
  selection.clear();

  const cy = cytoscape({
    container: byId("graph"),
    elements: createElements(graphData),
    layout: getLayoutOptions("cose"),
    wheelSensitivity: 0.15,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "#2563eb",
          "border-width": 2,
          "border-color": "#1d4ed8",
          label: "data(shortLabel)",
          color: "#0f172a",
          "font-size": 10,
          "text-wrap": "wrap",
          "text-max-width": 120,
          "text-valign": "bottom",
          "text-margin-y": 10,
          width: "mapData(degree, 0, 12, 20, 52)",
          height: "mapData(degree, 0, 12, 20, 52)",
        },
      },
      {
        selector: ".external-node",
        style: {
          "background-color": "#f59e0b",
          "border-color": "#d97706",
          shape: "diamond",
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": "#94a3b8",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          opacity: 0.75,
        },
      },
      {
        selector: ".external-edge",
        style: {
          "line-style": "dashed",
        },
      },
      {
        selector: ".match",
        style: {
          "border-color": "#dc2626",
          "border-width": 4,
        },
      },
      {
        selector: ":selected",
        style: {
          "background-color": "#7c3aed",
          "border-color": "#6d28d9",
          "line-color": "#7c3aed",
          "target-arrow-color": "#7c3aed",
        },
      },
    ],
  });

  cy.on("tap", "node", (event) => {
    const node = event.target;
    selection.showNode({
      itemID: node.data("itemID"),
      label: node.data("label"),
      shortLabel: node.data("shortLabel"),
      creatorSummary: node.data("creatorSummary"),
      year: node.data("year"),
      doi: node.data("doi"),
      degree: node.data("degree"),
    });
  });

  byId("apply-layout").addEventListener("click", () => {
    cy.layout(getLayoutOptions(byId("layout-select").value)).run();
  });

  byId("fit-graph").addEventListener("click", () => {
    cy.fit(cy.elements(":visible"), 60);
  });

  byId("search-input").addEventListener("input", (event) => {
    applySearch(cy, event.target.value);
  });

  byId("hide-external").addEventListener("change", (event) => {
    applyExternalFilter(cy, event.target.checked);
    cy.fit(cy.elements(":visible"), 60);
  });
}

window.addEventListener("DOMContentLoaded", main, { once: true });
