---
"@skillcdn/core": patch
---

`summarizeMarkdown` skips an HTML block whole, to the blank line that ends it (or the closing marker of a comment or a raw-text element), however its lines are indented: a README that opens with a centred `<div>` is introduced by its first paragraph of prose again.
