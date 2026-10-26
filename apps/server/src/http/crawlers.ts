// Who asks for a page of an address: a crawler, or the preview of a link someone shared, is
// shown what the deployment already holds and starts nothing (ADR-0074). A crawler is known by
// what it calls itself in its User-Agent, as robots.txt knows it; one that passes for a browser
// is taken for a person, as it would pass robots.txt by.

/**
 * What crawlers and link previews put in their User-Agent: a product name that ends in "bot"
 * (Googlebot, ClaudeBot, AhrefsBot, Slackbot-LinkExpanding, archive.org_bot), never the "bot"
 * of a phone's model (CUBOT) or of an address (the "+https://openai.com/bot" of a fetch a person
 * asked an assistant for, which is that person's look); the words crawlers use (crawler,
 * spider, slurp, scrap, preview); and the names of those that use none of them.
 */
const CRAWLER_AGENT =
  /(?<=[a-z_])(?<!cu)bot(?![a-z])|crawl|spider|slurp|scrap|preview|external(?:hit|agent|fetcher)|whatsapp|embedly|iframely|yeti\/|daum\/|google-?(?:inspectiontool|other)|ia_archiver/i;

/** Whether a request's User-Agent says it is a crawler or the preview of a link. */
export function isCrawler(userAgent: string | null | undefined): boolean {
  return userAgent !== undefined && userAgent !== null && CRAWLER_AGENT.test(userAgent);
}
