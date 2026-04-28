import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import archiver from "archiver";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcDir = path.join(projectRoot, "src");
const distDir = path.join(projectRoot, "dist");
const releaseDir = path.join(projectRoot, "release");

async function copyFile(relativePath) {
  const source = path.join(srcDir, relativePath);
  const target = path.join(distDir, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
}

async function createXpi(version) {
  await fsp.mkdir(releaseDir, { recursive: true });
  const outputPath = path.join(releaseDir, `zotero-citation-graph-${version}.xpi`);

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
  });
}

async function main() {
  await fsp.rm(distDir, { recursive: true, force: true });
  await fsp.rm(releaseDir, { recursive: true, force: true });
  await fsp.mkdir(distDir, { recursive: true });

  await build({
    entryPoints: [path.join(srcDir, "graph", "graph.js")],
    outfile: path.join(distDir, "graph", "graph.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["firefox115"],
    sourcemap: false,
    minify: false,
  });

  await Promise.all([
    copyFile("manifest.json"),
    copyFile("install.rdf"),
    copyFile("bootstrap.js"),
    copyFile("citation-graph-plugin.js"),
    copyFile("prefs.js"),
    copyFile(path.join("graph", "graph.xhtml")),
    copyFile(path.join("graph", "graph.css")),
  ]);

  const manifest = JSON.parse(
    await fsp.readFile(path.join(srcDir, "manifest.json"), "utf8"),
  );

  await createXpi(manifest.version);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

