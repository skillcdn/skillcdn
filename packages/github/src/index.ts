// Public surface of @skillcdn/github. Other workspaces import from this entry point only.
export { createGitHubHost, GITHUB_API_BASE_URL, type GitHubHostOptions } from "./github-host.js";
export type { FetchLike, TokenProvider } from "./http.js";
