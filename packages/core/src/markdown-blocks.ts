// The lines of a Markdown document that are blocks rather than prose, as the summary and the
// outline both have to tell them apart: a fenced code block hides the headings written inside it,
// and an HTML block hides a picture or a paragraph inside a centred `<div>`.

/** A heading line: one to six `#`, a space, the text; a trailing run of `#` is a closer. */
export const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
/** An ATX heading with nothing after the markers is a heading with no text. */
export const EMPTY_HEADING = /^ {0,3}(#{1,6})[ \t]*$/;
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/**
 * A line that opens an HTML block, with the kind that says where the block ends, as the Markdown
 * grammar has it: a comment at `-->`, a raw-text element at its closing tag, and any other at the
 * next blank line.
 */
export const HTML_OPEN = /^ {0,3}<(?:(!--)|(pre|script|style|textarea)(?=[\s/>]|$))?/i;
export const BLANK = /^\s*$/;
export const COMMENT_END = /-->/;
/** Longer lines are not headings, and short lines keep the patterns cheap on hostile input. */
export const MAX_HEADING_LINE_LENGTH = 1000;

/** What a block scanner remembers between lines: the fence it is in, or the HTML block. */
export interface BlockState {
  fence: string | undefined;
  /** What ends the HTML block the scan is in, while it is in one. */
  htmlEnd: RegExp | undefined;
}

export const openBlocks = (): BlockState => ({ fence: undefined, htmlEnd: undefined });

/**
 * Advances the block state over one line and says whether the line is inside a block, or opens
 * or closes one: such a line is never prose and never a heading. `head` is the start of the line,
 * at most {@link MAX_HEADING_LINE_LENGTH} characters, which is all the patterns look at.
 */
export function consumeBlockLine(state: BlockState, head: string): boolean {
  if (state.htmlEnd !== undefined) {
    if (state.htmlEnd.test(head)) {
      state.htmlEnd = undefined;
    }
    return true;
  }
  const marker = FENCE.exec(head)?.[1];
  if (state.fence !== undefined) {
    // A fence closes with the same character, at least as long as the one that opened it.
    if (
      marker !== undefined &&
      marker[0] === state.fence[0] &&
      marker.length >= state.fence.length
    ) {
      state.fence = undefined;
    }
    return true;
  }
  if (marker !== undefined) {
    state.fence = marker;
    return true;
  }
  const opened = HTML_OPEN.exec(head);
  if (opened !== null) {
    const closer =
      opened[1] !== undefined
        ? COMMENT_END
        : opened[2] !== undefined
          ? new RegExp(`</${opened[2].toLowerCase()}>`, "i")
          : BLANK;
    // A comment or a raw-text element that closes on the line it opened is over already.
    state.htmlEnd =
      closer !== BLANK && closer.test(head.slice(opened[0].length)) ? undefined : closer;
    return true;
  }
  return false;
}

/** Inline markup that gets in the way of a one-line glimpse: links become their text. */
export function plainText(markdown: string): string {
  return markdown
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll(/[`*]+/g, "")
    .replaceAll(/(?<!\w)_+|_+(?!\w)/g, "");
}
