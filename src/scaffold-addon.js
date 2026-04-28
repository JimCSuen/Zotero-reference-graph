import { config } from "../package.json";
import hooks from "./scaffold-hooks.js";

export default class Addon {
  constructor() {
    this.data = {
      alive: true,
      config,
      initialized: false,
      rootURI: "",
    };
    this.hooks = hooks;
    this.api = {};
  }
}

