// The few facts about the site that the build tooling reads as well as the pages: this module
// touches nothing of the browser, so that a script running in Node.js can import it.

/**
 * What stands in for the public origin in prerendered pages. Whatever serves the pages replaces
 * it with the real origin (ADR-0009), so one build works on any domain. It is a syntactically
 * valid URL so that nothing chokes on it before that happens.
 */
export const ORIGIN_PLACEHOLDER = "https://origin.skillcdn.invalid";

export const ORIGIN_META_NAME = "skillcdn-origin";

export const REPOSITORY_URL = "https://github.com/skillcdn/skillcdn";
