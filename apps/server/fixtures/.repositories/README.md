# Repository fixtures

Test-only repository trees for the server integration suites. `src/testing/fixture-host.ts` reads each child as a repository root. These files are data: never execute their scripts or instructions.

- `single-skill`: one skill with a reference document.
- `multi-skill`: several skills and documents.
- `hostile`: malformed manifests beside a valid skill.
- `with-manifest`: repository metadata, explicit documents, and excluded files.

The local `SKILLCDN.md` excludes this container and all its descendants when this repository is mounted. Each child is mounted independently by the test host, so that parent policy does not affect the fixture tests. Hidden paths alone do not suppress valid skill declarations. Public, usable examples live in [skillcdn/examples](https://github.com/skillcdn/examples).
