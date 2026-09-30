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
    // The Connectors tab of Customize with the add-connector dialog already open: the guide's
    // first step, done. Checked in the app on September 30, 2026.
    web: "https://claude.ai/customize/connectors?modal=add-custom-connector",
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

/** The same complete endpoint is used in copyable setup and the illustrated preview. */
export function clientConfiguration(client: ConnectClient, name: string, url: string): string {
  switch (client) {
    case "claudeCode":
      return `claude mcp add --transport http ${name} ${url}`;
    case "codex":
      return `codex mcp add ${name} --url ${url}`;
    case "gemini":
      return `gemini mcp add --transport http ${name} ${url}`;
    case "vscode":
      return JSON.stringify({ servers: { [name]: { type: "http", url } } }, null, 2);
    default:
      return JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2);
  }
}
