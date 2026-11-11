---
"@skillcdn/core": minor
"@skillcdn/indexer": minor
"@skillcdn/reader": patch
---

Breaking: a manifest says that the originals of its scope are kept encrypted, and a pack is told when it holds a password (ADR-0084, reading rules version 17). `SKILLCDN.md` takes `originals`, a mapping with `encrypted: true` and `key-name`, the name of the key and never the key (`RepoManifest.originals`, `frontMatter.originals` of the manifest's index entry); a result that names an original of the scope says `encrypted, key <name>`, and `DocumentSource` and the REST `sources` carry `encrypted` and `keyName`. The indexer reports a front-matter key written to hold a password as `password_in_front_matter`, by its name and never its value. `check` reads the two ends of each PDF of a working tree (`readWorkingTreeEnds`, `pdfEncryption`): one that is not encrypted under a manifest that says its originals are fails the check as `original_not_encrypted`, and an encrypted one that no manifest speaks of is a note. Nothing reads or takes a password anywhere.
