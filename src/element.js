// <atlas-map>: the declarative way to use Atlas.
//
//   <atlas-map src="board.json"></atlas-map>
//   <atlas-map><script type="application/json">{ "nodes": [...] }<\/script></atlas-map>
//   (the slash is escaped so that the built files can be pasted inside an HTML script element)
//
// The instance is at element.atlas; events bubble out as atlas-change, atlas-select, atlas-error.

import { Atlas } from "./atlas.js";

// Outside a browser (Node, for validate/layout/route) there is no HTMLElement; the class still loads.
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export class AtlasMap extends Base {
  static get observedAttributes() { return ["src", "selected"]; }

  connectedCallback() {
    if (this.atlas) return;
    this.atlas = new Atlas(this, { selected: this.getAttribute("selected") ?? undefined, panel: this.getAttribute("panel") === "false" ? false : "auto" });
    const start = () => {
      const inline = this.querySelector(':scope > script[type="application/json"]');
      if (inline) this._load(inline.textContent);
      else if (this.getAttribute("src")) this._fetch(this.getAttribute("src"));
    };
    // A classic script in <head> defines the element before the parser has read its children:
    // wait for them, or an inline board would be missed.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  attributeChangedCallback(name, old, value) {
    if (!this.atlas || old === value) return;
    if (name === "src" && value) this._fetch(value);
    if (name === "selected") this.atlas.select(value, { focus: false });
  }

  disconnectedCallback() {
    // Kept alive while moved around the document; call element.atlas.destroy() to free it.
  }

  async _fetch(src) {
    try {
      const url = new URL(src, document.baseURI);
      if (url.origin !== location.origin && !this.hasAttribute("cross-origin")) throw new Error(`refusing cross-origin board ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this._load(await res.text());
    } catch (e) {
      this.dispatchEvent(new CustomEvent("atlas-error", { detail: { errors: [{ path: "src", code: "fetch", message: String(e.message ?? e) }] }, bubbles: true, composed: true }));
    }
  }

  _load(text) {
    try { this.atlas.load(text, { selected: this.getAttribute("selected") ?? undefined }); }
    catch (e) {
      this.dispatchEvent(new CustomEvent("atlas-error", { detail: { errors: e.errors ?? [{ path: "", code: "load", message: String(e.message ?? e) }] }, bubbles: true, composed: true }));
    }
  }
}

export function define(name = "atlas-map") {
  if (!customElements.get(name)) customElements.define(name, class extends AtlasMap {});
}
