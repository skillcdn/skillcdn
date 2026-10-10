# Use skills from your AI

A skill is a set of instructions an AI app follows to do one kind of work well: write release notes in the house style, turn a product picture into a short ad, review a change for the things a linter cannot see. SkillCDN serves the skills of a git repository to the AI you already use, through one address. This page is for the person using the skills; writing them is [its own page](write-a-repository.md).

## What you need

- An AI app that connects to MCP servers. ChatGPT, Claude, Cursor, VS Code, Claude Code, Codex CLI and Gemini CLI all do, and so does any other MCP client.
- The address of a skill repository. The explorer of a deployment lists some to start with, and every public GitHub repository that holds skills has one: `https://skillcdn.ai/gh/<owner>/<repo>` on the hosted service, or the same path on a deployment of your own.

## Connect a repository

1. Open the page of the repository: paste its address, or the URL of the repository on GitHub, into the field on the front page.
2. The page leads with the connection guide. Choose your app and follow its steps; most apps take the address where they ask for a custom connector or an MCP server URL, and some open with the address filled in.
3. Send a first message, such as *Look at the skills in this server and help me choose where to start.* The guide has one to copy.

The address is the whole setup. There is nothing to install, and the app reads the repository as it is on the branch the address names, so a push by its author reaches your next conversation.

## What your AI gets

An app that connects to an address receives four read-only tools: one to browse the folders, one to search the skills and documents by their words, one to load a skill, and one to read a file. An app that implements the MCP skills extension receives the skills themselves, each as a complete document with the rules of the repository inside it. Either way the agent finds a skill by its description, loads it, follows its workflow and reads the files it points to when a step needs them. [What an agent gets over MCP](../specs/tools.md) describes the tools, and [the format](../specs/skill-repo.md) what a repository can say.

A few things to know as you use them:

- **The content is the repository's.** It is served as its author pushed it, at the commit the address resolves to. A repository nobody has vouched for carries a notice that says so; read a skill before you trust it with something that matters, as you would a script from the web.
- **The license decides what is served.** A skill under a permissive license is served whole. One under a restrictive license, or one the reader cannot recognize, is only described, with a link to its source; your agent can tell you it exists and where to read it ([licenses](../specs/skill-repo.md#licenses)).
- **Search matches words, not meaning**, in the language the repository is written in, which is usually English. Ask for what you want in plain words; the description of a skill is written to be found that way.
- **Many skills call tools.** A skill that makes a video or an image says which tool it needs and what to do when the app does not have it. The skill carries the know-how; the app brings the tools.

## Choose a version or a folder

An address names a repository, and may name more ([addresses](../specs/address.md)):

```
/gh/<owner>/<repo>                 the default branch, as it is now
/gh/<owner>/<repo>@v1.2.0          a tag, a branch or a commit
/gh/<owner>/<repo>/marketing       one folder of it
/gh/<owner>/<repo>@main/marketing  both
```

A tag or a full commit hash gives you exactly what was reviewed, every time. A folder gives an app only that area of a large repository; connect the repository root when the skills share references across folders, which the page of the repository suggests where it matters.

## Private repositories

On a deployment where people sign in, a private repository is served to exactly the people who can see it on GitHub, where the deployment's GitHub App is installed on it. Your AI app signs in as you, once: it opens a page of the deployment in your browser, you sign in with GitHub and allow the app, and the app receives a token that is good for that one address. The connection guide of a private repository says how each app begins that. An agent that cannot sign in, a scheduled job or a server, uses a token you make on your account page for the repository; it reads as you, and the git host still decides what it may open. [People, private repositories and access](../specs/permissions.md) is the contract.

## When something does not work

- **The app finds no tools.** Check that the address is the whole URL from the page, with `https://` and without anything added after the repository, such as `/mcp`. Some apps need a moment, or a new conversation, after a connector is added.
- **The page says the repository is being indexed.** The first look at a commit reads the whole repository; it usually takes seconds, longer for a large one, and the page refreshes by itself. Your app waits the same way.
- **A skill is listed but will not load.** Its license keeps it at the source, or the file is larger than the deployment serves; the agent is told where to read it.
- **The repository is private and the app gets nothing.** Sign in on the deployment first, and check that its app is installed on the repository. A private repository looks exactly like one that does not exist to anyone who may not see it.
