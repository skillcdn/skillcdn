---
name: alias-bomb
description: &a [x, x, x, x, x, x, x, x, x]
metadata:
  b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]
  c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]
  d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]
---
# Alias bomb
