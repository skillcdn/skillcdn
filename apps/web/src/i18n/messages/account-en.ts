// The words of signing in and of what follows from it: the menu in the header, the page of an
// account, the pages of whoever is signed in, and the page that asks about a connecting app.

/** A day as people write one, for a list of things that happened. */
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const accountEn = {
  auth: {
    signIn: "Sign in",
    /** The one button that leaves for GitHub. Signing in and signing up are the same step. */
    continueWith: "Continue with GitHub",
    /**
     * Under the button: what continuing agrees to, by which of the two the site has. `{terms}`
     * and `{privacy}` are where the links stand, each under the name given for it below.
     */
    agreement: {
      both: "By continuing, you agree to the {terms} and the {privacy}.",
      terms: "By continuing, you agree to the {terms}.",
      privacy: "By continuing, you agree to the {privacy}.",
      termsName: "Terms of Service",
      privacyName: "Privacy Policy",
    },
    /** The dialog a person signs in from, over the page they are on. */
    dialog: {
      title: "Welcome to SkillCDN",
      lead: "Sign in and make the most of everything here.",
      close: "Close",
    },
    /** On the account pages, to someone who is not signed in. */
    accountSignedOut: "Sign in to see your account.",
    signOut: "Sign out",
    menu: (login: string) => `Account menu for ${login}`,
    profile: "Your profile",
    account: "Your account",
    repositories: "Private repositories",
    apps: "Connected apps",
    tokens: "Tokens",
    /** Under a repository that was not found: it may be one the visitor has to sign in for. */
    privateSignedOut: "Is it private? Sign in with GitHub to open a repository you have access to.",
    privateSignedIn:
      "A private repository opens once the SkillCDN GitHub app is installed on it and your account can see it.",
    privateManage: "See your repositories",
    failures: {
      denied: {
        title: "Sign-in was cancelled",
        body: "Nothing changed. You can sign in whenever you like.",
      },
      expired: {
        title: "That sign-in took too long",
        body: "Start again, and finish at GitHub within ten minutes.",
      },
      failed: {
        title: "Sign-in did not complete",
        body: "GitHub could not confirm it. Try again in a moment.",
      },
    },
  },

  owner: {
    metaTitle: (login: string) => `${login} | SkillCDN`,
    metaDescription: (login: string) =>
      `The public repositories of ${login} on GitHub, and the skills in them that SkillCDN serves to AI agents.`,
    kinds: { organization: "Organization", user: "Person" },
    viewOnHost: "View on GitHub",
    you: "This is you",
    manage: "Your account",
    publicCount: (count: number) =>
      count === 1 ? "1 public repository" : `${count.toLocaleString("en")} public repositories`,
    indexed: "Skills",
    indexedLead: "Repositories that are already indexed here. Open one and connect your AI.",
    repositories: "Public repositories",
    repositoriesAfterIndexed: "Other public repositories",
    repositoriesLead:
      "As GitHub lists them, most recently updated first. Open one to see whether it holds skills.",
    fork: "Fork",
    archived: "Archived",
    stars: (count: number) => (count === 1 ? "1 star" : `${count.toLocaleString("en")} stars`),
    updated: (iso: string) => `Updated ${day(iso)}`,
    more: "Show more",
    empty: {
      title: "No public repositories",
      body: "This account has nothing public on GitHub yet.",
    },
    notFound: {
      title: "Account not found",
      body: "There is no account by that name on GitHub.",
    },
  },

  account: {
    metaTitle: "Your account | SkillCDN",
    title: "Your account",
    navigation: "Account sections",
    sections: {
      overview: "Overview",
      repositories: "Private repositories",
      apps: "Connected apps",
      tokens: "Tokens",
    },
    overview: {
      lead: "You are signed in with GitHub. SkillCDN only ever asks GitHub what you can see; it cannot change anything there.",
      profile: "Public profile",
      profileBody: "What everyone sees: your public repositories on GitHub and the skills in them.",
      profileAction: "View your profile",
      repositoriesBody: "Use a private repository from your AI apps, and from this site.",
      repositoriesAction: "Set up private repositories",
      appsBody: "The AI apps you allowed to read a private repository as you.",
      appsAction: "See connected apps",
      tokensBody: "For an agent that cannot sign in, such as a scheduled job or a server.",
      tokensAction: "Manage tokens",
      signOutBody:
        "Signing out ends this browser's session. Apps you connected keep working until you remove them.",
    },
    repositories: {
      lead: "A private repository is served only to people GitHub lets see it. To read one, SkillCDN needs its GitHub app installed on that repository.",
      steps: [
        "Add the SkillCDN app to the repository on GitHub. It can read the repository and nothing else.",
        "Open the repository here. Only you and the people who can see it on GitHub get in.",
        "Connect your AI app from the repository's page. The app signs in as you, once.",
      ],
      install: "Add repositories on GitHub",
      installHint:
        "GitHub asks which account and which repositories. Come back here when you are done.",
      refresh: "Refresh",
      none: {
        title: "No repositories yet",
        body: "Once the GitHub app is installed on a repository you can see, it shows up here.",
      },
      selection: { all: "Every repository", selected: "Selected repositories" },
      manage: "Change on GitHub",
      private: "Private",
      public: "Public",
      truncated: "Only the first repositories are listed. The others open by their address.",
      moreInstallations: "Only the first accounts are listed.",
    },
    apps: {
      lead: "These apps can read one private address each, as you. Remove one and it is signed out at once.",
      none: {
        title: "No connected apps",
        body: "When an AI app connects to one of your private repositories and you allow it, it appears here.",
      },
      connected: (iso: string) => `Connected ${day(iso)}`,
      lastUsed: (iso: string) => `Last used ${day(iso)}`,
      neverUsed: "Not used yet",
      remove: "Remove",
      removeLabel: (client: string, address: string) => `Remove ${client} from ${address}`,
      removed: "Removed. The app has to ask again.",
    },
    tokens: {
      lead: "A token lets an agent that has nobody to sign in, such as a scheduled job or a server, read one private repository as you. Whoever holds the token can read that repository, so keep it where you keep passwords. The AI apps you use yourself need none: they sign in.",
      form: {
        title: "Make a token",
        repository: "Repository",
        name: "Name",
        namePlaceholder: "Nightly job",
        nameHint: "Only you see the name. Call it after whatever will use the token.",
        expires: "Expires",
        lifetime: (days: number) => (days === 365 ? "In 1 year" : `In ${days} days`),
        make: "Make token",
        making: "Making…",
      },
      noRepositories: {
        title: "No private repository yet",
        body: "A token is made for a private repository that the SkillCDN GitHub app is installed on. A public repository needs none.",
        action: "Set up private repositories",
      },
      made: {
        title: "Copy your token now",
        body: "It is shown this once. Nobody can show it to you again, this page included: if it is lost, remove it and make another.",
        token: "Token",
        give: "Give it to the agent",
        giveBody: (repository: string) =>
          `The agent connects to the address of the repository and sends the token with every request. It can read ${repository} at any branch, tag and folder, and nothing else.`,
        claudeCode: "Claude Code",
        codex: "Codex",
        other: "Header",
        otherHint:
          "Anything else connects to this address and sends this header with every request.",
        address: "Address",
        done: "Done, I copied it",
      },
      list: "Your tokens",
      none: {
        title: "No tokens",
        body: "The tokens you make are listed here, without their secret.",
      },
      madeAt: (iso: string) => `Made ${day(iso)}`,
      expiresAt: (iso: string) => `Expires ${day(iso)}`,
      lastUsed: (iso: string) => `Last used ${day(iso)}`,
      neverUsed: "Not used yet",
      remove: "Remove",
      removeLabel: (label: string, address: string) => `Remove the token ${label} for ${address}`,
      removed: "Removed. The token stopped working.",
    },
  },

  authorize: {
    metaTitle: "Allow an app | SkillCDN",
    title: (client: string) => `Allow ${client} to read this repository?`,
    labels: { app: "App", address: "Reads", account: "Signed in as" },
    what: "It can read the skills and documents at this address, as you. It cannot change anything, and it cannot read your other repositories.",
    returns: (host: string) => `You are sent back to ${host} with your answer.`,
    loopback: "That is an app on this computer.",
    selfNamed:
      "The name is what the app calls itself. Where you are sent back is what receives the access.",
    /** In place of the question, when the person signed in cannot open the address. */
    refused: {
      title: (client: string) => `${client} cannot be connected yet`,
      recheck: "Look again",
      back: "Back to the app",
      backHint: (host: string) =>
        `Going back tells ${host} that nothing was allowed, and nothing else.`,
    },
    notVisible: {
      title: "This account cannot open the repository",
      body: "There is no such repository, or GitHub does not show it to this account, or the SkillCDN GitHub app is not installed on it. The app was given nothing.",
      fix: "Check the address you gave the app, sign in as someone who can see the repository, or add the SkillCDN app to it on GitHub. If you have just added it, look again in a moment.",
      install: "Add repositories on GitHub",
    },
    unknown: {
      title: "GitHub could not be asked right now",
      body: "Whether this account can open the repository could not be checked, so there is nothing to allow yet. Look again in a moment.",
    },
    allow: "Allow",
    deny: "Cancel",
    working: "Sending you back to the app…",
    signIn: {
      title: (client: string) => `${client} wants to connect`,
      body: "Sign in with GitHub to continue. You are asked before the app gets anything.",
    },
    notYou: "Not you? Sign out",
    errors: {
      invalid_client: {
        title: "This app could not be recognized",
        body: "The app that sent you here is not known to this site. Go back to the app and connect again.",
      },
      invalid_redirect_uri: {
        title: "This request cannot be trusted",
        body: "The app asked to send you somewhere it never registered. Nothing was shared.",
      },
      invalid_request: {
        title: "This request cannot be used",
        body: "The app sent a request this site cannot work with. Nothing was shared. Go back to the app and connect again; if it keeps happening, the people who make the app need to know.",
      },
      expired: {
        title: "This request has expired",
        body: "Go back to the app and connect again.",
      },
      missing: {
        title: "Nothing to confirm",
        body: "This page opens from an AI app that is connecting to a private repository.",
      },
    },
  },
};
