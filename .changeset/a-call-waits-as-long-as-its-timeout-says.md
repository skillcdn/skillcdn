---
"@skillcdn/inference": patch
"@skillcdn/cli": patch
---

A call to an inference server may take as long as its timeout says. The platform's `fetch` ends a call whose answer has not begun after five minutes, whatever the call was given, so `EMBEDDINGS_TIMEOUT_MS` above 300000 never applied and a batch of long texts on a machine without a GPU failed at the same place every time it was tried. `@skillcdn/inference` exports `inferenceFetch`, one call over Node's HTTP client answered as `fetch` answers, which waits for as long as the signal of the call lets it and follows no redirect; the `skillcdn` command hands it to the adapters when it embeds a directory.
