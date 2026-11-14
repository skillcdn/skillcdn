import { defineSite } from "./site-pages.js";

// What a build is for when nobody says: the product's own pages and no others. A build for an
// installation names a file of its own in `SKILLCDN_WEB_CONFIG` (dev/site-config.ts), written as
// this one is.
export const site = defineSite({});
