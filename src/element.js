// <atlas-map>: the declarative way to use Atlas.
//
//   <atlas-map src="board.json"></atlas-map>
//   <atlas-map><script type="application/json">{ "nodes": [...] }<\/script></atlas-map>
//   (the slash is escaped so that the built files can be pasted inside an HTML script element)
//
// The instance is at element.atlas; events bubble out as atlas-change, atlas-select, atlas-error.
// element.ready settles when the current board is on screen (or failed) and element.error keeps the
// last failure, so code that runs after the board loaded still learns how it went.

import { Atlas } from "./atlas.js";

// Outside a browser (Node, for validate/layout/route) there is no HTMLElement; the class still loads.
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export class AtlasMap extends Base {
  static get observedAttributes() { return ["src", "selected"]; }

  constructor() {
    super();
    /** The last failure to load ({ errors }), or null once a board is on screen. */
    this.error = null;
    this._seq = 0;
    this._pending();
  }

  /** Settles with the instance when the current board is on screen; rejects with { errors }. */
  get ready() { return this._ready; }

  connectedCallback() {
    if (this.atlas && !this.atlas.destroyed) return;
    this.atlas = new Atlas(this, { selected: this.getAttribute("selected") ?? undefined, panel: this.getAttribute("panel") === "false" ? false : "auto" });
    const start = () => {
      const inline = this.querySelector(':scope > script[type="application/json"]');
      if (inline) this._load(inline.textContent, ++this._seq);
      else if (this.getAttribute("src")) this._fetch(this.getAttribute("src"));
    };
    // A classic script in <head> defines the element before the parser has read its children: wait
    // for them, or an inline board would be missed. Otherwise wait a microtask, so that code right
    // after the import can add its listeners before the first events.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else queueMicrotask(start);
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
    // Only the latest request counts: an older response that arrives later is dropped.
    const seq = ++this._seq;
    this._abort?.abort();
    const abort = this._abort = new AbortController();
    this._pending();
    let text;
    try {
      const url = new URL(src, document.baseURI);
      if (url.origin !== location.origin && !this.hasAttribute("cross-origin")) throw new Error(`refusing cross-origin board ${url}`);
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      text = await res.text();
    } catch (e) {
      if (seq !== this._seq) return;
      return this._fail([{ path: "src", code: "fetch", message: String(e.message ?? e) }]);
    }
    if (seq === this._seq) this._load(text, seq);
  }

  _load(text, seq) {
    if (seq !== this._seq) return;
    try {
      this.atlas.load(text, { selected: this.getAttribute("selected") ?? undefined });
    } catch (e) {
      return this._fail(e.errors ?? [{ path: "", code: "load", message: String(e.message ?? e) }]);
    }
    this.error = null;
    this._settle.resolve(this.atlas);
  }

  _fail(errors) {
    this.error = { errors };
    this._settle.reject(this.error);
    this.dispatchEvent(new CustomEvent("atlas-error", { detail: this.error, bubbles: true, composed: true }));
  }

  /** A new promise for the board on its way, unless the current one is still unsettled. */
  _pending() {
    if (this._settle && !this._settle.done) return;
    const settle = { done: false };
    this._ready = new Promise((resolve, reject) => {
      settle.resolve = v => { settle.done = true; resolve(v); };
      settle.reject = e => { settle.done = true; reject(e); };
    });
    this._ready.catch(() => {});   // a page that never asks for `ready` gets no unhandled rejection
    this._settle = settle;
  }
}

export function define(name = "atlas-map") {
  if (!customElements.get(name)) customElements.define(name, class extends AtlasMap {});
}
