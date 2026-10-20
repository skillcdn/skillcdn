---
"@skillcdn/core": patch
---

A run of some hundred thousand characters in a script read by pairs (Han, Hangul, Hiragana, Katakana) no longer overflows the stack of the word rules, which failed the indexing of a pack whose file held one.
