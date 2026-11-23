# Roadmap

What exists, what is being built and what comes next, at a glance. This page says that a thing is there or is not yet; the document each line links says what it is.

## How this page is kept

- **An entry is one to three sentences**, in the terms of whoever uses the thing: an agent, a person, an author of a pack, an operator. How it works, why it was decided and what was measured belong to the document the entry links, a [spec](specs/), a [guide](guide/), a workspace's `README.md` or an [ADR](adr/README.md), and are not repeated here.
- **Three states.** *In progress* is being built now. *Next* is agreed and not started. *Undecided* is an idea nobody has committed to. What is finished moves into the line of its area under [What exists](#what-exists); what is dropped is deleted.
- **No history.** No dates, no order of events, no figures. Git history is the record, the `CHANGELOG.md` of each published package says what a release changed, and the ADRs say why.
- **Updated with the change** that starts, finishes or drops an item. Tasks are tracked where the maintainers keep theirs; this page stays coarse.

## In progress

| Item | Where it stands |
|---|---|
| **User documentation** | The guides and the reference are published under `/docs` from the repository's own files ([ADR-0049](adr/0049-the-documentation-is-rendered-into-the-pages-from-the-repositorys-own-files.md), [`nav.json`](nav.json)). Left: more guides as questions arrive, and a decision on translations. |
| **Search in more languages** | Words are stemmed in English and matched by pairs of characters in the scripts without word stems ([words](specs/tools.md#the-words-that-match)). Left: a stemmer per language, as packs written in it arrive. |
| **The clients, by hand** | What a client shows when it connects or signs in can only be seen in the client, so nothing here tests it: after every change to what a client sees, and whenever the protocol changes, the clients of the [connection guide](../apps/web/connect-guide.md) are connected by hand, to a local server and to a deployment. Left from the last such change: the clients other than the one that read a document pack through a deployment. |

## Next

| Item | What it is |
|---|---|
| **More git hosts** | GitLab and Gitea behind the git-host port, each a package of its own, with signing in through them. The address grammar for nested namespaces is decided first, before the [address spec](specs/address.md) becomes normative. |
| **A blob store on S3-compatible storage** | Behind the blob-store port that PostgreSQL implements today, for bodies that do not belong in rows ([ADR-0004](adr/0004-postgresql-only-state.md)). |
| **Revalidation of a moving ref** | A read of a branch or a tag revalidated by its commit hash as the `ETag`. A read pinned to a commit is kept by a cache for a day already ([caching](architecture.md#caching-and-cost-posture)). |
| **Metrics and tracing** | Through OpenTelemetry, with nothing of one vendor in the code ([observability](architecture.md#observability)). |
| **An approximate index over the vectors** | For the search across packs, when picking the parts nearest in meaning exactly becomes too slow ([ADR-0092](adr/0092-a-search-across-the-packs-picks-the-parts-nearest-in-meaning-and-compares-their-sections.md)). |

## Undecided

- **Composed tools** declared in Markdown or YAML (`describe`, `run`), defined against the rule that repository code never executes.
- **What a signed-in person gets** beyond private repositories. The account pages take a section per feature; none is chosen.
- **More of the UI as an installation's own:** replacing pieces of the pages, bringing a language, and marks of its own, beyond the pages it adds today ([deploy](../deploy/README.md#a-ui-with-pages-of-your-own)).
- **Owners verifying their own repositories.** The operator's list stands in until then ([ADR-0019](adr/0019-the-operator-vouches-for-repositories-until-owners-can.md), [format](specs/skill-repo.md#open-questions)).
- **People without a git host:** signing in against an identity provider of the installation, for a deployment whose packs are in its own directory ([permissions](specs/permissions.md#not-yet)).
- **Rankings** fed by the usage statistics, next to the operator's featured list. This repository keeps the counts and the reads they are made from; what to rank or recommend is for whoever consumes them.
- **Aliases** for verified publishers.
- **Distribution through a client's own plugins:** a small plugin that points at an address, and import by hosts that snapshot a server's skills when a plugin is submitted.

The open questions of a contract are kept with it: [addresses](specs/address.md#open-questions), [the format](specs/skill-repo.md#open-questions), [permissions](specs/permissions.md#not-yet).

## What exists

Built, and tested in this repository.

| Area | What works | Where it is specified |
|---|---|---|
| **Serving a repository** | An MCP client that connects to `/gh/<owner>/<repo>[@ref][/path]` gets the pack of a GitHub repository, on github.com or a GitHub Enterprise Server: indexed on the first request and ahead of requests, exact at a pinned commit, and answered from the last indexed commit while the newest is being read. An address serves only what is its repository's own. | [addresses](specs/address.md), [request paths](architecture.md#request-paths) |
| **What an agent gets** | Four read-only tools, a prompt and connection instructions that introduce the pack and its folders; the same skills through the MCP skills extension, each assembled from its sources with a digest per file; a long skill in pages; every result one text written for the model. | [tools](specs/tools.md) |
| **The format** | A pack is skills, documents and rules in a repository. `SKILLCDN.md` manifests name it, describe its folders, add rules that arrive with every skill, declare document roots, translations and the page an agent reads first, and keep files out. A skill includes shared pages and links files of another pack. A repository without a manifest is served by its folders. | [the SkillCDN Format](specs/skill-repo.md), [writing a pack](guide/write-a-repository.md), [writing skills](guide/write-skills.md) |
| **Document packs** | A handbook or a body of specifications is browsed by its maps and outlines, searched down to the section and read by sections. Originals travel beside the documents, a long original is laid out by its own numbers, tables and code blocks are had as data, and a note made from the documents has its quotations checked. | [document packs](specs/skill-repo.md#document-packs), [writing documents](guide/write-documents.md) |
| **Search** | By words in every pack. By meaning as well where the operator turns it on, with open-weight models served beside the image: fused with the words, and reranked where a reranking model is configured. Across every public pack of a deployment, from its root. | [words and meaning](specs/tools.md#words-and-meaning), [across packs](specs/tools.md#across-every-pack-of-a-deployment), [the models](../deploy/README.md#the-inference-server-and-the-model-profiles), [what was measured](../apps/server/fixtures/retrieval/README.md) |
| **People and private repositories** | A person signs in through a GitHub App and reads a private repository from the pages and from their AI app, the git host deciding who sees what. The deployment is the OAuth authorization server of its addresses. An agent with nobody to sign in reads with a repository token, and a command connects with a code a person approves. | [permissions](specs/permissions.md) |
| **The `skillcdn` command** | Checks a pack before a push, reads a pack as an MCP client's model reads it, from a deployment or a directory, searches across packs, takes tables and code as data, serves a directory over stdio and HTTP with no server and no network, and writes the table of skills into a README. Its reads are a library. | [the command](../packages/cli/README.md) |
| **REST API** | What MCP serves, as data, with the same tokens, for a program that serves an agent; a typed client for Node.js and the browser. | [REST](specs/rest.md), [`@skillcdn/client`](../packages/client/README.md) |
| **Web UI** | The front page with the operator's showcase and the search across packs, the explorer, the page of an address with the steps to connect each client, the page of an account, sign-in and account pages, and the documentation, in English and Korean. An address unfurls with a card drawn for it and has a badge for a README. An installation adds pages of its own. | [`apps/web`](../apps/web/README.md), [a UI with pages of your own](../deploy/README.md#a-ui-with-pages-of-your-own) |
| **Operating a public deployment** | Serving follows the license a skill carries. The operator keeps verified, featured and blocked lists, purges a repository and writes the showcase and the legal pages through an admin API. Analytics ask first where the visitor's region asks. Usage is counted per repository and for the deployment without identifying a client. | [operating a public deployment](../deploy/README.md#operating-a-public-deployment), [the admin API](../deploy/README.md#the-admin-api) |
| **Self-hosting** | One image with the roles `api`, `worker`, `migrate`, `check` and `purge`, and one PostgreSQL. A compose bundle with an install script, on the image published with each release. A bundle carried to a host without internet, which its maker can add packs and images to. Packs from a directory of the host, with no git host at all, read with a token only where the operator says so. | [deploy](../deploy/README.md) |
| **Packages** | Nine packages on npm under `@skillcdn`, at one shared version, published with provenance by the release workflow. | [the packages](../README.md#packages), [ADR-0058](adr/0058-the-published-packages-share-one-version.md) |
| **Extension points** | The `Entitlements` and `UsageSink` ports bound and meter what an account does without a plan in the code; the `Embedder` and `Reranker` ports take any server that speaks the common APIs. | [extension points](architecture.md#extension-points) |

## Beside this repository

The two reference repositories plan their own work and are not tracked here ([ADR-0047](adr/0047-the-console-is-a-separate-repository-built-on-the-published-packages.md)): the reference pack in [its roadmap](https://github.com/skillcdn/skills/blob/main/guide/roadmap.md), job by job, and the reference console in [its roadmap](https://github.com/skillcdn/console/blob/main/docs/roadmap.md), milestone by milestone. What either needs from a package here is proposed, released and adopted by version.
