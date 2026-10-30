import { accountEn } from "./account-en.js";
import { connectEn } from "./connect-en.js";
import { landingEn } from "./landing-en.js";

// The English pack is the source: its shape is the type every other pack must have.
// Copy states what the product does today. No prices, no plans, no comparisons.

export const en = {
  meta: {
    siteName: "SkillCDN",
    landing: {
      title: "SkillCDN: a one-person company, run with AI agents",
      description:
        "Take the way experts work as skills, and the AI you already use becomes your marketer, designer and developer. Search for what to make, put the work on a board, and let the agents work. Join the builders.",
      /** What SkillCDN is, in one plain sentence, for readers that are machines. */
      about:
        "SkillCDN serves a pack, a git repository of skills and documents, to an AI app such as ChatGPT or Claude as an MCP server, so that the app can load the skills it holds and follow them in a conversation; a deployment is searched across every pack it serves, and a console pack runs a company's work on a board with agents.",
    },
    explore: {
      title: "Find what to make | SkillCDN",
      description:
        "Search the skills and documents of every public pack, pick a verified pack, or open a repository by its address. Every pack comes with the steps to connect the AI you already use.",
    },
    /** The page of a search across the packs (ADR-0075). */
    search: {
      title: "Search skills and documents | SkillCDN",
      description:
        "Search every public pack for skills and documents, by words and by meaning, and connect the pack a result is in to the AI you already use.",
      resultsTitle: (term: string) => `${term} | SkillCDN`,
      resultsDescription: (term: string, count: number, packs: number) =>
        count === 0
          ? `No skills or documents for “${term}” across ${packs} public packs on SkillCDN.`
          : `${count} skills and documents for “${term}” across ${packs} public packs on SkillCDN, each in the pack it comes from, ready to connect to the AI you already use.`,
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
    ogImageAlt: "SkillCDN: start alone, the team is already here",
  },

  nav: {
    home: "SkillCDN home",
    explore: "Explore",
    search: "Search",
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
    reload: "Reload from the beginning",
    back: "Back",
  },

  address: {
    label: "Repository address",
    prefixHint: "GitHub",
    placeholder: "owner/repo",
    submit: "Open",
    hint: "If you need to, add @branch (or a tag or a commit) and a /folder path after it.",
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

  ...accountEn,

  landing: landingEn,

  explore: {
    kicker: "Explore",
    title: "Find what you want to make.",
    lead: "Search, pick a verified pack, or paste an address.",
    featuredKicker: "Featured packs",
    featured: "Verified packs, ready to connect.",
    featuredLead: "Open a pack and the steps to connect each AI app are there.",
    featuredSkills: (count: number) => (count === 1 ? "1 skill" : `${count} skills`),
    featuredDocuments: (count: number) => (count === 1 ? "1 document" : `${count} documents`),
    /** After the first few skill names of a repository: how many more it has. */
    moreSkills: (count: number) => `+${count} more`,
    featuredIndexing: "Indexing…",
    featuredFailed: "Could not be indexed",
    pages: "Pages of featured skills",
    page: (current: number, total: number) => `Page ${current} of ${total}`,
    previous: "Previous",
    next: "Next",
  },

  /** What a pack is, said in a pill on its card and beside a search result. */
  packKinds: {
    skills: "Skill pack",
    documents: "Document pack",
    repository: "Repository",
    /** For whoever reads the pills for the first time. */
    legend: {
      title: "What the kinds mean",
      skills: "a repository holding skills",
      documents: "a repository holding documents alone",
      repository: "a repository read without a manifest",
    },
  },

  /** The page of a search across the packs (ADR-0075). */
  search: {
    label: "Search skills and documents",
    placeholder: "What will you make? Card news, a short ad, a website that takes payments…",
    submit: "Search",
    heading: (term: string) => `Results for “${term}”`,
    bare: {
      title: "What will you make?",
      lead: "Search the skills and documents of every public pack, by words and by meaning.",
    },
    found: (count: number, packs: number) =>
      `${count === 1 ? "1 result" : `${count} results`} across ${packs === 1 ? "1 public pack" : `${packs} public packs`}`,
    ranking: { words: "ranked by words", meaning: "ranked by words and meaning" },
    none: "Nothing matched. Try other words, or the words a pack is written in.",
    kinds: { skill: "Skill", document: "Document" },
    verified: "Verified",
    filters: { all: "All", skill: "Skills", document: "Documents" },
    actions: {
      skill: "Open the skill",
      document: "Open the document",
      section: "Open at this section",
      pack: "Open the pack",
      repository: "Open the repository",
      more: "Search within this pack",
      moreRepository: "Search within this repository",
    },
    partOf: (directory: string) => `Part of the skill at ${directory}`,
    aside: {
      address: {
        title: "Know the address?",
        body: "Open a repository's address and you are in its pack.",
      },
    },
  },

  /** The documentation (ADR-0049): the frame around pages written in English. */
  docs: {
    title: "Documentation",
    lead: "How to use a pack from the AI you already have, how to write one, and the contracts behind both.",
    metaTitle: "Documentation | SkillCDN",
    metaDescription:
      "Guides for using and writing packs, and the specifications SkillCDN implements: the format, addresses, what an agent gets over MCP, the REST API, and how to run a deployment of your own.",
    pageTitle: (title: string) => `${title} · Docs | SkillCDN`,
    /** The sections of docs/nav.json, by id. A test keeps the two lists equal. */
    sections: { guides: "Guides", reference: "Reference", operate: "Operate" },
    navLabel: "Documentation",
    /** The button on a narrow screen that opens the list of pages. */
    menu: "Menu",
    onThisPage: "On this page",
    inEnglish: "This page is written in English.",
    edit: "Edit this page on GitHub",
    source: "Markdown source",
    /** In llms.txt: the one file with every page in it. */
    allInOne: "Every page of the documentation in one file",
    neighbours: "Previous and next page",
    previous: "Previous",
    next: "Next",
  },

  mount: {
    repository: "Repository",
    defaultBranch: "Default branch",
    ref: "Ref",
    pinned: "Pinned commit",
    commit: "Commit",
    path: "Path",
    license: "License",
    verified: "Verified",
    verifiedHint: "Vouched for by the repository's owner or by the operator of this site.",
    unverified: "Unverified",
    unverifiedHint:
      "This content comes straight from the repository and has not been verified by its owner with SkillCDN. Review it before you trust it.",
    viewOnHost: "View on GitHub",
    private: "Private",
    privateHint:
      "Only people who can see this repository on GitHub can open this page or connect to it.",
    /** Under the address field on every page of an address: what connecting it gives, and the way to the steps. */
    use: {
      these: "Connect this address to your AI to use these skills.",
      this: "Connect this address to your AI to use this skill.",
      guide: "How to connect",
    },
    /** Under a not-found error: the way back. */
    lost: {
      lead: "Check the address, or start from the featured skills.",
      explore: "Browse featured skills",
    },
    indexing: {
      title: "Indexing this commit…",
      body: "This usually takes a few seconds. The page updates by itself.",
      slow: "Still indexing. Large repositories take longer; you can come back to this page later.",
    },
    failed: {
      title: "This commit could not be indexed",
      body: (code: string) => `Reason: ${code}. It is retried automatically; try again later.`,
    },
    /** While another commit's index is served (ADR-0068): which commit the page shows, and why. */
    newest: {
      title: (commit: string) => `Showing commit ${commit}`,
      indexing: (commit: string) =>
        `The newest commit, ${commit}, is being indexed. Until it is ready, this page and every agent are served the last indexed commit.`,
      failed: (commit: string, code: string) =>
        `The newest commit, ${commit}, could not be indexed (${code}). It is retried automatically; until then this page and every agent are served the last indexed commit.`,
    },
    rebuilding: {
      title: "Rebuilding the index of this commit",
      body: "The reading rules changed. Until the new index is ready, this page and every agent are served the index made under the previous rules.",
      failed: (code: string) =>
        `Rebuilding the index failed (${code}). It is retried automatically; until then this page and every agent are served the index made under the previous rules.`,
    },
    truncated:
      "This repository is larger than the indexing limits, so some files are missing from the index.",
    /** For whoever administers the repository on the git host: have it indexed now (ADR-0064). */
    indexNow: {
      button: "Index now",
      hint: "Reads the newest commit now and embeds its documents ahead of everything else. Shown to people who administer this repository on GitHub.",
      queued: "Queued. The page updates as the index and the embedding come along.",
      already: "Already queued; it is next in line.",
    },
    tabs: {
      skills: (count: number) => `Skills (${count})`,
      documents: (count: number) => `Documents (${count})`,
      diagnostics: (count: number) => `Skipped (${count})`,
    },
    listLimited: (shown: number, total: number) => `Showing the first ${shown} of ${total}.`,
    noSkills: {
      title: "No skills here",
      body: "No folder here has a valid SKILL.md. Documents can still be searched and read.",
    },
    noDocuments: "No documents here.",
    empty: {
      title: "Nothing to serve",
      body: "There are no skills and no Markdown or JSON documents at this address.",
    },
    diagnostics: {
      lead: "These manifests were not served. Fix them and push: the next commit is indexed again.",
    },
    warnings: (count: number) => (count === 1 ? "1 warning" : `${count} warnings`),
    browse: {
      title: "Explore this repository",
      root: "Everything",
      breadcrumb: "Repository folders",
      introduction: "Read the introduction",
      folders: "Folders",
      skills: "Skills",
      documents: "Documents",
      empty: "No skills or files in this folder.",
      counts: (skills: number, documents: number) =>
        `${skills === 1 ? "1 skill" : `${skills} skills`} · ${documents === 1 ? "1 document" : `${documents} documents`}`,
      /** What a folder holds, counting only what is there; nothing yet when it holds nothing. */
      holds: (skills: number, documents: number) => {
        const parts = [
          ...(skills === 0 ? [] : [skills === 1 ? "1 skill" : `${skills} skills`]),
          ...(documents === 0 ? [] : [documents === 1 ? "1 document" : `${documents} documents`]),
        ];
        return parts.length === 0 ? "No skills yet" : parts.join(" · ");
      },
      nested: (count: number) => `${count} skills inside`,
      describedOnly: "Described only",
      describedOnlyHint:
        "Its license lets SkillCDN say that this skill exists, not pass its content on.",
    },
    search: {
      label: "Search this folder and its subfolders",
      placeholder: "Search in this folder…",
      hint: "Searches the original text of skills and documents; display translations are not searched.",
      hintMeaning:
        "Searches the original text of skills and documents by words and by meaning; display translations are not searched.",
      /** The fact under the name: what a search of the repository matches, and how far its embedding has come. */
      mode: "Search",
      words: "words",
      meaning: "words and meaning",
      wordsHint: "Agents find skills and documents by the words they contain.",
      meaningHint:
        "Agents find skills and documents by their words and by their meaning, so a question in other words still finds its passage.",
      embedding: (embedded: number, total: number) => `${embedded} of ${total} documents embedded`,
      submit: "Search",
      clear: "Clear",
      resultsFor: (query: string) => `Results for “${query}”`,
      none: "Nothing matches in this folder. Try another word or a broader folder.",
      /** Under a document that matched: the sections that did, each opening the file at its heading. */
      sections: "Sections that matched",
      sectionStart: "Start of the document",
    },
    kinds: { skill: "Skill", document: "Document" },
    partOfSkill: (directory: string) => `Part of the skill at ${directory}`,
  },

  skill: {
    all: "All skills and documents",
    translationNote: "Translated for display. Your agent uses the original skill.",
    name: "Name",
    directory: "Directory",
    license: "License",
    licenseNone: "None declared",
    licenseUnrecognized: "Unrecognized license",
    licenseFile: "Read the license file on GitHub",
    describedOnly:
      "This skill is described here, not served. Its license lets SkillCDN say that the skill exists, not pass its content on.",
    readAtSource: "Read it at the source",
    compatibility: "Compatibility",
    allowedTools: "Allowed tools",
    metadata: "Metadata",
    files: "Files of this skill",
    filesTruncated: "Only the first files are listed.",
    oversized:
      "Over this server's file size limit, so not served with the skill. Each is named in the skill's served SKILL.md with this link to its bytes at the source.",
    browseFiles: "Browse all supporting files",
    browseChildren: "Browse files and nested skills",
    incomplete:
      "This skill’s instructions are not fully loaded. Continue to read all inherited rules and required context.",
    moreContext: "Load remaining instructions",
    noFiles: "This skill has no supporting files.",
    included: "Comes with the skill",
    warnings: "Warnings for the author",
    root: "(repository root)",
    rules: "Inherited rules",
    rulesSource: (path: string) => `From ${path}. Applied to this skill.`,
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
    referenceUnavailable: "This reference cannot be read from this connection.",
    directory: "Directory",
    bytes: (count: number) => `${count.toLocaleString("en")} bytes`,
    directoryTruncated: "Only the first entries are listed.",
  },

  errors: {
    title: "Something went wrong",
    generic: "The request could not be served. Try again in a moment.",
    network: "The server could not be reached. Check your connection and try again.",
    codes: {
      "index.indexing": {
        title: "Indexing this commit…",
        body: "This file will be available when indexing finishes. Try again in a moment.",
      },
      "index.failed": {
        title: "This commit could not be indexed",
        body: "The file cannot be read yet. Indexing is retried automatically; try again later.",
      },
      "mount.repo_not_found": {
        title: "Repository not found",
        body: "It does not exist, or it is private.",
      },
      "index.not_administrator": {
        title: "Not yours to ask",
        body: "Only someone who administers this repository on GitHub can have it indexed now.",
      },
      "index.unavailable": {
        title: "No worker here",
        body: "This deployment runs no worker that indexes on request.",
      },
      "mount.ref_not_found": {
        title: "Ref not found",
        body: "This repository has no such branch or tag, and no such commit in the history of its default branch. If the ref contains a slash, end it with a colon, for example @release/1.2:",
      },
      "token.limit": {
        title: "No room for another token",
        body: "An account holds a limited number of tokens. Remove one that is no longer used.",
      },
      "token.public_repository": {
        title: "No token needed",
        body: "A public repository is read without a token, by anyone.",
      },
      "token.invalid": {
        title: "This token cannot be made",
        body: "Choose a repository and a lifetime, and give the token a short name.",
      },
      "token.not_found": {
        title: "No such token",
        body: "It was removed already.",
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
        body: "There is no skill by that name at this address.",
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
        body: "There is no file at that path in this repository.",
      },
      "file.too_large": {
        title: "File too large",
        body: "This file is over the size limit for reading.",
      },
      "file.not_text": {
        title: "Not a text file",
        body: "Only UTF-8 text files can be read here.",
      },
      "search.busy": {
        title: "Too many searches right now",
        body: "The search is being asked a lot at the moment. Try again in a moment.",
      },
      "search.timeout": {
        title: "The search ran out of time",
        body: "Try fewer words, or again in a moment.",
      },
    },
  },

  notFound: {
    title: "Page not found",
    body: "There is nothing at this address.",
    home: "Go to the front page",
  },

  consent: {
    label: "Cookie consent",
    title: "We use cookies",
    text: "They help us see how the service is used and make it better. You can change your choice at any time.",
    privacy: "Privacy policy",
    accept: "Accept",
    decline: "No thanks",
    /** The footer's way to the choice, and the card it opens, which says how things stand. */
    choices: "Cookie settings",
    onTitle: "Cookies are on",
    onText:
      "They help us see how the service is used and make it better. Turn them off whenever you like.",
    offTitle: "Cookies are off",
    offText: "Nothing is counted. Turn them on whenever you like.",
    /** Keeping things as they are is the button; changing them is the quieter choice beside it. */
    keep: "OK",
    turnOff: "Turn off",
    turnOn: "Allow cookies",
    close: "Close",
  },

  legal: {
    /** Under the title of a page of the deployment's own: when its text was last revised. */
    revised: (date: string) => `Last revised ${date}`,
  },

  footer: {
    tagline: "Skills for the AI you already use.",
    /** In llms.txt: where the source and its license are. */
    source: "Source on GitHub",
    license: "License",
    terms: "Terms",
    privacy: "Privacy",
    report: "Report content",
  },
};

export type Messages = typeof en;
