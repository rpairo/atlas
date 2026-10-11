// Atlas: a dependency-free engine for relational maps.
export { Atlas } from "./atlas.js";
export { AtlasMap, define } from "./element.js";
export { FORMAT, LIMITS, AtlasError } from "./model.js";
export { validate, apply, diff, parse, normalize, load, serialize } from "./boards.js";

import { define as defineElement } from "./element.js";
if (typeof customElements !== "undefined") defineElement();
