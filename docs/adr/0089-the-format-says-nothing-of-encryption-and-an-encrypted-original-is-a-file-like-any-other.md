# ADR-0089: The format says nothing of encryption, and an encrypted original is a file like any other

- Status: Accepted
- Date: 2026-11-12
- Supersedes [ADR-0084](0084-an-encrypted-original-stays-encrypted-and-nothing-that-opens-it-is-in-the-pack-or-the-image.md) and points 5 and 6 of [ADR-0088](0088-the-packs-of-a-directory-may-be-read-with-a-token-only-and-a-password-is-used-once.md); builds on [ADR-0076](0076-originals-travel-in-the-pack-and-the-repositorys-visibility-decides-who-reads-them.md) and [ADR-0077](0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md).

## Context

ADR-0084 gave the format a declaration that the originals of a document set are kept encrypted, with the name of their key. `check` held the PDFs of a working tree against it and reported a front-matter key written to hold a password, and a result said that an original was encrypted. ADR-0088 added how a password is used and when an original may be kept opened. After that, a way for a running deployment to be told a password, and to open originals for its readers, was proposed. None of this had been released.

Looked at again, SkillCDN never opens an original: it indexes the text of a pack and sends every other file as it is ([ADR-0077](0077-the-bytes-of-a-file-that-is-not-text-are-sent-from-where-they-are.md)). A reader who holds what opens a file opens it, as with any file they are sent, and nothing the format said changed that. What the declaration added was a way for an organization to state a policy of its own about its files, and to have it checked.

That is not what the format is for. The format is the least a pack needs for agents to read it; SkillCDN checks packs against it and serves them. It does not manage files: whether a file is encrypted, where what opens it is kept and who is given it are decided by whoever owns the files.

## Decision

1. **The format says nothing of encryption.** `SKILLCDN.md` has no `originals` key. A manifest that carries one is read as before: a key the format does not know is ignored.
2. **An encrypted original is a file like any other.** It travels in `sources/` as its owner put it there ([ADR-0076](0076-originals-travel-in-the-pack-and-the-repositorys-visibility-decides-who-reads-them.md)) and is sent as it is. A result names it as it names any original, and says nothing of whether it opens.
3. **`check` holds a pack against the format, and nothing else.** It looks into no file to see whether it is encrypted, and reads no front-matter for a key that might hold a password.
4. **SkillCDN opens no original and takes no password**: no variable, no route and no file of a deployment. This is what is built, not a rule about where an organization keeps its secrets, of which the documentation now says nothing.
5. **A deployment is told no password while it runs.** The proposal is not built.
6. **The reading rules stay at version 16.** Version 17 was on `main` alone; its number is not used again, so that an index written under it is rebuilt by the next change of the rules.

## Consequences

- The format loses one key of the manifest, three diagnostics, one fact of a result and two fields of the REST API, none of them released. The guide says in three sentences what it said in a section.
- An agent learns that an original is encrypted when it opens it, as it would of any file it is sent.
- An organization whose policy is that originals are kept encrypted checks that with its own tools, and keeps what opens them where it keeps such things.
- The tokens of a deployment's directory stand (ADR-0088, points 1 to 4): they decide who reads a pack, which is the deployment's to decide.
- Rejected: keeping the report of a front-matter key that holds a password (what an author writes into a pack is the author's, and the format has no such key to misuse); keeping the declaration without the check (a statement nothing holds anyone to); a deployment that opens originals with a password it is told (a PDF implementation and a secret in the server, for a file its readers open themselves).
