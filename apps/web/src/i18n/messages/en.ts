import { connectEn } from "./connect-en.js";
import { landingEn } from "./landing-en.js";

// The English pack is the source: its shape is the type every other pack must have.
// Copy states what the product does today. No prices, no plans, no comparisons.

export const en = {
  meta: {
    siteName: "SkillCDN",
    landing: {
      title: "SkillCDN: skills for the AI you already use",
      description:
        "Give ChatGPT, Claude or any AI app that connects over MCP a ready-made skill. Say what you want in your own words and get results with a professional finish, no prompt engineering needed.",
      /** What SkillCDN is, in one plain sentence, for readers that are machines. */
      about:
        "SkillCDN turns a GitHub repository into an MCP server, so that an AI app such as ChatGPT or Claude can load the skills it holds and follow them in a conversation.",
    },
    explore: {
      title: "Find your next creation | SkillCDN",
      description:
        "Skills that turn a conversation with your AI into finished work. Start with a short ad made from a video you like and a picture of yours, with the AI you already use.",
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
    ogImageAlt: "SkillCDN: your everyday AI, extraordinary results",
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

  connect: connectEn,

  landing: landingEn,

  explore: {
    title: "What will you create next?",
    lead: "A little inspiration. A useful skill. Your next idea starts here.",
    featured: "More to explore",
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
    name: "Name",
    directory: "Directory",
    license: "License",
    compatibility: "Compatibility",
    allowedTools: "Allowed tools",
    metadata: "Metadata",
    files: "Files of this skill",
    filesTruncated: "Only the first files are listed.",
    noFiles: "This skill has no supporting files.",
    included: "Comes with the skill",
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
    tagline: "Skills for the AI you already use.",
    source: "Source on GitHub",
    license: "License",
    trademarks: "Trademarks",
    security: "Security",
  },
};

export type Messages = typeof en;
