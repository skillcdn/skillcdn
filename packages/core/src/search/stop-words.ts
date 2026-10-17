/**
 * The stop words of PostgreSQL's `english` text-search configuration (its `english.stop`, the
 * Snowball project's list): a word among them is dropped before stemming, on the index side and
 * on the query side alike, so a search for one finds nothing.
 */
export const ENGLISH_STOP_WORDS: ReadonlySet<string> = new Set(
  `i me my myself we our ours ourselves you your yours yourself yourselves he him his himself
she her hers herself it its itself they them their theirs themselves what which who whom this
that these those am is are was were be been being have has had having do does did doing a an
the and but if or because as until while of at by for with about against between into through
during before after above below to from up down in out on off over under again further then
once here there when where why how all any both each few more most other some such no nor not
only own same so than too very s t can will just don should now`.split(/\s+/),
);
