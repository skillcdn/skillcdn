// The English pack is the source: its shape is the type every other pack must have.
// Copy states what the product does today. No prices, no plans, no comparisons.

/** A fixed number of steps, so that a component can count on each one being there. */
function fixed(a: string): readonly [string];
function fixed(a: string, b: string): readonly [string, string];
function fixed(a: string, b: string, c: string): readonly [string, string, string];
function fixed(...items: readonly string[]): readonly string[] {
  return items;
}

export const en = {
  meta: {
    siteName: "SkillCDN",
    landing: {
      title: "SkillCDN: turn any git repository into an MCP server",
      description:
        "Connect an agent to one URL and it can search, load and read the skills and documents in a git repository. Nothing to install, nothing to upload.",
    },
    explore: {
      title: "Explore a repository | SkillCDN",
      description:
        "Paste a repository address and see what an agent gets from it: its skills, its documents, and what was skipped and why.",
    },
    mount: {
      title: (repository: string) => `${repository} | SkillCDN`,
      description: (repository: string) =>
        `The skills and documents that ${repository} serves to agents through SkillCDN.`,
      /** With the index at hand: what is there, and the first few skills by name. */
      summary: (
        repository: string,
        skills: number,
        documents: number,
        names: readonly string[],
      ) => {
        const counted = `${skills === 1 ? "1 skill" : `${skills} skills`} and ${
          documents === 1 ? "1 document" : `${documents} documents`
        }`;
        return names.length === 0
          ? `${repository} serves ${counted} to AI agents over MCP through SkillCDN.`
          : `${repository} serves ${counted} to AI agents over MCP through SkillCDN: ${names.join(", ")}.`;
      },
      skillTitle: (skill: string, repository: string) => `${skill} · ${repository} | SkillCDN`,
      skillDescription: (skill: string, repository: string, description: string) =>
        `${skill}, a skill for AI agents in ${repository}: ${description}`,
      fileTitle: (path: string, repository: string) => `${path} · ${repository} | SkillCDN`,
    },
    notFound: {
      title: "Page not found | SkillCDN",
      description: "There is nothing at this address.",
    },
    ogImageAlt: "SkillCDN: turn any git repository into an MCP server",
  },

  nav: {
    home: "SkillCDN home",
    explore: "Explore",
    docs: "Docs",
    github: "GitHub",
    skipToContent: "Skip to content",
    main: "Main",
  },

  language: {
    label: "Language",
  },

  common: {
    copy: "Copy",
    copied: "Copied",
    loading: "Loading…",
    retry: "Try again",
    back: "Back",
  },

  address: {
    label: "Repository address",
    prefixHint: "GitHub",
    placeholder: "owner/repo",
    submit: "Explore",
    hint: "Optional: @branch, @tag or @commit, then a /sub/path.",
    examples: "Examples",
    invalid: "That is not a valid address.",
    errors: {
      missing_repo: "Write it as owner/repo.",
      invalid_owner: "That is not a valid owner name on GitHub.",
      invalid_repo: "That is not a valid repository name on GitHub. Leave out a trailing .git.",
      empty_ref: "Something is missing after @: a branch, a tag or a commit.",
      invalid_ref: "That is not a valid branch, tag or commit name.",
      invalid_path: "The path may not contain . or .. segments, backslashes or empty segments.",
      dot_segment: "The path may not contain . or .. segments.",
      empty_segment: "The address has an empty segment. Remove the doubled or trailing slash.",
      unknown_host: "Only GitHub repositories (gh) are supported for now.",
      too_long: "The address is too long.",
      bad_encoding: "The address contains a malformed or forbidden percent-escape.",
      forbidden_character: "The address contains a control or invisible character.",
      not_absolute: "Write it as owner/repo.",
    },
  },

  connect: {
    title: "Connect an agent",
    copyButton: "Copy the address",
    phases: {
      copy: "Copy this address",
      pick: "Open your app and follow the steps",
    },
    pickHint: "Choose the app you use. If it is not here, choose “Other”.",
    clientsLabel: "Clients",
    nameHint: (name: string) =>
      `Where an app asks for a name, any name will do; the examples use “${name}”.`,
    nameFromManifest: (name: string) =>
      `Where an app asks for a name, the examples use “${name}”, after the name the repository gives itself. Any name will do.`,
    add: (client: string) => `Add to ${client}`,
    firstMessage: {
      label: "Then say, for example",
      text: (name: string) =>
        `Look at what ${name} offers and tell me which of its skills fit what I am working on.`,
      hint: "Name the server in your request, and the agent knows where to look. From then on, ask for a skill by name or describe what you need.",
    },
    clients: {
      chatgpt: {
        label: "ChatGPT",
        steps: fixed(
          "Open Settings, then Connectors. Under Advanced settings, turn on Developer mode.",
          "Choose Create, name the connector, paste the address you copied as the MCP server URL, and leave authentication set to none.",
          "In a new chat, add the connector from the plus menu and ask for a skill by name.",
        ),
      },
      claude: {
        label: "Claude",
        steps: fixed(
          "In the web app or the desktop app, open Settings, then Connectors, and choose Add custom connector.",
          "Name it and paste the address you copied into the URL field.",
          "In a chat, turn the connector on in the tools menu and ask for a skill by name.",
        ),
      },
      cursor: {
        label: "Cursor",
        steps: fixed(
          "Click the button, or open Settings, then Tools & MCP, add a new MCP server and paste this configuration:",
        ),
      },
      vscode: {
        label: "VS Code",
        steps: fixed(
          "Click the button, or add the server to .vscode/mcp.json in your workspace:",
          "Or from a terminal:",
        ),
      },
      windsurf: {
        label: "Windsurf",
        steps: fixed("Open Settings, then MCP, and add this to your mcp_config.json:"),
      },
      claudeCode: {
        label: "Claude Code",
        steps: fixed(
          "Run this in a terminal:",
          "The skills appear as commands in the slash menu, and the agent finds and loads them by itself.",
        ),
      },
      codex: {
        label: "Codex CLI",
        steps: fixed("Run this in a terminal:"),
      },
      gemini: {
        label: "Gemini CLI",
        steps: fixed("Run this in a terminal:"),
      },
      other: {
        label: "Other",
        steps: fixed(
          "Any app that can add an MCP server over HTTP will take the address. Most read a configuration of this shape, where the key is a name of your choice:",
        ),
      },
    },
  },

  landing: {
    eyebrow: "An MCP server for any git repository",
    title: "Turn any git repository into an MCP server.",
    lead: "Connect your agent to one URL and it can search, load and read the skills and documents in that repository. Nothing to install, nothing to upload. Git stays the source of truth.",
    tryLabel: "Try it with a public GitHub repository",
    featured: {
      title: "Try one of these",
      lead: "Each one opens that repository's page, where the address to connect and a ready-made client configuration are on screen.",
      items: [
        {
          title: "One skill",
          body: "A single SKILL.md at the root, with the document it refers to.",
        },
        {
          title: "Several skills",
          body: "Two skills under skills/, with ordinary documents beside them.",
        },
        {
          title: "Broken ones skipped",
          body: "A manifest that does not parse is reported and left out; the rest is still served.",
        },
      ],
    },
    how: {
      title: "How it works",
      steps: [
        {
          title: "Keep skills in git",
          body: "A skill is a directory with a SKILL.md: a name, a description and instructions in Markdown. Put one or many in a repository, next to the documents they refer to.",
        },
        {
          title: "Connect one URL",
          body: "The address is the repository: /gh/owner/repo, optionally with a branch, tag or commit and a sub-path. Add it to any MCP client that speaks Streamable HTTP.",
        },
        {
          title: "The agent pulls what it needs",
          body: "Three tools, however many skills: find searches names, descriptions and documents, get loads one skill, and read_file reads the files it points to.",
        },
      ],
    },
    addresses: {
      title: "One address scheme",
      lead: "An address names a repository, optionally a ref and a directory. It is the whole configuration.",
      rows: [
        { address: "/gh/owner/repo", meaning: "The default branch, at its latest commit." },
        { address: "/gh/owner/repo@v1.2.0", meaning: "A tag or a branch." },
        {
          address: "/gh/owner/repo@<40-digit commit>",
          meaning: "Pinned: always exactly the content that was reviewed.",
        },
        { address: "/gh/owner/repo@main/skills/ads", meaning: "Only one directory." },
        {
          address: "/gh/owner/repo@release/1.2:skills",
          meaning: "A ref that contains a slash ends with a colon.",
        },
      ],
      addressHeader: "Address",
      meaningHeader: "What it serves",
    },
    principles: {
      title: "What you can rely on",
      items: [
        {
          title: "Git is the source of truth",
          body: "SkillCDN indexes and serves; it never hosts your content. Pin a commit and agents get exactly what was reviewed.",
        },
        {
          title: "Repositories declare, they never execute",
          body: "Skills are text. Nothing from a repository runs on the server, and nothing is sent to run on your machine.",
        },
        {
          title: "A small, fixed tool set",
          body: "Agents see three tools, not one per skill, so a repository with hundreds of skills costs the same context as one with three.",
        },
        {
          title: "Self-hostable",
          body: "The whole service is one container image and PostgreSQL. The source is available, and the same image runs on your own infrastructure.",
        },
      ],
    },
    authors: {
      title: "Writing a skill repository",
      body: "Follow the Agent Skills layout: any directory with a SKILL.md is a skill, and the files next to it belong to it. The explorer shows how your repository is read: which skills were found, which were skipped, and why.",
      convention: "Read the convention",
      check: "Check your repository",
    },
    faq: {
      title: "Questions",
      items: [
        {
          question: "What is SkillCDN?",
          answer:
            "SkillCDN is a service that turns a git repository into an MCP server. An agent connects to a URL such as /gh/owner/repo on the service and can search and read the skills and documents in that repository through three tools: find, get and read_file.",
        },
        {
          question: "What is a skill?",
          answer:
            "A skill is a directory with a SKILL.md file: YAML front-matter with a name and a description, followed by instructions in Markdown. Supporting files live next to it. This is the Agent Skills format.",
        },
        {
          question: "Which agents can use it?",
          answer:
            "Any MCP client that supports the Streamable HTTP transport. The page of a repository shows the steps for the common ones: ChatGPT, Claude, Claude Code, Cursor, VS Code, Windsurf, Codex CLI and Gemini CLI.",
        },
        {
          question: "Do I have to upload or register anything?",
          answer:
            "No. SkillCDN reads the repository from the git host when an agent first asks for it, indexes that commit once, and answers from the index.",
        },
        {
          question: "How do updates reach agents?",
          answer:
            "An address without a commit follows its branch or tag and picks up new commits shortly after they are pushed. An address with a full commit hash never changes.",
        },
        {
          question: "Does SkillCDN run code from repositories?",
          answer:
            "No. Repository content is parsed as data and returned as text. Nothing from a repository is executed.",
        },
        {
          question: "Can I use private repositories?",
          answer:
            "Not yet. Public GitHub repositories work today. Private repositories, through a GitHub App, are on the roadmap.",
        },
        {
          question: "Can I host it myself?",
          answer:
            "Yes. The service is one container image plus PostgreSQL. The source is available under the Functional Source License (FSL-1.1-ALv2); each release becomes Apache 2.0 two years later.",
        },
      ],
    },
  },

  explore: {
    title: "Explore a repository",
    lead: "Paste an address to see what an agent gets from it: the skills, the documents, and what was skipped and why.",
    featured: "Featured repositories",
    featuredSkills: (count: number) => (count === 1 ? "1 skill" : `${count} skills`),
    featuredIndexing: "Indexing…",
    featuredFailed: "Could not be indexed",
  },

  mount: {
    repository: "Repository",
    defaultBranch: "default branch",
    pinned: "pinned",
    commit: "Commit",
    path: "Path",
    unverified: "Unverified",
    unverifiedHint:
      "This content comes straight from the repository and has not been verified by its owner with SkillCDN. Review it before you trust it.",
    viewOnHost: "View on GitHub",
    indexing: {
      title: "Indexing this commit…",
      body: "This usually takes a few seconds. The page updates by itself.",
      slow: "Still indexing. Large repositories take longer; you can come back to this page later.",
    },
    failed: {
      title: "This commit could not be indexed",
      body: (code: string) => `Reason: ${code}. It is retried automatically; try again later.`,
    },
    truncated:
      "This repository is larger than the indexing limits, so some files are missing from the index.",
    tabs: {
      skills: (count: number) => `Skills (${count})`,
      documents: (count: number) => `Documents (${count})`,
      diagnostics: (count: number) => `Skipped (${count})`,
    },
    listLimited: (shown: number, total: number) => `Showing the first ${shown} of ${total}.`,
    noSkills: {
      title: "No skills here",
      body: "No directory in this mount has a valid SKILL.md. Documents can still be searched and read.",
    },
    noDocuments: "No documents in this mount.",
    empty: {
      title: "Nothing to serve",
      body: "This mount has no skills and no Markdown or JSON documents.",
    },
    diagnostics: {
      lead: "These manifests were not served. Fix them and push: the next commit is indexed again.",
    },
    warnings: (count: number) => (count === 1 ? "1 warning" : `${count} warnings`),
    search: {
      label: "Search this mount",
      placeholder: "Search skills and documents…",
      submit: "Search",
      clear: "Clear",
      resultsFor: (query: string) => `What find returns for “${query}”`,
      none: "Nothing matches. find matches when any word of the query matches.",
    },
    kinds: { skill: "Skill", document: "Document" },
    partOfSkill: (directory: string) => `Part of the skill at ${directory}`,
  },

  skill: {
    all: "All skills and documents",
    directory: "Directory",
    license: "License",
    compatibility: "Compatibility",
    allowedTools: "Allowed tools",
    metadata: "Metadata",
    files: "Files of this skill",
    filesTruncated: "Only the first files are listed.",
    noFiles: "This skill has no supporting files.",
    warnings: "Warnings for the author",
    root: "(repository root)",
    rules: "Rules for every skill in this repository",
    rulesSource: (path: string) => `From ${path}. The agent receives them with every skill.`,
    rulesAbove:
      "From the repository's manifest, above the mounted directory. The agent receives them with every skill.",
    rulesTruncated: "Only the beginning is shown here; the manifest has the whole text.",
  },

  file: {
    rendered: "Rendered",
    source: "Source",
    showing: (from: number, to: number, total: number) =>
      `Characters ${from.toLocaleString("en")} to ${to.toLocaleString("en")} of ${total.toLocaleString("en")}`,
    more: "Load more",
    imageOmitted: "image not loaded",
    directory: "Directory",
    bytes: (count: number) => `${count.toLocaleString("en")} bytes`,
    directoryTruncated: "Only the first entries are listed.",
  },

  errors: {
    title: "Something went wrong",
    generic: "The request could not be served. Try again in a moment.",
    network: "The server could not be reached. Check your connection and try again.",
    codes: {
      "mount.repo_not_found": {
        title: "Repository not found",
        body: "It does not exist, or it is not public. Private repositories are not supported yet.",
      },
      "mount.ref_not_found": {
        title: "Ref not found",
        body: "There is no such branch, tag or commit in this repository. If the ref contains a slash, end it with a colon, for example @release/1.2:",
      },
      "mount.not_allowed": {
        title: "Not served here",
        body: "This deployment does not serve this repository.",
      },
      "mount.rate_limited": {
        title: "The git host is rate limiting requests",
        body: "Try again in a little while.",
      },
      "mount.unavailable": {
        title: "The git host could not be reached",
        body: "Try again in a little while.",
      },
      "skill.not_found": {
        title: "Skill not found",
        body: "There is no skill by that name in this mount.",
      },
      "skill.ambiguous": {
        title: "Several skills share that name",
        body: "Open one of them by its directory.",
      },
      "skill.unavailable": {
        title: "The skill cannot be read right now",
        body: "It is indexed, but its content is not available. Try again in a moment.",
      },
      "file.not_found": {
        title: "File not found",
        body: "There is no file at that path in this mount.",
      },
      "file.too_large": {
        title: "File too large",
        body: "This file is over the size limit for reading.",
      },
      "file.not_text": {
        title: "Not a text file",
        body: "Only UTF-8 text files can be read here.",
      },
    },
  },

  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    home: "Go to the front page",
  },

  footer: {
    tagline: "Any git repository, served to agents over MCP.",
    source: "Source on GitHub",
    license: "License",
    trademarks: "Trademarks",
    security: "Security",
    sourceAvailable: "Source-available under FSL-1.1-ALv2.",
  },
};

export type Messages = typeof en;
