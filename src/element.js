// <atlas-map>: the declarative way to use Atlas.
//
//   <atlas-map src="board.json"></atlas-map>
//   <atlas-map><script type="application/json">{ "nodes": [...] }<\/script></atlas-map>
//   (the slash is escaped so that the built files can be pasted inside an HTML script element)
//
// The instance is at element.atlas; its events bubble out of the element as atlas-change,
// atlas-select and atlas-mark, and a board that fails to load as atlas-error. element.ready
// settles when the current board is on screen, or rejects, whenever your code asks. Removing the
// element keeps its engine (it may only be moving); element.atlas.destroy() frees it.

import { Atlas } from "./atlas.js";
import { deprecated } from "./model.js";

/** The panel attribute: none, side, below or sheet; anything else is auto ("false" is the old none). */
function panelOf(value) {
  if (value === "false") { deprecated('panel="false"', 'panel="none"'); return "none"; }
  return ["none", "side", "below", "sheet"].includes(value) ? value : "auto";
}

// Outside a browser (Node, for validate() and apply()) there is no HTMLElement; the class still loads.
const Base = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export class AtlasMap extends Base {
  static get observedAttributes() { return ["src", "selected", "panel"]; }

  constructor() {
    super();
    this._error = null;
    this._seq = 0;
    this._pending();
  }

  /** Settles with the instance when the current board is on screen; rejects with { errors }. */
  get ready() { return this._ready; }
  /** Deprecated since 0.5.0: `ready` rejects with the same { errors }, and atlas-error carries them. */
  get error() { deprecated("element.error", "element.ready (it rejects with { errors })"); return this._error; }

  connectedCallback() {
    if (this.atlas && !this.atlas.destroyed) return;
    this.atlas = new Atlas(this, { panel: panelOf(this.getAttribute("panel")) });
    this._pending();   // a new map after destroy(): ready waits for its board
    // The engine's events, out of the element for the page.
    for (const type of ["change", "select", "mark"]) {
      this.atlas.addEventListener(type, e => this.dispatchEvent(new CustomEvent(`atlas-${type}`, { detail: e.detail, bubbles: true, composed: true })));
    }
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
    if (name === "selected") this.atlas.select(value);
    if (name === "panel") this.atlas._setPanel(panelOf(value));
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
    this._error = null;
    this._settle.resolve(this.atlas);
  }

  _fail(errors) {
    this._error = { errors };
    this._settle.reject(this._error);
    this.dispatchEvent(new CustomEvent("atlas-error", { detail: this._error, bubbles: true, composed: true }));
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
