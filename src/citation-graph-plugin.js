var CitationGraphPlugin = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  maxVisibleItems: 500,
  windowElements: new Map(),

  init({ id, version, rootURI }) {
    if (this.initialized) {
      return;
    }

    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
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
    this.windowElements.clear();
  },

  addToWindow(window) {
    const doc = window.document;
    const menuRoot = doc.getElementById("menu_ToolsPopup") || doc.getElementById("menu_viewPopup");

    if (!menuRoot || doc.getElementById("citation-graph-open-menuitem")) {
      return;
    }

    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = "citation-graph-open-menuitem";
    menuitem.setAttribute("label", "Open Citation Graph");
    menuitem.addEventListener("command", () => {
      void this.openGraphWindow(window);
    });

    menuRoot.appendChild(menuitem);
    this.storeAddedElement(window, menuitem.id);
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
    this.windowElements.delete(window);
  },

  storeAddedElement(window, id) {
    if (!this.windowElements.has(window)) {
      this.windowElements.set(window, []);
    }
    this.windowElements.get(window).push(id);
  },

  async openGraphWindow(hostWindow) {
    try {
      const graphData = await this.buildGraphPayload(hostWindow);
      const payload = {
        wrappedJSObject: {
          graphData,
          hostWindow,
        },
      };

      hostWindow.openDialog(
        this.rootURI + "graph/graph.xhtml",
        "citation-graph-window",
        "chrome,resizable=yes,centerscreen,width=1440,height=920",
        payload,
      );
    }
    catch (error) {
      this.log(`Failed to open graph window: ${error}`);
      hostWindow.alert(`Citation Graph failed: ${error.message || error}`);
    }
  },

  async buildGraphPayload(hostWindow) {
    const scope = await this.resolveCurrentScope(hostWindow);
    const graph = await this.buildGraph(scope.items);

    return {
      generatedAt: new Date().toISOString(),
      scope: {
        label: scope.label,
        totalItems: scope.totalItems,
        visibleItems: scope.items.length,
        truncated: scope.truncated,
        maxVisibleItems: this.maxVisibleItems,
      },
      citationSources: [
        "Zotero relation predicates containing cites/references/isCitedBy",
        "DOI references in Extra",
        "DOI references in child notes",
      ],
      warnings: scope.warnings.concat(graph.warnings),
      nodes: graph.nodes,
      edges: graph.edges,
    };
  },

  async resolveCurrentScope(hostWindow) {
    const pane = hostWindow.ZoteroPane;
    const warnings = [];

    let label = "Current library";
    let items = [];

    try {
      const selectedCollection = pane && typeof pane.getSelectedCollection === "function"
        ? pane.getSelectedCollection()
        : null;

      if (selectedCollection) {
        label = `Collection: ${selectedCollection.name}`;
        items = await this.coerceItems(await selectedCollection.getChildItems());
      }
      else {
        const libraryID = pane && typeof pane.getSelectedLibraryID === "function"
          ? pane.getSelectedLibraryID()
          : Zotero.Libraries.userLibraryID;
        label = `Library: ${libraryID}`;
        items = await this.coerceItems(await Zotero.Items.getAll(libraryID));
      }
    }
    catch (error) {
      warnings.push(`Could not resolve the current scope cleanly: ${error.message || error}`);
      const fallbackLibraryID = Zotero.Libraries.userLibraryID;
      label = `Library: ${fallbackLibraryID}`;
      items = await this.coerceItems(await Zotero.Items.getAll(fallbackLibraryID));
    }

    const regularItems = items
      .filter((item) => this.isGraphableItem(item))
      .sort((left, right) => this.getItemTitle(left).localeCompare(this.getItemTitle(right)));

    const truncated = regularItems.length > this.maxVisibleItems;
    if (truncated) {
      warnings.push(
        `The current scope contains ${regularItems.length} papers. Rendering is capped to the first ${this.maxVisibleItems} papers for responsiveness.`,
      );
    }

    return {
      label,
      items: regularItems.slice(0, this.maxVisibleItems),
      totalItems: regularItems.length,
      truncated,
      warnings,
    };
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
    return !!item
      && typeof item.isRegularItem === "function"
      && item.isRegularItem();
  },

  getItemTitle(item) {
    return (typeof item.getDisplayTitle === "function" ? item.getDisplayTitle() : "")
      || (typeof item.getField === "function" ? item.getField("title") : "")
      || (typeof item.getField === "function" ? item.getField("shortTitle") : "")
      || `Item ${item.id}`;
  },

  getItemYear(item) {
    const dateValue = typeof item.getField === "function" ? item.getField("date") || "" : "";
    const match = String(dateValue).match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : "";
  },

  getCreatorSummary(item) {
    if (typeof item.getCreators !== "function") {
      return "";
    }

    const creators = item.getCreators().filter((creator) => creator && (creator.lastName || creator.name));
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

    const matches = String(text).match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi) || [];
    return [...new Set(matches.map((match) => this.normalizeDOI(match)).filter(Boolean))];
  },

  extractReferenceDOIs(extraText) {
    if (!extraText) {
      return [];
    }

    const dois = new Set();
    const lines = String(extraText).split(/\r?\n/);

    for (const line of lines) {
      if (!/(cited doi|cited dois|references doi|references dois|references|citations)/i.test(line)) {
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
      return this.stripMarkup(typeof noteItem.getField === "function" ? noteItem.getField("note") : "");
    });
  },

  async buildGraph(items) {
    const itemByID = new Map();
    const itemByKey = new Map();
    const itemByDOI = new Map();
    const nodes = [];
    const edges = [];
    const edgeKeys = new Set();
    const warnings = [];

    for (const item of items) {
      itemByID.set(item.id, item);
      if (item.key) {
        itemByKey.set(String(item.key).toUpperCase(), item);
      }

      const doi = this.normalizeDOI(typeof item.getField === "function" ? item.getField("DOI") : "");
      if (doi) {
        if (!itemByDOI.has(doi)) {
          itemByDOI.set(doi, []);
        }
        itemByDOI.get(doi).push(item.id);
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
        doi: this.normalizeDOI(typeof item.getField === "function" ? item.getField("DOI") : ""),
        external: false,
      });
    }

    for (const item of items) {
      const sourceNodeID = `item-${item.id}`;
      const ownDOI = this.normalizeDOI(typeof item.getField === "function" ? item.getField("DOI") : "");
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

          if (lowerPredicate.includes("cites") || lowerPredicate.includes("references")) {
            for (const targetItemID of target.itemIDs) {
              outgoingItemIDs.add(targetItemID);
            }
            if (target.doi) {
              externalDOIs.add(target.doi);
            }
          }
        }
      }

      const extraDOIs = this.extractReferenceDOIs(typeof item.getField === "function" ? item.getField("extra") : "");
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
      warnings.push("No citation edges were found in the current Zotero scope using the built-in local heuristics.");
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

