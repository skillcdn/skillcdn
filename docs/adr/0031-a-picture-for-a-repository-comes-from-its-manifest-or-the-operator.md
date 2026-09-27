# ADR-0031: A picture for a repository comes from its manifest or from the operator, and its owner's picture stands beside its name

- Status: Accepted
- Date: 2026-09-27
- Amends point 2 of [ADR-0028](0028-the-front-page-and-the-explorer-are-operator-content.md) (repository content never supplies media to the pages) and extends [ADR-0030](0030-pictures-in-repository-markdown-are-shown.md) (pictures are loaded from where they are).

## Context

The explorer's featured list and the page of an address were words alone: a name, a description, a few skill names. A list of repositories that all look the same is hard to scan, and a page without a picture says nothing at a glance about whose repository it is. On its git host every repository has a picture of its owner, and many carry a banner or a logo of their own; the pages showed neither. The operator, who curates the featured list, had no way to give a repository a picture when it declares none.

There is no standard for the picture of a repository. The Agent Skills format has no such field, and the MCP skills extension carries no visual metadata. MCP itself defines `icons` for a server, a tool or a resource: a small square mark that a client is told to fetch from the server's own origin, which is a different thing from a picture that stands for a repository on a page, and may carry the repository's mark to clients later.

## Decision

1. **The repository manifest declares its picture.** `SKILLCDN.md` gains `image`: the path of a file of the repository, relative to the manifest, or an `https` URL. Any picture, of any size and shape; the pages fit it to where they show it. A path is kept from the repository root when the tree has the file, and reported when it does not. A folder without one inherits the nearest ancestor's, as it inherits `language`.
2. **The pages show it from where it is.** A file of the repository is loaded from the host's raw copy at the commit the page shows, a URL as written, both lazily and without a referrer, as pictures in Markdown are. The deployment neither fetches, stores nor serves the picture of a repository, so its traffic never passes through the deployment.
3. **The operator can give any address a picture** through the admin API (`/admin/v1/images/<address>`): one of its uploads, served by the deployment at `/media/<sha>` as showcase media is, or an `https` URL. It stands in front of what the repository declares, for the address as written and for every address of that repository. An upload that pictures an address cannot be deleted.
4. **The owner's picture stands beside the repository's name** wherever the pages name a repository: on its card in the explorer and at the top of its page. It is the picture the git host serves for the account, asked for by the account's immutable id, and it loads from the host as any other picture does.
5. **Nothing stands in for a missing picture.** A repository without one is laid out without one: its owner's picture and its words. No picture is derived from a README, a social preview or anything else the repository did not declare.

## Consequences

- A repository decides how it looks in the explorer with one line in its manifest and a file in its tree; the operator dresses a curated list without a build.
- Every mount and featured item carries `repository.avatar`, and `image` as the URL the browser loads, or `null`. Additive to the REST API.
- The card and the page of a repository load two or three pictures from the git host; the host learns the reader's address and not the page, as with any picture. A picture the host does not serve with an image type does not render; the host's raw copy of an SVG is served with one today.
- Rejected: deriving a picture from the first image of a README (badges make that unreliable); the git host's social preview (reachable only through its GraphQL API, and a card of words when generated); reading a picture from a skill's `metadata` (a skill is not a repository, and `metadata` is for clients); a rule for size or shape (the pages crop and letterbox as they need, and a rule would only keep pictures out).
