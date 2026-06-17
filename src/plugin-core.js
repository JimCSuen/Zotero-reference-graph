import { config } from "../package.json";

const CACHE_PREF = "extensions.zotero.citationgraph.cache.current";
const GRAPH_WINDOW_PREF = "extensions.zotero.citationgraph.graphWindow.current";

const CitationGraphPlugin = {
  rootURI: null,
  graphURL: null,
  initialized: false,
  libraryItemMenuID: null,
  graphDialogWindow: null,
  maxVisibleItems: 500,
  windowElements: new Map(),
  windowStates: new Map(),

  init({ rootURI }) {
    if (this.initialized) {
      return;
    }

    this.rootURI = rootURI;
    this.graphURL = `chrome://${config.addonRef}/content/graph/graph.xhtml`;
    this.registerLibraryItemMenu();
    this.initialized = true;
  },

  log(message) {
    Zotero.debug(`Citation Graph: ${message}`);
  },

  addToAllWindows() {
    const windows = Zotero.getMainWindows();
    for (const win of windows) {
      if (!win.ZoteroPane) {
        continue;
      }
      this.addToWindow(win);
    }
  },

  removeFromAllWindows() {
    const windows = Zotero.getMainWindows();
    for (const win of windows) {
      if (!win.ZoteroPane) {
        continue;
      }
      this.removeFromWindow(win);
    }
    this.unregisterLibraryItemMenu();
    this.windowElements.clear();
  },

  registerLibraryItemMenu() {
    if (
      this.libraryItemMenuID ||
      !Zotero.MenuManager ||
      typeof Zotero.MenuManager.registerMenu !== "function"
    ) {
      return;
    }

    const registeredMenuID = Zotero.MenuManager.registerMenu({
      menuID: "citation-graph-library-item-menu",
      pluginID: config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          onShowing: (_event, context) => {
            const item = this.getSingleGraphableMenuItem(context);
            context.setVisible(!!item);
            context.setEnabled(!!item);
            if (context.menuElem) {
              context.menuElem.setAttribute("label", "Show Graph");
            }
          },
          onCommand: (_event, context) => {
            const item = this.getSingleGraphableMenuItem(context);
            if (!item) {
              return;
            }

            const hostWindow = this.getHostWindowFromMenuContext(context);
            void this.openGraphWindow(hostWindow, { activeItemID: item.id });
          },
        },
      ],
    });

    if (registeredMenuID) {
      this.libraryItemMenuID = registeredMenuID;
    }
  },

  unregisterLibraryItemMenu() {
    if (
      !this.libraryItemMenuID ||
      !Zotero.MenuManager ||
      typeof Zotero.MenuManager.unregisterMenu !== "function"
    ) {
      return;
    }

    Zotero.MenuManager.unregisterMenu(this.libraryItemMenuID);
    this.libraryItemMenuID = null;
  },

  getOpenGraphDialogWindow() {
    if (!this.graphDialogWindow) {
      return null;
    }

    try {
      if (this.graphDialogWindow.closed) {
        this.graphDialogWindow = null;
        return null;
      }
    } catch (_error) {
      this.graphDialogWindow = null;
      return null;
    }

    return this.graphDialogWindow;
  },

  attachGraphDialogWindow(dialogWindow) {
    if (!dialogWindow) {
      return null;
    }

    this.graphDialogWindow = dialogWindow;
    dialogWindow.addEventListener(
      "unload",
      () => {
        if (this.graphDialogWindow === dialogWindow) {
          this.graphDialogWindow = null;
        }
      },
      { once: true },
    );
    return dialogWindow;
  },

  getSingleGraphableMenuItem(context) {
    const items = Array.isArray(context?.items) ? context.items.filter(Boolean) : [];
    if (items.length !== 1) {
      return null;
    }

    return this.isGraphableItem(items[0]) ? items[0] : null;
  },

  getHostWindowFromMenuContext(context) {
    const window =
      context?.menuElem?.ownerDocument?.defaultView ||
      context?.menuElem?.ownerGlobal ||
      this.getDefaultHostWindow();
    return window && window.ZoteroPane ? window : this.getDefaultHostWindow();
  },

  createXULElement(doc, name) {
    return typeof doc.createXULElement === "function"
      ? doc.createXULElement(name)
      : doc.createElement(name);
  },

  createCommandMenuItem(doc, id, label, command) {
    const menuItem = this.createXULElement(doc, "menuitem");
    menuItem.id = id;
    menuItem.setAttribute("label", label);
    menuItem.addEventListener("command", command);
    return menuItem;
  },

  addToWindow(window) {
    const doc = window.document;
    this.addToolsMenuItems(window, doc);
    this.addMenubarButtons(window, doc);
    this.addToolbarButtons(window, doc);
  },

  addToolsMenuItems(window, doc) {
    const menuRoot =
      doc.getElementById("menu_ToolsPopup") || doc.getElementById("menu_viewPopup");

    if (!menuRoot || doc.getElementById("citation-graph-open-menuitem")) {
      return;
    }

    const buildMenuItem = this.createCommandMenuItem(
      doc,
      "citation-graph-build-cache-menuitem",
      "Build Citation Graph Cache",
      () => {
        void this.buildCurrentCacheWithFeedback(window);
      },
    );

    const statusMenuItem = this.createCommandMenuItem(
      doc,
      "citation-graph-cache-status-menuitem",
      "Citation Graph Cache Status",
      () => {
        void this.openCacheStatusWindow(window);
      },
    );

    const openMenuItem = this.createCommandMenuItem(
      doc,
      "citation-graph-open-menuitem",
      "Open Citation Graph",
      () => {
        void this.openGraphWindow(window);
      },
    );

    menuRoot.appendChild(buildMenuItem);
    menuRoot.appendChild(statusMenuItem);
    menuRoot.appendChild(openMenuItem);

    this.storeAddedElement(window, buildMenuItem.id);
    this.storeAddedElement(window, statusMenuItem.id);
    this.storeAddedElement(window, openMenuItem.id);
  },

  getMainMenubar(doc) {
    const helpMenu =
      doc.getElementById("menu_Help") ||
      doc.getElementById("menu-help") ||
      doc.getElementById("helpMenu");
    const toolsMenu =
      doc.getElementById("menu_Tools") ||
      doc.getElementById("tools-menu") ||
      doc.getElementById("menu_tools");

    return {
      helpMenu,
      toolsMenu,
      menubar:
        helpMenu?.parentNode ||
        toolsMenu?.parentNode ||
        doc.getElementById("main-menubar") ||
        doc.querySelector("menubar"),
    };
  },

  createMenubarButton(doc, id, label, tooltip, command) {
    const button = this.createXULElement(doc, "toolbarbutton");
    button.id = id;
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", tooltip);
    button.setAttribute("type", "button");
    button.classList.add("toolbarbutton-1");
    button.style.appearance = "none";
    button.style.background = "transparent";
    button.style.border = "0";
    button.style.borderRadius = "4px";
    button.style.color = "inherit";
    button.style.cursor = "default";
    button.style.font = "inherit";
    button.style.margin = "0 2px";
    button.style.minHeight = "24px";
    button.style.padding = "2px 8px";
    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(0, 0, 0, 0.08)";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });
    button.addEventListener("command", command);
    return button;
  },

  addMenubarButtons(window, doc) {
    if (doc.getElementById("citation-graph-menubar-buttons")) {
      return;
    }

    const oldTopMenu = doc.getElementById("citation-graph-top-menu");
    if (oldTopMenu) {
      oldTopMenu.remove();
    }

    const { helpMenu, menubar } = this.getMainMenubar(doc);

    if (!menubar) {
      return;
    }

    const group = this.createXULElement(doc, "hbox");
    group.id = "citation-graph-menubar-buttons";
    group.setAttribute("align", "center");
    group.style.display = "inline-flex";
    group.style.alignItems = "center";

    group.appendChild(
      this.createMenubarButton(
        doc,
        "citation-graph-menubar-build-cache-button",
        "Build Citation Graph Cache",
        "Build Citation Graph Cache",
        () => {
          void this.buildCurrentCacheWithFeedback(window);
        },
      ),
    );
    group.appendChild(
      this.createMenubarButton(
        doc,
        "citation-graph-menubar-open-button",
        "Open Citation Graph",
        "Open Citation Graph",
        () => {
          void this.openGraphWindow(window);
        },
      ),
    );

    if (helpMenu && helpMenu.parentNode === menubar) {
      menubar.insertBefore(group, helpMenu);
    } else {
      menubar.appendChild(group);
    }

    this.storeAddedElement(window, group.id);
  },

  getToolbarTarget(doc) {
    // Zotero toolbar IDs vary across major versions and pane layouts.
    const toolbarCandidates = [
      "zotero-items-toolbar",
      "zotero-toolbar",
      "zotero-items-pane-toolbar",
      "zotero-collections-toolbar",
    ];

    for (const id of toolbarCandidates) {
      const element = doc.getElementById(id);
      if (element) {
        return element;
      }
    }

    return (
      doc.querySelector("#zotero-items-pane toolbar") ||
      doc.querySelector("#zotero-pane toolbar")
    );
  },

  createToolbarButton(doc, id, label, tooltip, command) {
    const button = this.createXULElement(doc, "toolbarbutton");
    button.id = id;
    button.setAttribute("label", label);
    button.setAttribute("tooltiptext", tooltip);
    button.setAttribute("type", "button");
    button.classList.add("toolbarbutton-1");
    button.style.marginInlineStart = "4px";
    button.style.paddingInline = "8px";
    button.addEventListener("command", command);
    return button;
  },

  addToolbarButtons(window, doc) {
    if (doc.getElementById("citation-graph-toolbar-buttons")) {
      return;
    }

    const toolbar = this.getToolbarTarget(doc);
    if (!toolbar) {
      return;
    }

    const group = this.createXULElement(doc, "toolbaritem");
    group.id = "citation-graph-toolbar-buttons";
    group.setAttribute("align", "center");
    group.style.display = "inline-flex";
    group.style.alignItems = "center";
    group.style.gap = "4px";

    group.appendChild(
      this.createToolbarButton(
        doc,
        "citation-graph-toolbar-build-cache-button",
        "Build Graph Cache",
        "Build Citation Graph Cache",
        () => {
          void this.buildCurrentCacheWithFeedback(window);
        },
      ),
    );
    group.appendChild(
      this.createToolbarButton(
        doc,
        "citation-graph-toolbar-open-button",
        "Open Graph",
        "Open Citation Graph in Zotero",
        () => {
          void this.openGraphWindow(window);
        },
      ),
    );

    toolbar.appendChild(group);
    this.storeAddedElement(window, group.id);
  },

  removeFromWindow(window) {
    const doc = window.document;
    const elementIDs = this.windowElements.get(window) || [];
    for (const id of elementIDs) {
      const element = doc.getElementById(id);
      if (element) {
        element.remove();
      }
    }
    const state = this.windowStates.get(window);
    if (state && state.tabID) {
      const tabs = this.getZoteroTabs(window);
      try {
        if (tabs && this.isGraphTabOpen(window, state)) {
          tabs.close(state.tabID);
        }
      } catch (error) {
        this.log(`Failed to close citation graph tab: ${error}`);
      }
    }
    this.removeEmbeddedGraphPanel(window);
    this.windowStates.delete(window);
    this.windowElements.delete(window);
  },

  storeAddedElement(window, id) {
    if (!this.windowElements.has(window)) {
      this.windowElements.set(window, []);
    }
    this.windowElements.get(window).push(id);
  },

  getDefaultHostWindow() {
    const windows = Zotero.getMainWindows();
    return windows.find((win) => win && win.ZoteroPane) || null;
  },

  getScopeKey(scope) {
    if (scope.collectionID) {
      return `collection:${scope.libraryID}:${scope.collectionID}`;
    }
    return `library:${scope.libraryID}`;
  },

  createScopeSummary(scope) {
    return {
      label: scope.label,
      scopeKey: scope.scopeKey,
      scopeType: scope.scopeType,
      libraryID: scope.libraryID,
      collectionID: scope.collectionID,
      totalItems: scope.totalItems,
      visibleItems: scope.items.length,
      truncated: scope.truncated,
      maxVisibleItems: this.maxVisibleItems,
    };
  },

  getAvailableLibraries() {
    if (!Zotero.Libraries || typeof Zotero.Libraries.getAll !== "function") {
      return [];
    }

    return Zotero.Libraries.getAll()
      .filter((library) => library && library.libraryID && library.libraryType !== "feed")
      .map((library) => ({
        id: library.libraryID,
        name:
          (typeof Zotero.Libraries.getName === "function"
            ? Zotero.Libraries.getName(library.libraryID)
            : library.name)
          || `Library ${library.libraryID}`,
        type: library.libraryType || (typeof Zotero.Libraries.getType === "function"
          ? Zotero.Libraries.getType(library.libraryID)
          : "user"),
      }));
  },

  makePayload(scope, graph, options = {}) {
    const generatedAt = options.generatedAt || new Date().toISOString();
    const warnings = (options.extraWarnings || []).concat(
      scope.warnings,
      graph.warnings,
    );

    return {
      generatedAt,
      cacheState: options.cacheState || "live",
      activeItemID: options.activeItemID || null,
      activeNodeID: options.activeNodeID || null,
      libraries: options.libraries || this.getAvailableLibraries(),
      scope: this.createScopeSummary(scope),
      citationSources: [
        "Zotero relation predicates containing cites/references/isCitedBy",
        "DOI references in Extra",
        "DOI references in child notes",
        "DOI references from indexed attachment full text",
        "Normalized title matches from attachment reference sections",
      ],
      warnings,
      nodes: graph.nodes,
      edges: graph.edges,
    };
  },

  applyGraphWindowOptions(graphData, options = {}) {
    const activeItemID = Number(options.activeItemID || 0) || null;
    const libraries =
      Array.isArray(graphData?.libraries) && graphData.libraries.length
        ? graphData.libraries
        : this.getAvailableLibraries();
    if (!activeItemID) {
      return {
        ...graphData,
        libraries,
      };
    }

    const activeNodeID = `item-${activeItemID}`;
    const nodeExists = Array.isArray(graphData?.nodes)
      && graphData.nodes.some((node) => node && node.id === activeNodeID);

    return {
      ...graphData,
      libraries,
      activeItemID,
      activeNodeID: nodeExists ? activeNodeID : null,
      warnings: nodeExists
        ? graphData.warnings || []
        : (graphData.warnings || []).concat(
            "The selected paper was outside the visible graph scope, so it could not be pre-focused.",
          ),
    };
  },

  cloneGraphData(graphData) {
    return JSON.parse(JSON.stringify(graphData));
  },

  serializeGraphData(graphData) {
    return JSON.stringify(this.cloneGraphData(graphData));
  },

  readCache() {
    try {
      if (!Services.prefs.prefHasUserValue(CACHE_PREF)) {
        return null;
      }
      return JSON.parse(Services.prefs.getStringPref(CACHE_PREF));
    } catch (error) {
      this.log(`Failed to read cache: ${error}`);
      return null;
    }
  },

  writeCache(payload) {
    Services.prefs.setStringPref(CACHE_PREF, JSON.stringify(payload));
  },

  writeGraphWindowPayload(payload) {
    Services.prefs.setStringPref(GRAPH_WINDOW_PREF, JSON.stringify(payload));
  },

  clearCache() {
    if (Services.prefs.prefHasUserValue(CACHE_PREF)) {
      Services.prefs.clearUserPref(CACHE_PREF);
    }
    return true;
  },

  isCacheCurrent(cachePayload, scope) {
    return (
      !!cachePayload &&
      cachePayload.scope &&
      cachePayload.scope.scopeKey === scope.scopeKey &&
      cachePayload.scope.totalItems === scope.totalItems
    );
  },

  isScopeEmpty(scope) {
    return !scope || !Array.isArray(scope.items) || scope.items.length === 0;
  },

  shouldUseCacheFallback(cachePayload, scope) {
    return (
      !!cachePayload &&
      !!cachePayload.scope &&
      !!cachePayload.scope.scopeKey &&
      cachePayload.scope.scopeKey === scope.scopeKey &&
      (cachePayload.nodes || []).length > 0 &&
      this.isScopeEmpty(scope)
    );
  },

  async buildCurrentCacheWithFeedback(hostWindow, options = {}) {
    try {
      const payload = await this.buildCurrentCache(hostWindow, options);
      hostWindow.alert(
        `Citation Graph cache built for ${payload.scope.label}\n\nNodes: ${payload.nodes.length}\nEdges: ${payload.edges.length}`,
      );
      return payload;
    } catch (error) {
      this.log(`Failed to build cache: ${error}`);
      hostWindow.alert(`Citation Graph cache build failed: ${error.message || error}`);
      throw error;
    }
  },

  async buildCurrentCache(hostWindow, options = {}) {
    const scope = await this.resolveCurrentScope(hostWindow, options);
    const graph = await this.buildGraph(scope.items);
    const payload = this.makePayload(scope, graph, {
      cacheState: "prepared",
      activeItemID: options.activeItemID || null,
      activeNodeID: options.activeItemID ? `item-${options.activeItemID}` : null,
    });
    this.writeCache(payload);
    await this.refreshVisibleGraphs(hostWindow, payload);
    return payload;
  },

  async refreshCurrentGraph(hostWindow, options = {}) {
    hostWindow = hostWindow || this.getDefaultHostWindow();
    if (!hostWindow || !hostWindow.ZoteroPane) {
      throw new Error("Host Zotero window is not available.");
    }

    const payload = await this.buildCurrentCache(hostWindow, options);
    const graphData = this.applyGraphWindowOptions(payload, options);
    this.writeGraphWindowPayload(graphData);
    await this.refreshVisibleGraphs(hostWindow, graphData);
    return graphData;
  },

  async getCacheStatus(hostWindow, options = {}) {
    const scope = await this.resolveCurrentScope(hostWindow, options);
    const cache = this.readCache();
    const currentScope = this.createScopeSummary(scope);
    const cacheMatchesCurrent = this.isCacheCurrent(cache, scope);
    const cacheFallbackAvailable = this.shouldUseCacheFallback(cache, scope);

    return {
      currentScope,
      cacheSummary: cache
        ? {
            generatedAt: cache.generatedAt,
            cacheState: cache.cacheState,
            scope: cache.scope,
            warnings: cache.warnings || [],
            nodeCount: (cache.nodes || []).length,
            edgeCount: (cache.edges || []).length,
          }
        : null,
      cacheMatchesCurrent,
      cacheFallbackAvailable,
      message: cache
        ? cacheMatchesCurrent
          ? "Prepared cache matches the current Zotero scope."
          : cacheFallbackAvailable
            ? "Current scope resolved empty, but a prepared cache for this scope can still be used."
          : "Prepared cache exists, but it was built for a different or stale scope."
        : "No prepared cache exists yet for the citation graph.",
    };
  },

  async openCacheStatusWindow(hostWindow) {
    try {
      const statusData = await this.getCacheStatus(hostWindow);
      const payload = {
        wrappedJSObject: {
          statusData,
          hostWindow,
        },
      };

      hostWindow.openDialog(
        `chrome://${config.addonRef}/content/cache/cache.xhtml`,
        "citation-graph-cache-window",
        "chrome,resizable=yes,centerscreen,width=980,height=760",
        payload,
      );
    } catch (error) {
      this.log(`Failed to open cache status window: ${error}`);
      hostWindow.alert(
        `Citation Graph cache status failed: ${error.message || error}`,
      );
    }
  },

  async openGraphWindow(hostWindow, options = {}) {
    try {
      const graphData = await this.loadGraphPayload(hostWindow, options);
      this.writeGraphWindowPayload(graphData);
      return await this.showEmbeddedGraph(hostWindow, graphData);
    } catch (error) {
      this.log(`Failed to open graph window: ${error}`);
      hostWindow.alert(`Citation Graph failed: ${error.message || error}`);
    }
  },

  async loadGraphPayload(hostWindow = null, options = {}) {
    hostWindow = hostWindow || this.getDefaultHostWindow();
    if (!hostWindow || !hostWindow.ZoteroPane) {
      throw new Error("Host Zotero window is not available.");
    }

    const scope = await this.resolveCurrentScope(hostWindow);
    const cache = this.readCache();

    if (this.isCacheCurrent(cache, scope)) {
      return this.applyGraphWindowOptions({
        ...cache,
        cacheState: "prepared",
        warnings: [`Using prepared cache from ${cache.generatedAt}.`].concat(
          cache.warnings || [],
        ),
      }, options);
    }

    if (this.shouldUseCacheFallback(cache, scope)) {
      return this.applyGraphWindowOptions({
        ...cache,
        cacheState: "prepared",
        warnings: [
          "The current Zotero view resolved to an empty scope, so the prepared cache was used instead.",
        ].concat(cache.warnings || []),
      }, options);
    }

    const graph = await this.buildGraph(scope.items);
    const extraWarnings = cache
      ? ["Prepared cache did not match the current scope, so a live graph was generated."]
      : ["No prepared cache found, so a live graph was generated."];

    return this.makePayload(scope, graph, {
      cacheState: "live",
      activeItemID: options.activeItemID || null,
      activeNodeID: options.activeItemID ? `item-${options.activeItemID}` : null,
      extraWarnings,
    });
  },

  ensureWindowState(hostWindow) {
    if (!this.windowStates.has(hostWindow)) {
      this.windowStates.set(hostWindow, {
        tabID: null,
        tabContainer: null,
        tabFrame: null,
        tabReady: null,
        panel: null,
        panelMountTarget: null,
        panelMountPreviousPosition: null,
        frame: null,
        resizer: null,
        ready: null,
      });
    }
    return this.windowStates.get(hostWindow);
  },

  getZoteroTabs(hostWindow) {
    return hostWindow && hostWindow.Zotero_Tabs && typeof hostWindow.Zotero_Tabs.add === "function"
      ? hostWindow.Zotero_Tabs
      : null;
  },

  isGraphTabOpen(hostWindow, state) {
    const tabs = this.getZoteroTabs(hostWindow);
    if (!tabs || !state?.tabID || typeof tabs.getTabInfo !== "function") {
      return false;
    }

    try {
      return !!tabs.getTabInfo(state.tabID);
    } catch (_error) {
      return false;
    }
  },

  clearGraphTabState(state) {
    state.tabID = null;
    state.tabContainer = null;
    state.tabFrame = null;
    state.tabReady = null;
  },

  createFrameReadyPromise(frame) {
    return new Promise((resolve) => {
      if (frame.contentWindow && typeof frame.contentWindow.renderCitationGraph === "function") {
        resolve();
        return;
      }
      frame.addEventListener(
        "load",
        () => {
          resolve();
        },
        { once: true },
      );
    });
  },

  async ensureGraphTab(hostWindow) {
    // Prefer a real Zotero tab so the graph stays inside the main app chrome.
    const tabs = this.getZoteroTabs(hostWindow);
    if (!tabs) {
      return null;
    }

    const state = this.ensureWindowState(hostWindow);
    if (this.isGraphTabOpen(hostWindow, state) && state.tabFrame) {
      tabs.select(state.tabID);
      return {
        frame: state.tabFrame,
        ready: state.tabReady,
        panel: null,
      };
    }

    this.clearGraphTabState(state);

    let tab;
    try {
      tab = tabs.add({
        type: "citation-graph",
        title: "Citation Graph",
        select: true,
        onClose: () => {
          if (state.tabID === tab.id) {
            this.clearGraphTabState(state);
          }
        },
      });
    } catch (error) {
      this.log(`Could not create a Zotero tab for the graph: ${error}`);
      return null;
    }

    const doc = hostWindow.document;
    const frame = doc.createElement("iframe");
    frame.id = "citation-graph-tab-frame";
    frame.setAttribute("src", this.graphURL);
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    frame.style.background = "#ffffff";

    tab.container.style.display = "flex";
    tab.container.style.flexDirection = "column";
    tab.container.style.minHeight = "0";
    tab.container.style.height = "100%";
    tab.container.appendChild(frame);

    state.tabID = tab.id;
    state.tabContainer = tab.container;
    state.tabFrame = frame;
    state.tabReady = this.createFrameReadyPromise(frame);

    return {
      frame: state.tabFrame,
      ready: state.tabReady,
      panel: null,
    };
  },

  getGraphMountTarget(hostWindow) {
    const doc = hostWindow.document;
    return (
      doc.getElementById("zotero-layout-body") ||
      doc.getElementById("zotero-pane") ||
      doc.getElementById("zotero-items-pane") ||
      doc.getElementById("item-tree-main-default") ||
      doc.getElementById("item-tree-main") ||
      doc.body ||
      doc.documentElement
    );
  },

  removeEmbeddedGraphPanel(hostWindow) {
    const state = this.windowStates.get(hostWindow);
    if (!state) {
      return false;
    }

    if (state.panel && state.panel.parentNode) {
      state.panel.parentNode.removeChild(state.panel);
    }

    if (state.panelMountTarget && state.panelMountPreviousPosition != null) {
      state.panelMountTarget.style.position = state.panelMountPreviousPosition;
    }

    state.panel = null;
    state.panelMountTarget = null;
    state.panelMountPreviousPosition = null;
    state.frame = null;
    state.resizer = null;
    state.ready = null;
    return true;
  },

  closeGraphView(hostWindow = null) {
    hostWindow = hostWindow || this.getDefaultHostWindow();
    if (!hostWindow) {
      return false;
    }

    const state = this.windowStates.get(hostWindow);
    if (!state) {
      return false;
    }

    const tabs = this.getZoteroTabs(hostWindow);
    if (tabs && this.isGraphTabOpen(hostWindow, state)) {
      try {
        tabs.close(state.tabID);
        this.clearGraphTabState(state);
        return true;
      } catch (error) {
        this.log(`Failed to close citation graph tab: ${error}`);
      }
    }

    return this.removeEmbeddedGraphPanel(hostWindow);
  },

  async ensureEmbeddedGraphPanel(hostWindow) {
    const state = this.ensureWindowState(hostWindow);
    if (state.panel && state.frame) {
      return state;
    }

    const mountTarget = this.getGraphMountTarget(hostWindow);
    if (!mountTarget) {
      throw new Error("Could not find a Zotero pane to attach the graph view.");
    }

    const doc = hostWindow.document;
    const panel = doc.createElement("div");
    panel.id = "citation-graph-embedded-panel";
    panel.style.position = "absolute";
    panel.style.inset = "0";
    panel.style.zIndex = "10000";
    panel.style.width = "100%";
    panel.style.height = "100%";
    panel.style.minHeight = "320px";
    panel.style.display = "none";
    panel.style.flexDirection = "column";
    panel.style.minWidth = "0";
    panel.style.overflow = "hidden";
    panel.style.border = "1px solid #cfd8e3";
    panel.style.background = "#ffffff";
    panel.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.18)";

    const header = doc.createElement("div");
    header.id = "citation-graph-embedded-header";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.flex = "0 0 auto";
    header.style.minHeight = "42px";
    header.style.padding = "0 12px";
    header.style.borderBottom = "1px solid #d8e0ec";
    header.style.background = "#f8fafc";

    const title = doc.createElement("strong");
    title.textContent = "Citation Graph";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.color = "#111827";

    const closeButton = doc.createElement("button");
    closeButton.id = "citation-graph-embedded-close-button";
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.setAttribute("aria-label", "Close Citation Graph");
    closeButton.style.minHeight = "28px";
    closeButton.style.border = "1px solid #cbd5e1";
    closeButton.style.borderRadius = "6px";
    closeButton.style.padding = "4px 10px";
    closeButton.style.background = "#ffffff";
    closeButton.style.color = "#111827";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", () => {
      this.closeGraphView(hostWindow);
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    const frame = doc.createElement("iframe");
    frame.id = "citation-graph-embedded-frame";
    frame.setAttribute("src", this.graphURL);
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.flex = "1 1 auto";
    frame.style.minHeight = "0";
    frame.style.border = "0";
    frame.style.background = "#ffffff";

    panel.appendChild(header);
    panel.appendChild(frame);

    const computedPosition = hostWindow.getComputedStyle(mountTarget).position;
    if (!computedPosition || computedPosition === "static") {
      state.panelMountPreviousPosition = mountTarget.style.position || "";
      mountTarget.style.position = "relative";
    } else {
      state.panelMountPreviousPosition = null;
    }
    state.panelMountTarget = mountTarget;
    mountTarget.appendChild(panel);

    state.panel = panel;
    state.frame = frame;
    state.resizer = null;
    state.ready = this.createFrameReadyPromise(frame);
    return state;
  },

  async ensureInAppGraphView(hostWindow) {
    const tabState = await this.ensureGraphTab(hostWindow);
    if (tabState) {
      return tabState;
    }

    return this.ensureEmbeddedGraphPanel(hostWindow);
  },

  wait(hostWindow, milliseconds) {
    return new Promise((resolve) => {
      hostWindow.setTimeout(resolve, milliseconds);
    });
  },

  tryRenderGraphFrame(frameWindow, payload) {
    try {
      frameWindow.__CITATION_GRAPH_PAYLOAD__ = payload;
    } catch (error) {
      this.log(`Failed to set graph payload on frame window: ${error}`);
    }

    const targetWindow = frameWindow.wrappedJSObject || frameWindow;
    if (targetWindow && targetWindow !== frameWindow) {
      try {
        targetWindow.__CITATION_GRAPH_PAYLOAD__ = payload;
      } catch (error) {
        this.log(`Failed to set graph payload on wrapped frame window: ${error}`);
      }
    }

    try {
      if (targetWindow && typeof targetWindow.renderCitationGraph === "function") {
        targetWindow.renderCitationGraph(payload);
        return true;
      }
    } catch (error) {
      this.log(`Wrapped graph render call failed: ${error}`);
    }

    try {
      if (typeof frameWindow.renderCitationGraph === "function") {
        frameWindow.renderCitationGraph(payload);
        return true;
      }
    } catch (error) {
      this.log(`Frame graph render call failed: ${error}`);
    }

    try {
      if (typeof frameWindow.postMessage === "function") {
        frameWindow.postMessage(
          {
            type: "citation-graph:render",
            payload,
          },
          "*",
        );
        return true;
      }
    } catch (error) {
      this.log(`Graph postMessage failed: ${error}`);
    }

    return false;
  },

  tryRenderGraphDialog(dialogWindow, payload) {
    if (!dialogWindow) {
      return false;
    }

    try {
      dialogWindow.__CITATION_GRAPH_PAYLOAD__ = payload;
    } catch (error) {
      this.log(`Failed to set graph payload on dialog window: ${error}`);
    }

    const targetWindow = dialogWindow.wrappedJSObject || dialogWindow;
    if (targetWindow && targetWindow !== dialogWindow) {
      try {
        targetWindow.__CITATION_GRAPH_PAYLOAD__ = payload;
      } catch (error) {
        this.log(`Failed to set graph payload on wrapped dialog window: ${error}`);
      }
    }

    try {
      if (targetWindow && typeof targetWindow.renderCitationGraph === "function") {
        targetWindow.renderCitationGraph(payload);
        return true;
      }
    } catch (error) {
      this.log(`Wrapped graph dialog render call failed: ${error}`);
    }

    try {
      if (typeof dialogWindow.renderCitationGraph === "function") {
        dialogWindow.renderCitationGraph(payload);
        return true;
      }
    } catch (error) {
      this.log(`Graph dialog render call failed: ${error}`);
    }

    try {
      if (typeof dialogWindow.postMessage === "function") {
        dialogWindow.postMessage(
          {
            type: "citation-graph:render",
            payload,
          },
          "*",
        );
        return true;
      }
    } catch (error) {
      this.log(`Graph dialog postMessage failed: ${error}`);
    }

    return false;
  },

  async pushGraphPayload(hostWindow, graphData) {
    const state = await this.ensureInAppGraphView(hostWindow);
    await state.ready;
    const frameWindow = state.frame?.contentWindow;
    if (!frameWindow) {
      throw new Error("Citation graph frame did not initialize.");
    }

    const payload = { graphData };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (this.tryRenderGraphFrame(frameWindow, payload)) {
        return;
      }
      await this.wait(hostWindow, 50);
    }

    throw new Error("Citation graph frame renderer did not initialize.");
  },

  async showEmbeddedGraph(hostWindow, graphData) {
    const state = await this.ensureInAppGraphView(hostWindow);
    if (state.panel) {
      state.panel.style.display = "flex";
    }
    await this.pushGraphPayload(hostWindow, graphData);
    return state;
  },

  async refreshEmbeddedGraph(hostWindow, graphData = null) {
    const state = this.windowStates.get(hostWindow);
    const hasOpenTab = state && this.isGraphTabOpen(hostWindow, state) && state.tabFrame;
    const hasVisiblePanel =
      state && state.panel && state.panel.style.display !== "none";
    if (!hasOpenTab && !hasVisiblePanel) {
      return;
    }
    await this.pushGraphPayload(
      hostWindow,
      graphData || (await this.loadGraphPayload(hostWindow)),
    );
  },

  async refreshVisibleGraphs(hostWindow, graphData = null) {
    const payload = graphData || (await this.loadGraphPayload(hostWindow));
    this.writeGraphWindowPayload(payload);
    await this.refreshEmbeddedGraph(hostWindow, payload);

    const existingGraphWindow = this.getOpenGraphDialogWindow();
    if (existingGraphWindow) {
      this.tryRenderGraphDialog(existingGraphWindow, { graphData: payload });
    }
  },

  async resolveCurrentScope(hostWindow, options = {}) {
    const pane = hostWindow.ZoteroPane;
    const warnings = [];
    let label = "Current library";
    let items = [];
    let scopeItems = [];
    let visibleItems = null;
    let collectionID = null;
    let libraryID = Zotero.Libraries.userLibraryID;
    let scopeType = "library";
    const forcedLibraryID = Number(options.libraryID || 0) || null;

    try {
      if (forcedLibraryID) {
        libraryID = forcedLibraryID;
        scopeType = "library";
        collectionID = null;
        label = `Library: ${typeof Zotero.Libraries.getName === "function" ? Zotero.Libraries.getName(libraryID) : libraryID}`;
        scopeItems = await this.coerceItems(await Zotero.Items.getAll(libraryID));
      } else {
      const selectedCollection =
        pane && typeof pane.getSelectedCollection === "function"
          ? pane.getSelectedCollection()
          : null;

        if (selectedCollection) {
          scopeType = "collection";
          collectionID = selectedCollection.id;
          libraryID = selectedCollection.libraryID || Zotero.Libraries.userLibraryID;
          label = `Collection: ${selectedCollection.name}`;
          scopeItems = await this.coerceItems(await selectedCollection.getChildItems());
        } else {
          libraryID =
            pane && typeof pane.getSelectedLibraryID === "function"
              ? pane.getSelectedLibraryID()
              : Zotero.Libraries.userLibraryID;
          label = `Library: ${typeof Zotero.Libraries.getName === "function" ? Zotero.Libraries.getName(libraryID) : libraryID}`;
          scopeItems = await this.coerceItems(await Zotero.Items.getAll(libraryID));
        }

        if (pane && typeof pane.getSortedItems === "function") {
          visibleItems = await this.coerceItems(await pane.getSortedItems());
        }
      }
    } catch (error) {
      warnings.push(
        `Could not resolve the current scope cleanly: ${error.message || error}`,
      );
      libraryID = Zotero.Libraries.userLibraryID;
      label = `Library: ${typeof Zotero.Libraries.getName === "function" ? Zotero.Libraries.getName(libraryID) : libraryID}`;
      scopeItems = await this.coerceItems(await Zotero.Items.getAll(libraryID));
    }

    items = scopeItems;
    if (Array.isArray(visibleItems) && visibleItems.length) {
      items = visibleItems;
    }

    const regularItems = items
      .filter((item) => this.isGraphableItem(item))
      .sort((left, right) =>
        this.getItemTitle(left).localeCompare(this.getItemTitle(right)),
      );

    const regularScopeItems = scopeItems
      .filter((item) => this.isGraphableItem(item))
      .sort((left, right) =>
        this.getItemTitle(left).localeCompare(this.getItemTitle(right)),
      );

    if (!regularItems.length && regularScopeItems.length) {
      warnings.push(
        "The current visible item list was empty, so the graph fell back to all papers in the selected library or collection.",
      );
    }

    const graphItems = regularItems.length ? regularItems : regularScopeItems;

    if (!graphItems.length) {
      warnings.push(
        "No regular Zotero items were found in the selected library or collection.",
      );
    }

    const truncated = graphItems.length > this.maxVisibleItems;
    if (truncated) {
      warnings.push(
        `The current scope contains ${graphItems.length} papers. Rendering is capped to the first ${this.maxVisibleItems} papers for responsiveness.`,
      );
    }

    const scope = {
      label,
      items: graphItems.slice(0, this.maxVisibleItems),
      totalItems: graphItems.length,
      truncated,
      warnings,
      libraryID,
      collectionID,
      scopeType,
    };

    scope.scopeKey = this.getScopeKey(scope);
    return scope;
  },

  async coerceItems(itemsOrIDs) {
    if (!Array.isArray(itemsOrIDs) || itemsOrIDs.length === 0) {
      return [];
    }

    if (typeof itemsOrIDs[0] === "number") {
      return Zotero.Items.get(itemsOrIDs);
    }

    return itemsOrIDs.filter(Boolean);
  },

  isGraphableItem(item) {
    return !!item && typeof item.isRegularItem === "function" && item.isRegularItem();
  },

  getItemTitle(item) {
    return (
      (typeof item.getDisplayTitle === "function" ? item.getDisplayTitle() : "") ||
      (typeof item.getField === "function" ? item.getField("title") : "") ||
      (typeof item.getField === "function" ? item.getField("shortTitle") : "") ||
      `Item ${item.id}`
    );
  },

  getItemYear(item) {
    const dateValue =
      typeof item.getField === "function" ? item.getField("date") || "" : "";
    const match = String(dateValue).match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : "";
  },

  getCreatorSummary(item) {
    if (typeof item.getCreators !== "function") {
      return "";
    }

    const creators = item
      .getCreators()
      .filter((creator) => creator && (creator.lastName || creator.name));
    if (!creators.length) {
      return "";
    }

    const firstCreator = creators[0].lastName || creators[0].name || "";
    return creators.length === 1 ? firstCreator : `${firstCreator} et al.`;
  },

  normalizeDOI(value) {
    if (!value) {
      return null;
    }

    const cleaned = String(value)
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:\s*/i, "")
      .trim();

    const match = cleaned.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    return match ? match[0].toLowerCase() : null;
  },

  extractDOIs(text) {
    if (!text) {
      return [];
    }

    const matches =
      String(text).match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi) || [];
    return [...new Set(matches.map((match) => this.normalizeDOI(match)).filter(Boolean))];
  },

  normalizeTitle(value) {
    if (!value) {
      return "";
    }

    return String(value)
      .toLowerCase()
      .normalize()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  isStrongTitleCandidate(value) {
    if (!value) {
      return false;
    }

    const normalized = this.normalizeTitle(value);
    if (normalized.length < 24) {
      return false;
    }

    return normalized.split(" ").length >= 4;
  },

  extractReferenceDOIs(extraText) {
    if (!extraText) {
      return [];
    }

    const dois = new Set();
    const lines = String(extraText).split(/\r?\n/);

    for (const line of lines) {
      if (
        !/(cited doi|cited dois|references doi|references dois|references|citations)/i.test(
          line,
        )
      ) {
        continue;
      }

      for (const doi of this.extractDOIs(line)) {
        dois.add(doi);
      }
    }

    return [...dois];
  },

  stripMarkup(value) {
    if (!value) {
      return "";
    }

    return String(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  },

  getRelationEntries(item) {
    if (typeof item.getRelations !== "function") {
      return [];
    }

    const relations = item.getRelations() || {};
    if (relations instanceof Map) {
      return [...relations.entries()];
    }

    return Object.entries(relations);
  },

  resolveRelationTarget(value, itemByKey, itemByDOI) {
    if (typeof value === "number") {
      return { itemIDs: [value], doi: null };
    }

    const text = String(value);
    const keyMatch = text.match(/\/items\/([A-Z0-9]{8})$/i);
    if (keyMatch) {
      const key = keyMatch[1].toUpperCase();
      const item = itemByKey.get(key);
      if (item) {
        return { itemIDs: [item.id], doi: null };
      }
    }

    const doi = this.normalizeDOI(text);
    if (doi) {
      return {
        itemIDs: itemByDOI.get(doi) || [],
        doi,
      };
    }

    return { itemIDs: [], doi: null };
  },

  async getChildNotesText(item) {
    if (typeof item.getNotes !== "function") {
      return [];
    }

    const noteIDs = item.getNotes() || [];
    if (!noteIDs.length) {
      return [];
    }

    const noteItems = await this.coerceItems(noteIDs);
    return noteItems.map((noteItem) => {
      if (typeof noteItem.getNote === "function") {
        return this.stripMarkup(noteItem.getNote());
      }
      return this.stripMarkup(
        typeof noteItem.getField === "function" ? noteItem.getField("note") : "",
      );
    });
  },

  async getAttachmentItems(item) {
    if (typeof item.getAttachments !== "function") {
      return [];
    }

    const attachmentIDs = item.getAttachments() || [];
    if (!attachmentIDs.length) {
      return [];
    }

    const attachments = await this.coerceItems(attachmentIDs);
    return attachments.filter((attachment) => attachment && attachment.isAttachment && attachment.isAttachment());
  },

  async readAttachmentFullText(attachment) {
    if (!attachment) {
      return "";
    }

    try {
      if (
        Zotero.Fulltext &&
        typeof Zotero.Fulltext.canIndex === "function" &&
        Zotero.Fulltext.canIndex(attachment)
      ) {
        const cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
        if (!cacheFile.exists() && typeof Zotero.Fulltext.indexItems === "function") {
          await Zotero.Fulltext.indexItems([attachment.id], {
            complete: true,
            ignoreErrors: true,
          });
        }

        if (cacheFile.exists()) {
          return (await Zotero.File.getContentsAsync(cacheFile.path, "utf-8")) || "";
        }
      }

      if (typeof attachment.getFilePathAsync === "function") {
        const path = await attachment.getFilePathAsync();
        if (path && attachment.attachmentContentType && /^text\//i.test(attachment.attachmentContentType)) {
          return (await Zotero.File.getContentsAsync(path, attachment.attachmentCharset || "utf-8")) || "";
        }
      }
    } catch (error) {
      this.log(`Failed to read attachment full text for ${attachment.id}: ${error}`);
    }

    return "";
  },

  extractReferenceSection(text) {
    if (!text) {
      return "";
    }

    const normalizedWhitespace = String(text).replace(/\r/g, "\n");
    const lower = normalizedWhitespace.toLowerCase();
    const sectionMatch = lower.match(
      /\b(references|bibliography|works cited|citations)\b/,
    );

    if (sectionMatch && typeof sectionMatch.index === "number") {
      return normalizedWhitespace.slice(sectionMatch.index);
    }

    const tailStart = Math.max(0, Math.floor(normalizedWhitespace.length * 0.65));
    return normalizedWhitespace.slice(tailStart);
  },

  findTitleMatches(referenceText, titleCandidates, currentItemID) {
    const matches = new Set();
    if (!referenceText) {
      return matches;
    }

    const normalizedReferenceText = ` ${this.normalizeTitle(referenceText)} `;
    if (!normalizedReferenceText.trim()) {
      return matches;
    }

    for (const candidate of titleCandidates) {
      if (candidate.itemID === currentItemID) {
        continue;
      }

      if (normalizedReferenceText.includes(` ${candidate.normalizedTitle} `)) {
        matches.add(candidate.itemID);
      }
    }

    return matches;
  },

  async buildGraph(items) {
    const itemByKey = new Map();
    const itemByDOI = new Map();
    const titleCandidates = [];
    const nodes = [];
    const edges = [];
    const edgeKeys = new Set();
    const warnings = [];

    for (const item of items) {
      if (item.key) {
        itemByKey.set(String(item.key).toUpperCase(), item);
      }

      const doi = this.normalizeDOI(
        typeof item.getField === "function" ? item.getField("DOI") : "",
      );
      if (doi) {
        if (!itemByDOI.has(doi)) {
          itemByDOI.set(doi, []);
        }
        itemByDOI.get(doi).push(item.id);
      }

      const title = this.getItemTitle(item);
      if (this.isStrongTitleCandidate(title)) {
        titleCandidates.push({
          itemID: item.id,
          normalizedTitle: this.normalizeTitle(title),
        });
      }
    }

    for (const item of items) {
      const creatorSummary = this.getCreatorSummary(item);
      const year = this.getItemYear(item);
      const title = this.getItemTitle(item);

      nodes.push({
        id: `item-${item.id}`,
        itemID: item.id,
        label: year ? `${title} (${year})` : title,
        shortLabel: title,
        creatorSummary,
        year,
        doi: this.normalizeDOI(
          typeof item.getField === "function" ? item.getField("DOI") : "",
        ),
        external: false,
      });
    }

    for (const item of items) {
      const sourceNodeID = `item-${item.id}`;
      const ownDOI = this.normalizeDOI(
        typeof item.getField === "function" ? item.getField("DOI") : "",
      );
      const outgoingItemIDs = new Set();
      const incomingItemIDs = new Set();
      const externalDOIs = new Set();

      for (const [predicate, rawValues] of this.getRelationEntries(item)) {
        const values = Array.isArray(rawValues) ? rawValues : [rawValues];

        for (const value of values) {
          const target = this.resolveRelationTarget(value, itemByKey, itemByDOI);
          const lowerPredicate = String(predicate).toLowerCase();

          if (lowerPredicate.includes("iscitedby")) {
            for (const targetItemID of target.itemIDs) {
              incomingItemIDs.add(targetItemID);
            }
            if (target.doi) {
              externalDOIs.add(target.doi);
            }
            continue;
          }

          if (
            lowerPredicate.includes("cites") ||
            lowerPredicate.includes("references")
          ) {
            for (const targetItemID of target.itemIDs) {
              outgoingItemIDs.add(targetItemID);
            }
            if (target.doi) {
              externalDOIs.add(target.doi);
            }
          }
        }
      }

      const extraDOIs = this.extractReferenceDOIs(
        typeof item.getField === "function" ? item.getField("extra") : "",
      );
      for (const doi of extraDOIs) {
        for (const targetItemID of itemByDOI.get(doi) || []) {
          outgoingItemIDs.add(targetItemID);
        }
        externalDOIs.add(doi);
      }

      const noteTexts = await this.getChildNotesText(item);
      for (const noteText of noteTexts) {
        for (const doi of this.extractDOIs(noteText)) {
          for (const targetItemID of itemByDOI.get(doi) || []) {
            outgoingItemIDs.add(targetItemID);
          }
          externalDOIs.add(doi);
        }
      }

      const attachments = await this.getAttachmentItems(item);
      let combinedReferenceText = "";
      for (const attachment of attachments) {
        const fullText = await this.readAttachmentFullText(attachment);
        if (!fullText) {
          continue;
        }

        for (const doi of this.extractDOIs(fullText)) {
          for (const targetItemID of itemByDOI.get(doi) || []) {
            outgoingItemIDs.add(targetItemID);
          }
          externalDOIs.add(doi);
        }

        combinedReferenceText += "\n" + this.extractReferenceSection(fullText);
      }

      const titleMatches = this.findTitleMatches(
        combinedReferenceText,
        titleCandidates,
        item.id,
      );
      for (const targetItemID of titleMatches) {
        outgoingItemIDs.add(targetItemID);
      }

      outgoingItemIDs.delete(item.id);
      incomingItemIDs.delete(item.id);
      if (ownDOI) {
        externalDOIs.delete(ownDOI);
      }

      for (const targetItemID of outgoingItemIDs) {
        const edgeID = `${sourceNodeID}->item-${targetItemID}`;
        if (edgeKeys.has(edgeID)) {
          continue;
        }
        edgeKeys.add(edgeID);
        edges.push({
          id: edgeID,
          source: sourceNodeID,
          target: `item-${targetItemID}`,
          kind: "cites",
        });
      }

      for (const sourceItemID of incomingItemIDs) {
        const edgeID = `item-${sourceItemID}->${sourceNodeID}`;
        if (edgeKeys.has(edgeID)) {
          continue;
        }
        edgeKeys.add(edgeID);
        edges.push({
          id: edgeID,
          source: `item-${sourceItemID}`,
          target: sourceNodeID,
          kind: "cited-by",
        });
      }

    }

    if (!edges.length) {
      warnings.push(
        "No citation edges were found in the current Zotero scope using the built-in local heuristics.",
      );
    }

    const degreeByNodeID = new Map();
    for (const node of nodes) {
      degreeByNodeID.set(node.id, 0);
    }
    for (const edge of edges) {
      degreeByNodeID.set(edge.source, (degreeByNodeID.get(edge.source) || 0) + 1);
      degreeByNodeID.set(edge.target, (degreeByNodeID.get(edge.target) || 0) + 1);
    }
    for (const node of nodes) {
      node.degree = degreeByNodeID.get(node.id) || 0;
    }

    return { nodes, edges, warnings };
  },
};

export default CitationGraphPlugin;
