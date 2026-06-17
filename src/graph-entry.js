import cytoscape from "cytoscape";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

const GRAPH_WINDOW_PREF = "extensions.zotero.citationgraph.graphWindow.current";
const EMPTY_GRAPH_MESSAGE =
  "No regular Zotero items were found in the selected library or collection.";

let currentState = {
  payload: null,
  graphData: null,
  layoutName: "cose",
  query: "",
  selectedNodeID: null,
  cy: null,
  simulation: null,
  simulationFrame: null,
  simulationNodes: new Map(),
};

window.__citationGraphBundleLoaded = true;

const debugEntries = [];

function stringifyDebug(value) {
  if (value instanceof Error) {
    return value.stack || value.message || String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function writeDebugLog() {
  const node = document.getElementById("debug-log");
  if (node) {
    const bootstrapEntries = window.__citationGraphBootstrapLog || [];
    node.textContent = bootstrapEntries.concat(debugEntries).join("\n");
  }
}

function debugLog(message, details = null) {
  if (typeof window.__citationGraphBootstrapWrite === "function") {
    window.__citationGraphBootstrapWrite(`bundle debug: ${message}`);
  }
  const entry = details == null ? message : `${message}\n${stringifyDebug(details)}`;
  debugEntries.push(entry);
  writeDebugLog();
  try {
    if (typeof Zotero !== "undefined" && typeof Zotero.debug === "function") {
      Zotero.debug(`Citation Graph Debug: ${entry}`);
    }
  } catch (_error) {}
}

function getPayload() {
  debugLog("getPayload: start");
  if (window.__CITATION_GRAPH_PAYLOAD__) {
    debugLog("getPayload: using window.__CITATION_GRAPH_PAYLOAD__");
    return window.__CITATION_GRAPH_PAYLOAD__;
  }

  try {
    if (
      typeof Services !== "undefined" &&
      Services.prefs &&
      typeof Services.prefs.getStringPref === "function"
    ) {
      const graphDataJSON = Services.prefs.getStringPref(GRAPH_WINDOW_PREF, "");
      if (graphDataJSON) {
        debugLog("getPayload: loaded graph payload from prefs", {
          jsonLength: graphDataJSON.length,
        });
        return {
          graphData: JSON.parse(graphDataJSON),
        };
      }
      debugLog("getPayload: graph payload pref is empty");
    }
  } catch (error) {
    debugLog("getPayload: pref read failed", error);
    return {
      graphData: null,
      graphDataJSONError: error && (error.message || String(error)),
    };
  }

  const raw = window.arguments && window.arguments[0];
  const payload = (raw && raw.wrappedJSObject) || raw || {};
  debugLog("getPayload: using window arguments", {
    hasRaw: !!raw,
    keys: Object.keys(payload || {}),
  });
  if (payload && typeof payload.graphDataJSON === "string") {
    try {
      debugLog("getPayload: parsing graphDataJSON from window arguments", {
        jsonLength: payload.graphDataJSON.length,
      });
      return {
        ...payload,
        graphData: JSON.parse(payload.graphDataJSON),
      };
    } catch (error) {
      debugLog("getPayload: graphDataJSON parse failed", error);
      return {
        ...payload,
        graphData: null,
        graphDataJSONError: error && (error.message || String(error)),
      };
    }
  }
  return payload;
}

function hasGraphPayload(payload) {
  return !!(
    payload &&
    payload.graphData &&
    Array.isArray(payload.graphData.nodes) &&
    Array.isArray(payload.graphData.edges)
  );
}

function getCitationGraphApi() {
  return (
    (typeof Zotero !== "undefined" && Zotero.CitationGraph && Zotero.CitationGraph.api)
    || null
  );
}

function resolveHostWindow(payload) {
  try {
    if (typeof Zotero !== "undefined" && typeof Zotero.getMainWindows === "function") {
      const mainWindows = Zotero.getMainWindows() || [];
      const zoteroWindow = mainWindows.find((candidate) => candidate && candidate.ZoteroPane);
      if (zoteroWindow) {
        debugLog("resolveHostWindow: resolved via Zotero.getMainWindows()");
        return zoteroWindow;
      }
      debugLog("resolveHostWindow: no ZoteroPane window found in Zotero.getMainWindows()");
    }
  } catch (error) {
    debugLog("resolveHostWindow: Zotero.getMainWindows failed", error);
  }

  if (payload && payload.hostWindow && payload.hostWindow.ZoteroPane) {
    debugLog("resolveHostWindow: resolved via payload.hostWindow");
    return payload.hostWindow;
  }

  try {
    if (window.opener && window.opener !== window && window.opener.ZoteroPane) {
      debugLog("resolveHostWindow: resolved via window.opener");
      return window.opener;
    }
  } catch (error) {
    debugLog("resolveHostWindow: window.opener lookup failed", error);
  }

  try {
    if (window.parent && window.parent !== window && window.parent.ZoteroPane) {
      debugLog("resolveHostWindow: resolved via window.parent");
      return window.parent;
    }
  } catch (error) {
    debugLog("resolveHostWindow: window.parent lookup failed", error);
  }

  try {
    if (window.top && window.top !== window && window.top.ZoteroPane) {
      debugLog("resolveHostWindow: resolved via window.top");
      return window.top;
    }
  } catch (error) {
    debugLog("resolveHostWindow: window.top lookup failed", error);
  }

  debugLog("resolveHostWindow: failed to resolve host window");
  return null;
}

function normalizeGraphData(graphData) {
  const safeGraphData = graphData || {};
  return {
    ...safeGraphData,
    activeItemID: safeGraphData.activeItemID || null,
    activeNodeID: safeGraphData.activeNodeID || null,
    nodes: Array.isArray(safeGraphData.nodes) ? safeGraphData.nodes : [],
    edges: Array.isArray(safeGraphData.edges) ? safeGraphData.edges : [],
    warnings: Array.isArray(safeGraphData.warnings) ? safeGraphData.warnings : [],
    libraries: Array.isArray(safeGraphData.libraries) ? safeGraphData.libraries : [],
    citationSources: Array.isArray(safeGraphData.citationSources)
      ? safeGraphData.citationSources
      : [],
    scope: safeGraphData.scope || {},
  };
}

async function loadGraphPayloadFromHost(payload) {
  if (payload && payload.graphDataJSONError) {
    debugLog("loadGraphPayloadFromHost: existing payload parse error", payload.graphDataJSONError);
    throw new Error(`Graph payload JSON could not be parsed: ${payload.graphDataJSONError}`);
  }

  if (hasGraphPayload(payload)) {
    debugLog("loadGraphPayloadFromHost: using payload graph data directly", {
      nodeCount: payload.graphData.nodes.length,
      edgeCount: payload.graphData.edges.length,
    });
    return {
      graphData: normalizeGraphData(payload.graphData),
      hostWindow: resolveHostWindow(payload),
    };
  }

  const api = getCitationGraphApi();
  if (!api || typeof api.getGraphPayload !== "function") {
    debugLog("loadGraphPayloadFromHost: addon API unavailable", {
      hasZotero: typeof Zotero !== "undefined",
      hasCitationGraph: !!(typeof Zotero !== "undefined" && Zotero.CitationGraph),
      apiKeys: api ? Object.keys(api) : [],
    });
    throw new Error("Citation Graph API is not available in this graph window.");
  }

  const hostWindow = resolveHostWindow(payload);
  debugLog("loadGraphPayloadFromHost: calling Zotero.CitationGraph.api.getGraphPayload()");
  const graphData = normalizeGraphData(await api.getGraphPayload());
  debugLog("loadGraphPayloadFromHost: API returned graph data", {
    nodeCount: graphData.nodes.length,
    edgeCount: graphData.edges.length,
    warningCount: graphData.warnings.length,
    scope: graphData.scope,
  });
  return {
    graphData,
    hostWindow,
  };
}

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (node) {
    node.textContent = value;
  }
}

function showError(error) {
  debugLog("showError called", error);
  const panel = byId("error-panel");
  const message = byId("error-message");
  if (!panel || !message) {
    return;
  }

  panel.hidden = false;
  message.textContent =
    (error && (error.stack || error.message)) || String(error) || "Unknown graph rendering error";
}

function clearError() {
  const panel = byId("error-panel");
  const message = byId("error-message");
  if (!panel || !message) {
    return;
  }
  panel.hidden = true;
  message.textContent = "";
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function renderWarnings(warnings) {
  const panel = byId("warnings-panel");
  const list = byId("warnings-list");
  list.textContent = "";

  if (!warnings || !warnings.length) {
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

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function truncateLabel(value, limit = 34) {
  const text = String(value || "").trim();
  if (!text) {
    return "Untitled";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function getLabelLimit(nodeData) {
  const degree = Number(nodeData?.degree || 0);
  const external = !!nodeData?.external;
  const baseLimit = external ? 12 : 15;
  return Math.max(baseLimit, Math.min(external ? 20 : 28, baseLimit + degree * 2));
}

function getDisplayLabel(nodeData) {
  return truncateLabel(
    nodeData.shortLabel || nodeData.label || nodeData.id,
    getLabelLimit(nodeData),
  );
}

function extractNodeData(source) {
  const nodeData = typeof source.data === "function" ? source.data() : source;
  return {
    id: nodeData.id,
    itemID: nodeData.itemID,
    label: nodeData.label,
    shortLabel: nodeData.shortLabel,
    creatorSummary: nodeData.creatorSummary,
    year: nodeData.year,
    doi: nodeData.doi,
    degree: nodeData.degree,
    external: !!nodeData.external,
  };
}

function clearChildren(node) {
  if (node) {
    node.textContent = "";
  }
}

function getNodeTitle(nodeData) {
  return nodeData.shortLabel || nodeData.label || "Untitled";
}

function getNodeByID(nodeID) {
  if (!currentState.cy || !nodeID) {
    return null;
  }

  const node = currentState.cy.getElementById(nodeID);
  return node && node.nonempty() ? node : null;
}

function createGraphElements(graphData) {
  const nodes = graphData.nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.id,
      itemID: node.itemID,
      label: node.label,
      shortLabel: node.shortLabel,
      displayLabel: getDisplayLabel(node),
      creatorSummary: node.creatorSummary || "",
      year: node.year || "",
      doi: node.doi || "",
      degree: Number(node.degree || 0),
      external: node.external ? 1 : 0,
    },
    classes: node.external ? "external-node" : "internal-node",
  }));

  const edges = graphData.edges.map((edge) => ({
    group: "edges",
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    },
    classes:
      edge.kind === "cited-by"
        ? "internal-edge cited-by-edge"
        : edge.kind === "external"
          ? "external-edge"
          : "internal-edge cites-edge",
  }));

  return [...nodes, ...edges];
}

function getLayoutOptions(layoutName, fit = true) {
  switch (layoutName) {
    case "breadthfirst":
      return {
        name: "breadthfirst",
        directed: true,
        circle: false,
        spacingFactor: 1.28,
        padding: 90,
        animate: true,
        animationDuration: 700,
        fit,
      };
    case "concentric":
      return {
        name: "concentric",
        padding: 90,
        animate: true,
        animationDuration: 700,
        fit,
        avoidOverlap: true,
        concentric(node) {
          return node.data("degree") + (node.data("external") ? 0 : 4);
        },
        levelWidth() {
          return 2;
        },
      };
    case "cose":
    default:
      return {
        name: "cose",
        padding: 110,
        animate: true,
        animationDuration: 900,
        fit,
        nodeRepulsion: 1600000,
        idealEdgeLength(edge) {
          return edge.hasClass("external-edge") ? 180 : 120;
        },
        edgeElasticity(edge) {
          return edge.hasClass("external-edge") ? 70 : 140;
        },
        gravity: 1,
        numIter: 1400,
        randomize: true,
      };
  }
}

function isForceLayout(layoutName = currentState.layoutName) {
  return layoutName === "cose";
}

function stopForceSimulation() {
  if (currentState.simulationFrame != null) {
    window.cancelAnimationFrame(currentState.simulationFrame);
    currentState.simulationFrame = null;
  }

  if (currentState.simulation) {
    currentState.simulation.stop();
    currentState.simulation = null;
  }

  currentState.simulationNodes = new Map();
}

function getForceCenter() {
  const container = byId("graph");
  const rect = container ? container.getBoundingClientRect() : null;
  return {
    x: Math.max(640, rect?.width || 960) / 2,
    y: Math.max(480, rect?.height || 720) / 2,
  };
}

function getNodeRadius(nodeData) {
  const degree = Number(nodeData?.degree || 0);
  const external = !!nodeData?.external;
  const minRadius = external ? 10 : 12;
  const maxRadius = external ? 25 : 30;
  return Math.max(minRadius, Math.min(maxRadius, minRadius + degree * 1.65));
}

function seedForcePositions(cyNodes) {
  const center = getForceCenter();
  const radiusStep = 26;
  const angleStep = Math.PI * (3 - Math.sqrt(5));

  cyNodes.positions((node, index) => {
    const current = node.position();
    if (Number.isFinite(current.x) && Number.isFinite(current.y)) {
      return current;
    }

    const radius = 50 + Math.sqrt(index + 1) * radiusStep;
    const angle = index * angleStep;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function scheduleSimulationRender() {
  if (!currentState.cy || currentState.simulationFrame != null) {
    return;
  }

  currentState.simulationFrame = window.requestAnimationFrame(() => {
    currentState.simulationFrame = null;
    if (!currentState.cy) {
      return;
    }

    currentState.cy.batch(() => {
      const alpha = currentState.simulation ? currentState.simulation.alpha() : 0;
      const interpolation = alpha > 0.18 ? 0.26 : alpha > 0.08 ? 0.38 : 0.54;
      for (const [nodeID, simulationNode] of currentState.simulationNodes.entries()) {
        const node = currentState.cy.getElementById(nodeID);
        if (!node || node.empty()) {
          continue;
        }
        const currentPosition = node.position();
        const nextX = currentPosition.x + (simulationNode.x - currentPosition.x) * interpolation;
        const nextY = currentPosition.y + (simulationNode.y - currentPosition.y) * interpolation;
        node.position({
          x: Math.abs(simulationNode.x - currentPosition.x) < 0.35 ? simulationNode.x : nextX,
          y: Math.abs(simulationNode.y - currentPosition.y) < 0.35 ? simulationNode.y : nextY,
        });
      }
    });
  });
}

function buildForceSimulationModel(randomize = false) {
  const cy = currentState.cy;
  const visibleNodes = cy.nodes(":visible");
  if (!visibleNodes.length) {
    return null;
  }

  if (randomize) {
    const center = getForceCenter();
    const radiusStep = 32;
    const angleStep = Math.PI * (3 - Math.sqrt(5));
    visibleNodes.positions((node, index) => {
      const radius = 36 + Math.sqrt(index + 1) * radiusStep;
      const angle = index * angleStep;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
  } else {
    seedForcePositions(visibleNodes);
  }

  const simulationNodes = visibleNodes.map((node) => {
    const position = node.position();
    return {
      id: node.id(),
      degree: Number(node.data("degree") || 0),
      external: Number(node.data("external") || 0),
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    };
  });
  const simulationNodeMap = new Map(simulationNodes.map((node) => [node.id, node]));

  const simulationLinks = cy.edges(":visible").map((edge) => ({
    source: edge.data("source"),
    target: edge.data("target"),
    kind: edge.data("kind"),
  }));

  return {
    simulationNodes,
    simulationNodeMap,
    simulationLinks,
  };
}

function startForceSimulation(randomize = false) {
  stopForceSimulation();
  if (!currentState.cy || !isForceLayout()) {
    return;
  }

  const model = buildForceSimulationModel(randomize);
  if (!model) {
    return;
  }

  currentState.simulationNodes = model.simulationNodeMap;
  const center = getForceCenter();

  currentState.simulation = forceSimulation(model.simulationNodes)
    .alpha(0.9)
    .alphaMin(0.015)
    .alphaDecay(0.024)
    .velocityDecay(0.34)
    .force(
      "charge",
      forceManyBody()
        .strength((node) => -82 - Math.min(150, node.degree * 12))
        .distanceMax(460),
    )
    .force(
      "link",
      forceLink(model.simulationLinks)
        .id((node) => node.id)
        .distance((link) => (link.kind === "external" ? 176 : 116))
        .strength((link) => (link.kind === "external" ? 0.05 : 0.1)),
    )
    .force(
      "collision",
      forceCollide((node) => getNodeRadius(node) + 11).strength(0.68),
    )
    .force("x", forceX(center.x).strength(0.022))
    .force("y", forceY(center.y).strength(0.022))
    .on("tick", () => {
      scheduleSimulationRender();
    });
}

function createGraphStyle() {
  return [
    {
      selector: "node",
      style: {
        shape: "ellipse",
        label: "data(displayLabel)",
        width: "mapData(degree, 0, 12, 12, 30)",
        height: "mapData(degree, 0, 12, 12, 30)",
        "background-color": "#22c55e",
        "border-width": 2,
        "border-color": "#16a34a",
        color: "#1f2937",
        "font-size": 10,
        "font-weight": 500,
        "text-wrap": "wrap",
        "text-max-width": "mapData(degree, 0, 12, 72, 120)",
        "text-valign": "bottom",
        "text-margin-y": 8,
        "text-outline-width": 3,
        "text-outline-color": "#ffffff",
        "text-outline-opacity": 0.62,
        "overlay-opacity": 0,
        "shadow-blur": 18,
        "shadow-color": "#16a34a",
        "shadow-opacity": 0.16,
        "shadow-offset-x": 0,
        "shadow-offset-y": 0,
        "z-index": 30,
        "z-index-compare": "manual",
        opacity: 0.94,
      },
    },
    {
      selector: ".internal-node",
      style: {
        "background-color": "#22c55e",
        "border-color": "#16a34a",
        "shadow-color": "#16a34a",
      },
    },
    {
      selector: ".external-node",
      style: {
        shape: "diamond",
        "background-color": "#4ade80",
        "border-color": "#16a34a",
        color: "#1f2937",
        "shadow-color": "#16a34a",
        width: "mapData(degree, 0, 12, 10, 25)",
        height: "mapData(degree, 0, 12, 10, 25)",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.8,
        "curve-style": "bezier",
        "line-color": "#1a1a1a",
        "target-arrow-color": "#1a1a1a",
        "target-arrow-shape": "triangle-tee",
        "target-arrow-size": 13,
        "z-index": 1,
        "z-index-compare": "manual",
        opacity: 0.82,
      },
    },
    {
      selector: ".external-edge",
      style: {
        "line-style": "dashed",
        opacity: 0.28,
      },
    },
    {
      selector: ".is-muted",
      style: {
        opacity: 0.1,
        "text-opacity": 0.12,
      },
    },
    {
      selector: "node.is-muted",
      style: {
        "z-index": 8,
      },
    },
    {
      selector: "edge.is-muted",
      style: {
        opacity: 0.06,
        "z-index": 1,
      },
    },
    {
      selector: ".is-neighbor",
      style: {
        opacity: 0.96,
        "text-opacity": 1,
      },
    },
    {
      selector: "edge.is-neighbor",
      style: {
        opacity: 0.92,
        width: 2.6,
        "line-color": "#1a1a1a",
        "target-arrow-color": "#1a1a1a",
        "z-index": 20,
      },
    },
    {
      selector: ".is-match",
      style: {
        "border-color": "#fbbf24",
        "border-width": 3.5,
        "shadow-color": "#fbbf24",
        "shadow-opacity": 0.4,
      },
    },
    {
      selector: ".is-selected",
      style: {
        "border-color": "#ffffff",
        "border-width": 3,
        "background-color": "#60a5fa",
        "shadow-blur": 26,
        "shadow-opacity": 0.6,
        "shadow-color": "#93c5fd",
        "z-index": 40,
      },
    },
    {
      selector: ".external-node.is-selected",
      style: {
        "background-color": "#67e8f9",
      },
    },
  ];
}

function createSelectionController(payload) {
  let selectedNode = null;
  let controller = null;

  async function focusItemForNode(nodeData = selectedNode, statusTarget = byId("action-status")) {
    const actionStatus = statusTarget || byId("action-status");
    actionStatus.textContent = "";

    if (!nodeData || !nodeData.itemID) {
      actionStatus.textContent =
        "This node is external, so there is no Zotero item to focus.";
      return;
    }

    const hostWindow = resolveHostWindow(payload);
    if (!hostWindow || !hostWindow.ZoteroPane) {
      actionStatus.textContent = "Host Zotero window is not available.";
      return;
    }

    try {
      if (typeof hostWindow.ZoteroPane.selectItem === "function") {
        await hostWindow.ZoteroPane.selectItem(nodeData.itemID);
      } else if (typeof hostWindow.ZoteroPane.selectItems === "function") {
        await hostWindow.ZoteroPane.selectItems([nodeData.itemID]);
      }

      hostWindow.focus();
      actionStatus.textContent = `Focused Zotero item ${nodeData.itemID}.`;
    } catch (error) {
      actionStatus.textContent = `Could not focus item: ${error.message || error}`;
    }
  }

  function renderConnectedPapers(nodeData) {
    const list = byId("connected-papers-list");
    const empty = byId("connected-papers-empty");
    clearChildren(list);

    const selectedGraphNode = getNodeByID(nodeData?.id);
    if (!selectedGraphNode) {
      empty.hidden = false;
      return;
    }

    const neighbors = new Map();
    selectedGraphNode.connectedEdges(":visible").forEach((edge) => {
      const sourceNode = edge.source();
      const targetNode = edge.target();
      const neighborNode = sourceNode.id() === nodeData.id ? targetNode : sourceNode;
      if (!neighborNode || !neighborNode.nonempty() || !neighborNode.visible()) {
        return;
      }

      const neighborID = neighborNode.id();
      if (!neighbors.has(neighborID)) {
        neighbors.set(neighborID, {
          node: extractNodeData(neighborNode),
          relations: new Set(),
        });
      }

      neighbors
        .get(neighborID)
        .relations
        .add(sourceNode.id() === nodeData.id ? "Cites" : "Cited by");
    });

    const entries = [...neighbors.values()].sort((left, right) => {
      const degreeDiff = Number(right.node.degree || 0) - Number(left.node.degree || 0);
      if (degreeDiff !== 0) {
        return degreeDiff;
      }
      return getNodeTitle(left.node).localeCompare(getNodeTitle(right.node));
    });

    empty.hidden = entries.length > 0;
    for (const entry of entries) {
      const item = document.createElement("li");
      item.className = "connected-paper-item";

      const textWrap = document.createElement("div");
      textWrap.className = "connected-paper-text";

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "connected-paper-link";
      selectButton.textContent = truncateLabel(getNodeTitle(entry.node), 62);
      selectButton.addEventListener("click", () => {
        controller.selectNode(entry.node.id);
      });

      const meta = document.createElement("div");
      meta.className = "connected-paper-meta";
      meta.textContent = [
        [...entry.relations].join(" / "),
        entry.node.creatorSummary || "",
        entry.node.year || "",
      ]
        .filter(Boolean)
        .join(" • ");

      textWrap.appendChild(selectButton);
      textWrap.appendChild(meta);

      const focusButton = document.createElement("button");
      focusButton.type = "button";
      focusButton.className = "connected-paper-action";
      focusButton.textContent = "Focus";
      focusButton.disabled = !entry.node.itemID;
      focusButton.addEventListener("click", () => {
        void focusItemForNode(entry.node);
      });

      item.appendChild(textWrap);
      item.appendChild(focusButton);
      list.appendChild(item);
    }
  }

  function selectNode(nodeID) {
    const nextNode = getNodeByID(nodeID);
    if (!nextNode || !nextNode.visible()) {
      return;
    }

    currentState.selectedNodeID = nodeID;
    applyVisualState(controller);
    fitGraph();
  }

  function showNode(nodeData) {
    selectedNode = nodeData;
    setText("selection-title", nodeData.shortLabel || nodeData.label || "Untitled");
    setText("selection-authors", nodeData.creatorSummary || "-");
    setText("selection-year", nodeData.year || "-");
    setText("selection-doi", nodeData.doi || "-");
    setText("selection-degree", String(nodeData.degree || 0));
    byId("open-item").disabled = !nodeData.itemID;
    renderConnectedPapers(nodeData);
  }

  function clear() {
    selectedNode = null;
    setText("selection-title", "-");
    setText("selection-authors", "-");
    setText("selection-year", "-");
    setText("selection-doi", "-");
    setText("selection-degree", "-");
    byId("open-item").disabled = true;
    byId("action-status").textContent = "";
    renderConnectedPapers(null);
  }

  byId("open-item").onclick = () => {
    void focusItemForNode();
  };

  controller = {
    showNode,
    clear,
    selectNode,
  };

  return controller;
}

function destroyCurrentGraph() {
  stopForceSimulation();
  if (currentState.cy) {
    currentState.cy.destroy();
    currentState.cy = null;
  }
  const graphNode = byId("graph");
  if (graphNode) {
    graphNode.textContent = "";
  }
}

function appendEmptyGraphState() {
  const empty = document.createElement("div");
  empty.className = "graph-empty";
  empty.textContent = EMPTY_GRAPH_MESSAGE;
  byId("graph").appendChild(empty);
}

function getVisibleElements() {
  if (!currentState.cy) {
    return null;
  }
  return currentState.cy.elements(":visible");
}

function getSearchMatches() {
  if (!currentState.cy) {
    return [];
  }
  const normalized = normalizeSearch(currentState.query);
  if (!normalized) {
    return currentState.cy.collection();
  }
  return currentState.cy.nodes(":visible").filter((node) => {
    const haystack = [
      node.data("label"),
      node.data("shortLabel"),
      node.data("creatorSummary"),
      node.data("doi"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

function applyExternalFilter() {
  if (!currentState.cy) {
    return;
  }

  currentState.cy.batch(() => {
    const externalNodes = currentState.cy.nodes(".external-node");
    const externalEdges = currentState.cy.edges(".external-edge");
    const displayValue = currentState.hideExternal ? "none" : "element";

    externalNodes.style("display", displayValue);
    externalEdges.style("display", displayValue);
  });
}

function getSelectedNode() {
  if (!currentState.cy || !currentState.selectedNodeID) {
    return null;
  }
  const selectedNode = currentState.cy.getElementById(currentState.selectedNodeID);
  return selectedNode && selectedNode.nonempty() && selectedNode.visible() ? selectedNode : null;
}

function applyVisualState(selection) {
  if (!currentState.cy) {
    return;
  }

  const cy = currentState.cy;
  const visibleElements = getVisibleElements();
  const matches = getSearchMatches();
  const selectedNode = getSelectedNode();

  cy.batch(() => {
    cy.elements().removeClass("is-muted is-neighbor is-selected is-match");

    if (visibleElements && visibleElements.length && (selectedNode || matches.length)) {
      visibleElements.addClass("is-muted");
    }

    if (selectedNode) {
      const focusedNeighborhood = selectedNode.closedNeighborhood().filter(":visible");
      focusedNeighborhood.removeClass("is-muted").addClass("is-neighbor");
      selectedNode.removeClass("is-neighbor").addClass("is-selected");
    }

    if (matches.length) {
      matches.removeClass("is-muted").addClass("is-match");
      matches.connectedEdges().filter(":visible").removeClass("is-muted");
    }
  });

  if (selectedNode) {
    selection.showNode(extractNodeData(selectedNode));
    return;
  }

  currentState.selectedNodeID = null;
  selection.clear();
}

function runLayout(fit = true) {
  if (!currentState.cy) {
    return;
  }

  if (isForceLayout()) {
    startForceSimulation(true);
    window.setTimeout(() => {
      fitGraph();
    }, 180);
    return;
  }

  stopForceSimulation();
  currentState.cy.layout(getLayoutOptions(currentState.layoutName, fit)).run();
}

function getFitCollection() {
  if (!currentState.cy) {
    return null;
  }

  const selectedNode = getSelectedNode();
  if (selectedNode) {
    const focused = selectedNode.closedNeighborhood().filter(":visible");
    if (focused.length) {
      return focused;
    }
  }

  const matches = getSearchMatches();
  if (matches.length) {
    const focusedMatches = matches.closedNeighborhood().filter(":visible");
    if (focusedMatches.length) {
      return focusedMatches;
    }
  }

  const visibleElements = getVisibleElements();
  return visibleElements && visibleElements.length ? visibleElements : null;
}

function fitGraph() {
  if (!currentState.cy) {
    return;
  }
  const target = getFitCollection();
  if (target && target.length) {
    currentState.cy.animate({
      fit: {
        eles: target,
        padding: 100,
      },
      duration: 350,
      easing: "ease-out-cubic",
    });
  }
}

function initializeGraph(payload, selection) {
  destroyCurrentGraph();

  const graphData = currentState.graphData;
  if (!graphData.nodes.length) {
    appendEmptyGraphState();
    selection.clear();
    return;
  }

  currentState.cy = cytoscape({
    container: byId("graph"),
    elements: createGraphElements(graphData),
    style: createGraphStyle(),
    layout: isForceLayout()
      ? {
          name: "preset",
          fit: false,
        }
      : getLayoutOptions(currentState.layoutName),
    wheelSensitivity: 0.16,
    minZoom: 0.18,
    maxZoom: 3.5,
    motionBlur: true,
    boxSelectionEnabled: false,
  });

  currentState.cy.on("tap", "node", (event) => {
    selection.selectNode(event.target.id());
  });

  currentState.cy.on("tap", (event) => {
    if (event.target === currentState.cy) {
      currentState.selectedNodeID = null;
      applyVisualState(selection);
    }
  });

  currentState.cy.on("layoutstop", () => {
    applyVisualState(selection);
  });

  currentState.cy.on("grab", "node", (event) => {
    if (!currentState.simulation) {
      return;
    }
    const simulationNode = currentState.simulationNodes.get(event.target.id());
    if (!simulationNode) {
      return;
    }
    const position = event.target.position();
    simulationNode.fx = position.x;
    simulationNode.fy = position.y;
    currentState.simulation.alphaTarget(0.16).restart();
  });

  currentState.cy.on("drag", "node", (event) => {
    if (!currentState.simulation) {
      return;
    }
    const simulationNode = currentState.simulationNodes.get(event.target.id());
    if (!simulationNode) {
      return;
    }
    const position = event.target.position();
    simulationNode.fx = position.x;
    simulationNode.fy = position.y;
  });

  currentState.cy.on("free", "node", (event) => {
    if (!currentState.simulation) {
      return;
    }
    const simulationNode = currentState.simulationNodes.get(event.target.id());
    if (!simulationNode) {
      return;
    }
    const position = event.target.position();
    simulationNode.fx = position.x;
    simulationNode.fy = position.y;
    currentState.simulation.alphaTarget(0.04).restart();
  });

  applyExternalFilter();
  currentState.selectedNodeID =
    (graphData.activeNodeID && getNodeByID(graphData.activeNodeID) && graphData.activeNodeID)
    || (currentState.selectedNodeID && getNodeByID(currentState.selectedNodeID)
      && currentState.selectedNodeID)
    || null;
  applyVisualState(selection);

  if (isForceLayout()) {
    startForceSimulation(true);
    window.setTimeout(() => {
      fitGraph();
    }, 180);
  } else {
    fitGraph();
  }
}

function bindControls(payload, selection) {
  byId("search-input").oninput = (event) => {
    currentState.query = event.target.value;
    applyVisualState(selection);
    if (!currentState.selectedNodeID) {
      fitGraph();
    }
  };

  byId("build-graph").onclick = async (event) => {
    const button = event.currentTarget;
    const actionStatus = byId("action-status");
    const hostWindow = resolveHostWindow(payload);
    const api = getCitationGraphApi();

    if (!hostWindow || !hostWindow.ZoteroPane || !api || typeof api.buildCurrentCache !== "function") {
      actionStatus.textContent = "Could not rebuild the citation graph from this window.";
      return;
    }

    button.disabled = true;
    actionStatus.textContent = "Building citation graph...";
    try {
      await api.buildCurrentCache(hostWindow);
      actionStatus.textContent = "Citation graph rebuilt.";
    } catch (error) {
      actionStatus.textContent = `Could not rebuild graph: ${error.message || error}`;
    } finally {
      button.disabled = false;
    }
  };

  const closeButton = byId("close-graph");
  if (closeButton) {
    closeButton.onclick = async () => {
      const actionStatus = byId("action-status");
      const hostWindow = resolveHostWindow(payload);
      const api = getCitationGraphApi();

      if (!hostWindow || !api || typeof api.closeGraphView !== "function") {
        actionStatus.textContent = "Could not close the citation graph from this window.";
        return;
      }

      try {
        api.closeGraphView(hostWindow);
      } catch (error) {
        actionStatus.textContent = `Could not close graph: ${error.message || error}`;
      }
    };
  }
}

function render(payload = getPayload()) {
  debugLog("render: start", {
    payloadKeys: Object.keys(payload || {}),
    hasGraphPayload: hasGraphPayload(payload),
  });
  if (!hasGraphPayload(payload)) {
    debugLog("render: aborted because graph payload is missing");
    return;
  }

  clearError();

  const graphData = normalizeGraphData(payload.graphData);
  debugLog("render: normalized graph data", {
    nodeCount: graphData.nodes.length,
    edgeCount: graphData.edges.length,
    warningCount: graphData.warnings.length,
    scope: graphData.scope,
  });

  currentState.payload = payload;
  currentState.graphData = graphData;

  setText(
    "scope-summary",
    `${graphData.scope.label || "Current scope"} • ${formatCount(
      graphData.scope.visibleItems,
    )} visible papers${
      graphData.scope.truncated
        ? ` (capped from ${formatCount(graphData.scope.totalItems)})`
        : ""
    } • ${graphData.cacheState === "prepared" ? "prepared cache" : "live graph"}`,
  );
  renderWarnings(graphData.warnings || []);

  byId("search-input").value = currentState.query;

  const selection = createSelectionController(payload);
  bindControls(payload, selection);
  initializeGraph(payload, selection);
}

window.renderCitationGraph = (payload) => {
  try {
    window.__CITATION_GRAPH_PAYLOAD__ = payload;
    render(payload);
  } catch (error) {
    showError(error);
  }
};

window.addEventListener(
  "DOMContentLoaded",
  async () => {
    try {
      debugLog("DOMContentLoaded: start");
      const payload = await loadGraphPayloadFromHost(getPayload());
      if (hasGraphPayload(payload)) {
        debugLog("DOMContentLoaded: rendering payload");
        render(payload);
      } else {
        debugLog("DOMContentLoaded: no graph payload after loadGraphPayloadFromHost");
      }
    } catch (error) {
      showError(error);
    }
  },
  { once: true },
);

window.addEventListener("resize", () => {
  if (currentState.cy) {
    currentState.cy.resize();
  }
});

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "citation-graph:render") {
    try {
      debugLog("message: received citation-graph:render");
      window.renderCitationGraph(event.data.payload);
    } catch (error) {
      showError(error);
    }
  }
});
