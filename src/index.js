// Atlas: a dependency-free engine for relational maps.
export { Atlas } from "./atlas.js";
export { AtlasMap, define } from "./element.js";
export { FORMAT, LIMITS, AtlasError, parse, normalize, validate, load, apply, serialize, diff } from "./model.js";
export { layout, bestInsertion, inversions, withLayers } from "./layout.js";
export { route, demand, ROUTE } from "./route.js";

import { define as defineElement } from "./element.js";
if (typeof customElements !== "undefined") defineElement();
