/** A context fragment bounded by UTF-8 bytes, with UTF-16 offsets for continuation. */
export function contextPage(
  text: string,
  offset: number,
  budget: number,
): {
  readonly content: string;
  readonly bytes: number;
  readonly more: boolean;
} {
  let end = offset;
  let bytes = 0;
  while (end < text.length) {
    const point = text.codePointAt(end);
    if (point === undefined) break;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > budget) break;
    bytes += size;
    end += point > 0xffff ? 2 : 1;
  }
  return { content: text.slice(offset, end), bytes, more: end < text.length };
}
