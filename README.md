# Zotero Citation Graph

Interactive Zotero plugin for visualizing citation relationships between papers as a graph.

![Citation Graph example 1](assets/Example.png)

![Citation Graph example 2](assets/Example2.png)


## Download

- Direct download: [Google Drive](https://drive.google.com/file/d/1_NLCpcj_n1pId5F3Pmitx3RHLKc7Ls2H/view?usp=drive_link)

## Features

- Adds a top-level **Citation Graph** menu with **Build Citation Graph Cache** and **Open Citation Graph**
- Adds toolbar buttons for **Build Graph Cache** and **Open Graph** when Zotero exposes a compatible toolbar
- Adds **Tools -> Build Citation Graph Cache**
- Adds **Tools -> Citation Graph Cache Status**
- Adds **Tools -> Open Citation Graph**
- Adds **Show Graph** to the Zotero item context menu
- Opens the interactive graph inside Zotero as a tab, with an embedded in-window fallback when tabs are unavailable
- Lets you rebuild the graph directly from the graph window with **Build**
- Lets you focus a selected graph node back in Zotero
- Builds citation edges from:
  - Zotero relations containing `cites`, `references`, or `isCitedBy`
  - DOI references found in `Extra`
- DOI references found in child notes
- indexed attachment text and normalized title matching

## Project structure

```text
.
|-- addon/                     # Static scaffold assets copied into the built Zotero extension
|   |-- bootstrap.js            # Zotero bootstrap template for the scaffold build
|   |-- manifest.json           # Manifest template with scaffold placeholders
|   `-- content/
|       |-- cache/              # Cache status XHTML/CSS assets
|       `-- graph/              # Graph XHTML/CSS assets loaded in Zotero
|-- assets/                    # README screenshots
|-- scripts/                   # Legacy/custom build helper
|-- src/
|   |-- plugin-core.js          # Main Zotero integration, menu, toolbar, cache, and graph logic
|   |-- graph-entry.js          # Bundled graph UI runtime
|   |-- cache-entry.js          # Bundled cache status UI runtime
|   |-- scaffold-hooks.js       # Zotero plugin lifecycle hooks
|   `-- index.js                # Scaffold entry point
|-- typings/                   # Local generated type definitions
|-- package.json               # Node scripts and dependencies
`-- zotero-plugin.config.ts    # zotero-plugin-scaffold build configuration
```

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

## Made by Copilot-CLI

