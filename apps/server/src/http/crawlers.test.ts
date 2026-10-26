import { describe, expect, it } from "vitest";
import { isCrawler } from "./crawlers.js";

// Which requests are a crawler's or a link preview's (ADR-0074), by what they call themselves.

const CRAWLERS = {
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotPhone:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  claudebot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  ahrefsbot: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  gptbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)",
  applebot:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  yandex: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  baidu: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  bytespider:
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  slurp: "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
  commonCrawl: "CCBot/2.0 (https://commoncrawl.org/faq/)",
  archive: "Mozilla/5.0 (compatible; archive.org_bot +http://archive.org/details/archive.org_bot)",
  naver: "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)",
  daum: "Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html?faqId=28966)",
  inspection: "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
  meta: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  twitter: "Twitterbot/1.0",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  kakao: "facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984",
  linkedin: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  telegram: "TelegramBot (like TwitterBot)",
  whatsapp: "WhatsApp/2.23.20.0 A",
  skype: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  embedly: "Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)",
};

const PEOPLE = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  safari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  kakaoInApp:
    "Mozilla/5.0 (Linux; Android 14; SM-S928N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36;KAKAOTALK 2410530",
  whale:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Whale/3.28.266.14 Safari/537.36",
  cubotPhone:
    "Mozilla/5.0 (Linux; Android 11; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  askedOfChatGpt:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  askedOfClaude: "Claude-User/1.0; +Claude-User@anthropic.com",
  curl: "curl/8.4.0",
};

describe("a crawler", () => {
  it("is what calls itself a crawler or the preview of a link", () => {
    for (const [name, agent] of Object.entries(CRAWLERS)) {
      expect(isCrawler(agent), name).toBe(true);
    }
  });

  it("is not a browser, a person's assistant, a tool, or a request that says nothing", () => {
    for (const [name, agent] of Object.entries(PEOPLE)) {
      expect(isCrawler(agent), name).toBe(false);
    }
    expect(isCrawler(undefined)).toBe(false);
    expect(isCrawler(null)).toBe(false);
    expect(isCrawler("")).toBe(false);
  });
});
