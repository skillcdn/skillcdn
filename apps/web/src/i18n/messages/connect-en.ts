function three(a: string, b: string, c: string): readonly [string, string, string] {
  return [a, b, c];
}

export const connectEn = {
  eyebrow: "One-time setup",
  title: "Add these skills to your AI",
  lead: "Choose the app you use and follow three short steps.",
  choose: "Which AI do you use?",
  pickHint: "Pick an app to see its steps.",
  clientsLabel: "Choose your AI app",
  copyTitle: "Your connection address",
  copyHint: "Copy it now and paste it when the app asks for a server URL.",
  copyButton: "Copy address",
  /** The description offered where an app asks for one and the repository gives none. */
  describes: (repository: string) => `Skills and documents from ${repository}.`,
  follow: (client: string) => `Connect ${client}`,
  guideHint: "Open the app and follow the steps in order.",
  add: (client: string) => `Add to ${client}`,
  installTitle: (client: string) => `Add it to ${client} in one step`,
  installHint: "The app opens with the name and address filled in. Check them and confirm.",
  open: (client: string) => `Open ${client}`,
  manual: "Manual setup",
  nameHint: (name: string) => `If the app asks for a name, use “${name}” or any name you like.`,
  help: "Can’t find a menu?",
  helpBody:
    "Menus move between app versions and workspace settings. Check the official guide, or ask your workspace administrator to allow custom connections.",
  official: "Official setup guide",
  /**
   * On the page of a private repository: the app has to sign in, once, before it can read it.
   * One sentence per app says how that app starts it; the steps that differ are given whole.
   */
  private: {
    title: "This repository is private",
    body: "Your AI app signs in as you before it can read it. A SkillCDN page opens in your browser: sign in with GitHub and allow the app. Only people who can see the repository on GitHub get in.",
    signIn: {
      chatgpt:
        "ChatGPT opens the sign-in page when you select Create. Sign in with GitHub and allow ChatGPT.",
      claude:
        "Claude asks you to sign in once the connector is added. Sign in with GitHub and allow Claude.",
      cursor:
        "Cursor asks you to log in to the server. Sign in with GitHub in the browser and allow Cursor.",
      vscode:
        "VS Code asks to authenticate with the server. Allow it, then sign in with GitHub and allow VS Code.",
      claudeCode:
        "In Claude Code, enter /mcp, choose the server and select Authenticate. Sign in with GitHub and allow Claude Code.",
      codex:
        "The add command opens the sign-in page in your browser by itself. Sign in with GitHub and allow Codex. If no page opened, run the login command below.",
      gemini:
        "In Gemini CLI, enter the auth command below. Sign in with GitHub in the browser and allow Gemini CLI.",
      other:
        "Choose OAuth where the app asks how to authenticate. Sign in with GitHub in the page it opens and allow the app.",
    },
    /** The steps that are different for a private repository, in place of the usual ones. */
    steps: {
      chatgpt:
        "Enter a name and, as the description, the sentence in the example. Keep the connection on Server URL and paste your connection address. Leave Authentication on OAuth, tick the acknowledgement and select Create.",
      other:
        "Add a server and paste your connection address. Choose HTTP (Streamable HTTP), and OAuth for authentication.",
    },
  },
  firstMessage: {
    label: "Connected? Send a first message",
    text: (server: string) =>
      `Look at the skills in the ${server} server. Tell me what you can help me with, and help me choose where to start.`,
    hint: "Paste this into a chat. If you gave the server another name, say that one.",
    copy: "Copy this message",
  },
  preview: {
    copyHint: "Select & copy",
    copySelected: "Text selected. Copy it to use it.",
    settings: "Settings",
    general: "General",
    account: "Account",
    name: "Name",
    url: "MCP server URL",
    authentication: "Authentication",
    none: "None",
    plugins: "Plugins",
    skills: "Skills",
    publicPlugins: "Public",
    personalPlugins: "Personal",
    createMcpApp: "Create MCP app",
    newPlugin: "New plugin",
    description: "Description",
    connection: "Connection",
    serverUrl: "Server URL",
    tunnel: "Tunnel",
    oauth: "OAuth",
    noAuth: "No authentication",
    oauthOrNone: "OAuth or no authentication",
    acknowledge: "I understand and want to continue",
    create: "Create",
    install: "Install",
    installServer: "Install Server",
    work: "Work",
    customize: "Customize",
    chatgptCustomize: "Customize",
    cursorCustomize: "Customize",
    projects: "Projects",
    connectors: "Connectors",
    addConnector: "Add custom connector",
    add: "Add",
    continue: "Continue",
    tools: "Tools",
    toolNames: "browse_repo · search_repo · load_skill · read_repo_file",
    enabled: "Enabled",
    newChat: "New chat",
    ask: (server: string) => `What skills are in ${server}?`,
    terminal: "Terminal",
    commandHint: "Paste the command into your terminal, then press Enter.",
    checkHint: "Open the client and check that the server is available.",
    example: "Example",
    http: "HTTP",
    remote: "Remote MCP server",
    mcp: "MCP",
    mcps: "MCPs",
    agent: "Agent",
    chatView: "Chat",
    addServer: "MCP: Add Server",
    trust: "Trust",
  },
  clients: {
    chatgpt: {
      label: "ChatGPT",
      titles: three("Open Plugins", "Create the MCP app", "Use it in a chat"),
      steps: three(
        "In the sidebar, open Customize → Plugins. Select Add, then Create MCP app.",
        "Enter a name and, as the description, the sentence in the example. Keep the connection on Server URL and paste your connection address. Under Authentication choose No authentication, tick the acknowledgement and select Create.",
        "Start a Work chat and send the first message below. ChatGPT finds the server on its own.",
      ),
      note: "The same page is in the ChatGPT app and on the web. In a Business or Enterprise workspace, an admin may have to allow custom plugins first.",
    },
    claude: {
      label: "Claude",
      titles: three("Add the connector", "Confirm it", "Use it in a chat"),
      steps: three(
        "Select Add to Claude. Claude opens Customize → Connectors with the name and address filled in. Without the button, choose Add there, then Add custom connector, and paste them yourself.",
        "Check the name and the MCP server URL, then select Continue.",
        "Start a new chat and send the first message below. Claude uses the connector on its own when a request calls for it.",
      ),
      note: "The same page opens from the account menu under Settings → Connectors. In a Team or Enterprise workspace, an owner may need to add the connector first.",
    },
    cursor: {
      label: "Cursor",
      titles: three("Open the install screen", "Check the server", "Ask in Agent chat"),
      steps: three(
        "Select Add to Cursor. Cursor opens with the connection filled in; review it and install.",
        "Open Customize → MCPs and check that the new server is on. For manual setup, put the configuration below in .cursor/mcp.json.",
        "Open Agent chat and send the first message below. Allow the tools when Cursor asks.",
      ),
      note: "Cursor must be installed on this computer for the button to work.",
    },
    vscode: {
      label: "VS Code",
      titles: three("Add the server", "Trust the server", "Use it in Chat"),
      steps: three(
        "Select Add to VS Code and confirm in the app. Or run MCP: Add Server from the Command Palette and choose HTTP.",
        "Save the server configuration and confirm the trust prompt. For manual setup, put the configuration below in .vscode/mcp.json.",
        "Open the Chat view and check the server’s tools under Configure Tools. Send the first message below.",
      ),
      note: "VS Code with Copilot chat must be set up on this computer.",
    },
    claudeCode: {
      label: "Claude Code",
      titles: three("Add the server", "Check the connection", "Ask for a skill"),
      steps: three(
        "Open a terminal in your project and run the command below.",
        "Start Claude Code with claude, then enter /mcp to check the connection.",
        "Send the first message below. The agent can browse folders, search for a skill and load its instructions.",
      ),
      note: "The command adds the server to the current project. Claude Code must already be installed.",
    },
    codex: {
      label: "Codex CLI",
      titles: three("Add the server", "Check the connection", "Ask for a skill"),
      steps: three(
        "Open a terminal and run the command below.",
        "Start Codex with codex, then enter /mcp to see the server and its tools.",
        "Send the first message below in Codex and describe what you need.",
      ),
      note: "Codex CLI must already be installed on this computer.",
    },
    gemini: {
      label: "Gemini CLI",
      titles: three("Add the server", "Check the connection", "Ask for a skill"),
      steps: three(
        "Open a terminal and run the command below.",
        "Start Gemini CLI with gemini, then enter /mcp list to check the server.",
        "Send the first message below in Gemini CLI. Everyday language is fine.",
      ),
      note: "Gemini CLI must already be installed on this computer.",
    },
    other: {
      label: "Other",
      titles: three("Find the connection settings", "Add the address", "Start a conversation"),
      steps: three(
        "In your app, look for MCP servers or integrations. It has to support a remote server over HTTP.",
        "Add a server and paste your connection address. Choose HTTP (Streamable HTTP); a public repository needs no authentication.",
        "Turn on the server’s tools and send the first message below. If you get stuck, check the app’s MCP guide.",
      ),
      note: "There is no single configuration format for every app; follow the app’s own instructions.",
    },
  },
};
