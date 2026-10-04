// Public surface of @skillcdn/github. Other workspaces import from this entry point only.

export type { GitHubAppCredentials } from "./app.js";
export {
  connectGitHub,
  createGitHubHost,
  GITHUB_API_BASE_URL,
  type GitHubConnection,
  type GitHubHost,
  type GitHubHostOptions,
} from "./github-host.js";
export { createGitHubLogin, type GitHubLoginOptions, githubWebUrl } from "./github-login.js";
export type { FetchLike, TokenProvider } from "./http.js";
