---
"@skillcdn/core": patch
"@skillcdn/reader": patch
"@skillcdn/serve": patch
---

A reader may be handed an index served in place of the one of the mount's own commit, while that one is being built or could not be: the `index` dependency's ready outcome takes a `substitute`, the commit the index was built from and the ref's `newest` commit with why it is not served. Every result then names the commit it was read from, the `Source` line of a tool result carries one clause more (`newest <commit> indexing`, `newest <commit> failed (<code>)`, or `being reindexed` for the same commit under newer reading rules), the connection instructions say so in one sentence, and the `mounts` route answers `newest` beside `commit` (`null` while the two are the same). The page the skills extension lists from such an index is kept as briefly as an empty one, so that the client asks again soon. A caller that hands over no substitute sees nothing new.
