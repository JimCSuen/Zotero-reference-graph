import Addon from "./scaffold-addon.js";
import { config } from "../package.json";

if (!Zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();
  Zotero[config.addonInstance] = addon;
}

