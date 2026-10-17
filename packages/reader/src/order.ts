/**
 * The order the index keeps paths in, whatever the machine: by the bytes of UTF-8, which is the
 * order of code points. A string comparison in JavaScript orders by UTF-16 code units and
 * disagrees above the basic plane, so paths are compared code point by code point.
 */
export function compareByteOrder(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.codePointAt(index) ?? 0;
    const right = b.codePointAt(index) ?? 0;
    if (left !== right) {
      return left < right ? -1 : 1;
    }
    if (left > 0xffff) {
      index += 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** `items` sorted by `pathOf` in byte order, without changing the given array. */
export function sortedByPath<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareByteOrder(pathOf(a), pathOf(b)));
}
