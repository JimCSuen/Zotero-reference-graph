# Zotero Citation Graph

Interactive Zotero plugin for visualizing citation relationships between papers as a graph.

## Features

- Adds **Tools -> Build Citation Graph Cache**
- Adds **Tools -> Citation Graph Cache Status**
- Adds **Tools -> Open Citation Graph**
- Adds **Show Graph** to the Zotero item context menu
- Opens an interactive graph window with force-based motion, search, node details, and connected-paper navigation
- Lets you rebuild the graph directly from the graph window with **Build**
- Lets you focus a selected graph node back in Zotero
- Builds citation edges from:
  - Zotero relations containing `cites`, `references`, or `isCitedBy`
  - DOI references found in `Extra`
  - DOI references found in child notes
  - indexed attachment text and normalized title matching

## Build

```powershell
npm install
npm run build
```

The packaged XPI is written to `.scaffold\build\zotero-citation-graph.xpi`.

## Release artifact

If you want a versioned release file, copy the built XPI into `release\`:

```powershell
Copy-Item .scaffold\build\zotero-citation-graph.xpi release\zotero-citation-graph-<version>.xpi
```

## Development install

For source-based development with Zotero:

1. Build once with `npm run build`
2. Create an extension proxy file in the Zotero profile `extensions` directory named `citation-graph@example.com`
3. Put the absolute path to `<repo-root>\.scaffold\build` inside that file
4. Restart Zotero

## Notes

- This MVP stays offline and does **not** call external scholarly APIs.
- Use **Build Citation Graph Cache** before opening the graph if you want a prepared snapshot of the current library or collection.
- If a cited DOI is not found in the current Zotero scope, the graph is limited to internal Zotero items and inferred relationships.
- Large scopes are capped to keep the graph responsive.


