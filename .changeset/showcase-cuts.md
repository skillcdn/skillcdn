---
"@skillcdn/core": patch
---

A showcase entry may carry `cuts`: by language tag, the result cut in that language, with its own `link` and `media` (`clip`, `animation`, `poster`, `social`), where `null` is the entry's own. `showcaseCut(entry, language)` resolves the files and the link a page in a language shows; `restShowcaseCutSchema` reads a cut and `showcaseCutInputSchema` validates one as the admin API takes it, with `SHOWCASE_CUT_SLOTS` naming the slots a cut may give its own file for. An answer without `cuts` reads as before.
