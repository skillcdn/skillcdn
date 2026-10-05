export const CONNECT_CLIENTS = [
  "chatgpt",
  "claude",
  "cursor",
  "vscode",
  "claudeCode",
  "codex",
  "gemini",
  "other",
] as const;

export type ConnectClient = (typeof CONNECT_CLIENTS)[number];

export const CLIENT_DETAILS: Record<
  ConnectClient,
  {
    readonly icon: string | undefined;
    readonly docs: string | undefined;
    readonly web: string | undefined;
  }
> = {
  chatgpt: {
    icon: "openai",
    docs: "https://developers.openai.com/plugins/deploy/connect-chatgpt",
    // The Plugins page, where the first step starts; the app has the same page.
    web: "https://chatgpt.com/plugins",
  },
  claude: {
    icon: "claude",
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    // The guide leads with an install link instead (`claudeInstallLink`), which opens the
    // add-connector dialog with the name and the address filled in.
    web: undefined,
  },
  cursor: { icon: "cursor", docs: "https://cursor.com/help/customization/mcp", web: undefined },
  vscode: {
    icon: "vscode",
    docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
    web: undefined,
  },
  claudeCode: { icon: "claude", docs: "https://code.claude.com/docs/en/mcp", web: undefined },
  codex: {
    icon: "codex",
    docs: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
    web: undefined,
  },
  gemini: {
    icon: "gemini",
    docs: "https://geminicli.com/docs/cli/tutorials/mcp-setup/",
    web: undefined,
  },
  other: { icon: undefined, docs: undefined, web: undefined },
};

export function isTerminalClient(client: ConnectClient): boolean {
  return client === "claudeCode" || client === "codex" || client === "gemini";
}

/**
 * What a person types to make a terminal client sign in to a server that asks for it, where
 * the client has a command for that: a private repository is read as its person
 * (docs/specs/connect-guide.md). `undefined` where the client asks by itself. Codex CLI signs in
 * from its add command already; its own command is for when that did not happen.
 */
export function clientSignInCommand(client: ConnectClient, name: string): string | undefined {
  switch (client) {
    case "codex":
      return `codex mcp login ${name}`;
    case "gemini":
      return `/mcp auth ${name}`;
    default:
      return undefined;
  }
}

/** The name of the variable a terminal client reads a token from, where it reads one from there. */
export const TOKEN_VARIABLE = "SKILLCDN_TOKEN";

/**
 * How an agent that has nobody to sign in is given a token it sends with every request
 * (docs/specs/connect-guide.md): the command of the two terminal clients that take one, and the
 * header itself for everything else.
 */
export function tokenSetup(
  client: "claudeCode" | "codex" | "other",
  name: string,
  url: string,
  token: string,
): string {
  switch (client) {
    case "claudeCode":
      return `claude mcp add --transport http ${name} ${url} --header "Authorization: Bearer ${token}"`;
    case "codex":
      // Codex reads the token from the environment, so that it is in no configuration file.
      return [
        `export ${TOKEN_VARIABLE}=${token}`,
        `codex mcp add ${name} --url ${url} --bearer-token-env-var ${TOKEN_VARIABLE}`,
      ].join("\n");
    default:
      return `Authorization: Bearer ${token}`;
  }
}

/**
 * The same complete endpoint is used in copyable setup and the illustrated preview. `signIn`
 * says that the server asks its clients to sign in, as a private repository does: Codex CLI is
 * then told which address the sign-in is for, because the server issues a token for one address
 * and not every version of the client says which by itself.
 */
export function clientConfiguration(
  client: ConnectClient,
  name: string,
  url: string,
  signIn = false,
): string {
  switch (client) {
    case "claudeCode":
      return `claude mcp add --transport http ${name} ${url}`;
    case "codex":
      return signIn
        ? `codex mcp add ${name} --url ${url} --oauth-resource ${url}`
        : `codex mcp add ${name} --url ${url}`;
    case "gemini":
      return `gemini mcp add --transport http ${name} ${url}`;
    case "vscode":
      return JSON.stringify({ servers: { [name]: { type: "http", url } } }, null, 2);
    default:
      return JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2);
  }
}
