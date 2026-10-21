# Use skills from your AI

A skill is a set of instructions an AI app follows to do one kind of work well: write release notes in the house style, turn a product picture into a short ad, review a change for the things a linter cannot see. A git repository that holds skills is a pack, and SkillCDN serves the pack to the AI you already use, through one address. This page is for the person using the skills; writing them is [its own page](write-a-repository.md).

## What you need

- An AI app that connects to MCP servers. ChatGPT, Claude, Cursor, VS Code, Claude Code, Codex CLI and Gemini CLI all do, and so does any other MCP client.
- The address of a pack. The explorer of a deployment lists some to start with, and every public GitHub repository that holds skills has one: `https://skillcdn.ai/gh/<owner>/<repo>` on the hosted service, or the same path on a deployment of your own.

## Connect a repository

1. Open the page of the repository: paste its address, or the URL of the repository on GitHub, into the field on the front page.
2. The page leads with the connection guide. Choose your app and follow its steps; most apps take the address where they ask for a custom connector or an MCP server URL, and some open with the address filled in.
3. Send a first message, such as *Look at the skills in this server and help me choose where to start.* The guide has one to copy.

The address is the whole setup. There is nothing to install, and the app reads the repository as it is on the branch the address names, so a push by its author reaches your next conversation.

## What your AI gets

An app that connects to an address receives four read-only tools: one to browse the folders, one to search the skills and documents by their words, one to load a skill, and one to read a file. An app that implements the MCP skills extension receives the skills themselves, each as a complete document with the rules of the pack inside it. Either way the agent finds a skill by its description, loads it, follows its workflow and reads the files it points to when a step needs them. [What an agent gets over MCP](../specs/tools.md) describes the tools, and [the format](../specs/skill-repo.md) what a pack can say.

A few things to know as you use them:

- **The content is the repository's.** It is served as its author pushed it, at the commit the address resolves to. A repository nobody has vouched for carries a notice that says so; read a skill before you trust it with something that matters, as you would a script from the web.
- **The license decides what is served.** A skill whose license does not allow copies is only described, with a link to its source, and your agent can tell you where to read it ([licenses](../specs/skill-repo.md#licenses)).
- **Search matches words**, in the language the pack is written in, so ask for what you want in the plain words a description would use ([browse and search](../specs/tools.md#browse-and-search)).
- **Many skills call tools.** A skill that makes a video or an image says which tool it needs and what to do when the app does not have it. The skill carries the know-how; the app brings the tools.

## Choose a version or a folder

An address names a repository and may add a ref, a folder or both, as `/gh/<owner>/<repo>@v1.2.0/marketing` does ([addresses](../specs/address.md)). A tag or a full commit hash gives you exactly what was reviewed, every time. A folder gives an app only that area of a large repository; connect the repository root when the skills share references across folders, which the page of the repository suggests where it matters.

## From a shell, without MCP

An agent that runs commands can use a pack without an MCP connection: the `skillcdn` command reads the skills for it, in the same words an MCP client's model is given. It is set up once per project, for every agent that works there, and the quickest way is to tell your agent, in its own chat:

> Run `npm install -g @skillcdn/cli` and `skillcdn use gh/acme/skills` in this project, and add the sentence it prints to `CLAUDE.md` or `AGENTS.md`.

An agent that can run commands does the rest. By hand, it is the same three steps:

1. **Install the command** where the agent runs: `npm install -g @skillcdn/cli` (Node.js 24 or newer), or `npx @skillcdn/cli <command>` for a run without installing.
2. **Connect the project to the pack**: `skillcdn use gh/acme/skills` for a pack at a deployment, or `skillcdn use ../packs/acme` for a folder on the machine, read with no server and no network. It writes `.skillcdn.json`, which names the pack and nothing secret and is meant to be committed.
3. **Tell the agents.** Nothing tells an agent to look until the project says so: put the sentence the command prints into the project's agreement (`CLAUDE.md` or `AGENTS.md`, whichever your agents read), as it is; [the command's reference](../../packages/cli/README.md#a-private-pack-and-a-bound-directory) shows it.

From then on an agent in the project reads the pack without naming it, and any pack by its address:

```sh
skillcdn skills                                 # every skill and document of the pack
skillcdn skill marketing/ads/SKILL.md           # one skill whole
skillcdn skills gh/acme/skills                  # any pack, by its address
```

[The command's reference](../../packages/cli/README.md) lists every command with what it prints. An address is read at `skillcdn.ai` unless `--url` or `SKILLCDN_URL` names a deployment of your own. **A private repository** takes one more step, and no token to copy: tell the agent to run `skillcdn login --url <origin>` in the project as well and to tell you the page and the code it shows; open the page signed in, check that it shows the same code, and approve. The command keeps the token it receives and shows it to nobody; your account page lists it under the name you gave it, and removes it. How a job with nobody to approve gets its token, where tokens are kept and what a folder read from the machine is called are in [the reference](../../packages/cli/README.md#a-private-pack-and-a-bound-directory) as well.

## A folder served to an MCP client

The same command serves a folder as a deployment would, with no server and no network: for a machine that has neither, a network of your own, or a pack that is not pushed yet. To the client that starts it, over standard input and output, as a stdio server in the client's configuration:

```json
{ "mcpServers": { "acme": { "command": "skillcdn", "args": ["mcp", "./packs/acme"] } } }
```

To any client on the machine, over HTTP:

```sh
skillcdn serve ./packs/acme                     # an MCP server and the REST API on this machine
```

The client gets what a deployment would serve from the folder ([served from a machine](../specs/tools.md#served-from-a-machine)), read again as its files are saved; the address and the port are in [the command's reference](../../packages/cli/README.md#serving-a-directory). Given an embeddings server on the machine, the folder is searched by meaning as well, as a deployment searches a pack ([searching by meaning](../../packages/cli/README.md#searching-by-meaning)). Nothing signs anyone in, so whoever reaches the port reads everything served: keep it on the machine, or on a network of your own.

## Private repositories

On a deployment where people sign in, a private repository is served to exactly the people who can see it on GitHub, where the deployment's GitHub App is installed on it. Your AI app signs in as you, once: it opens a page of the deployment in your browser, you sign in with GitHub and allow the app, and the app receives a token that is good for that one address. The connection guide of a private repository says how each app begins that. An agent that cannot sign in, a scheduled job or a server, uses a token you make on your account page for the repository; it reads as you, and the git host still decides what it may open. [People, private repositories and access](../specs/permissions.md) is the contract.

## When something does not work

- **The app finds no tools.** Check that the address is the whole URL from the page, with `https://` and without anything added after the repository, such as `/mcp`. Some apps need a moment, or a new conversation, after a connector is added.
- **The page says the repository is being indexed.** The first look at a commit reads the whole repository; it usually takes seconds, longer for a large one, and the page refreshes by itself. Your app waits the same way.
- **A skill is listed but will not load.** Its license keeps it at the source, or the file is larger than the deployment serves; the agent is told where to read it.
- **The repository is private and the app gets nothing.** Sign in on the deployment first, and check that its app is installed on the repository. A private repository looks exactly like one that does not exist to anyone who may not see it.
