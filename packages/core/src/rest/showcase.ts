// The mini build of zod, as in contracts.ts: these schemas also run in the browser.
import * as z from "zod/mini";

// The landing showcase (ADR-0028): what the front page leads with, as the operator writes it
// through the admin API and as the pages read it through the REST API. Contract: docs/specs/rest.md
// and the admin API in deploy/README.md. Absent values are `null` on the wire, never missing keys.

/**
 * The public reference repository of this project. A fresh deployment features it in the explorer
 * and shows the build's own showcase of it on the front page, until the operator lists something.
 */
export const REFERENCE_REPOSITORY_ADDRESS = "/gh/skillcdn/skills";

/** Where uploaded media is served: `/media/<sha256>`, immutable, since the name is the content. */
export const MEDIA_ROUTE = "/media";

/** The most bytes one uploaded file may have. A landing clip is a hero image, not a film. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export const VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"] as const;
export const IMAGE_CONTENT_TYPES = [
  "image/avif",
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
] as const;
/** A document a showcase entry may link to as its result: a deck, say. No slot takes one. */
export const DOCUMENT_CONTENT_TYPES = ["application/pdf"] as const;
/** What the operator may upload. Anything else is refused before it is stored. */
export const MEDIA_CONTENT_TYPES: readonly string[] = [
  ...VIDEO_CONTENT_TYPES,
  ...IMAGE_CONTENT_TYPES,
  ...DOCUMENT_CONTENT_TYPES,
];

/**
 * Whose work a showcase entry shows: a result made with the pack its address names (`pack`), or
 * a builder's own case, running on its own site, made with that pack (`builder`).
 */
export const SHOWCASE_ORIGINS = ["pack", "builder"] as const;
export type ShowcaseOrigin = (typeof SHOWCASE_ORIGINS)[number];

/**
 * Where the result of an entry is: an `https` URL, or an absolute path of the deployment, such as
 * an upload under `/media/` or a file of the web build. A protocol-relative path is neither.
 */
export function isShowcaseLink(value: string): boolean {
  if (/[\s\p{Cc}]/u.test(value)) {
    return false;
  }
  if (value.startsWith("/")) {
    return !value.startsWith("//");
  }
  // A scheme, a host of at least one character, and whatever follows; `core` has no URL parser.
  return /^https:\/\/[^/?#]+/.test(value);
}

/**
 * The places media takes in a showcase entry: the clip and, where a browser will not play it, the
 * same clip as an animated image; the poster that stands in for both; what the example conversation
 * attaches; and a picture for link previews of the front page.
 */
export const SHOWCASE_MEDIA_SLOTS = {
  clip: "video",
  animation: "image",
  poster: "image",
  reference: "image",
  picture: "image",
  social: "image",
} as const;
export type ShowcaseMediaSlot = keyof typeof SHOWCASE_MEDIA_SLOTS;

/** An entry's name in URLs and in the admin API: a short lowercase slug. */
export const SHOWCASE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
/** A language of the texts, as the pages spell theirs: `en`, `ko`, `pt-BR`. */
export const SHOWCASE_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));

/**
 * The example conversation of the front page, in one language: the words of the person and of
 * the assistant, in the order they are said. The pace of the animation follows the length of
 * these lines, so a translation cannot make two of them overlap.
 */
export const showcaseDemoSchema = z.object({
  prompt: text(300),
  /** Captions of what the person attaches, shown for the media the entry has in those slots. */
  reference: text(60),
  picture: text(60),
  question: text(400),
  answer: text(400),
  plan: text(600),
  /** The line that says the plan and the estimate were reviewed, before the person consents. */
  approval: text(120),
  consent: text(200),
  /** Said over the result while it is being made. */
  working: text(80),
  /** What the result is, in one line, for whoever cannot see it. */
  result: text(200),
});
export type ShowcaseDemo = z.infer<typeof showcaseDemoSchema>;

/** The words of a showcase entry in one language, as the pages read them. */
export const showcaseTextsSchema = z.object({
  title: text(120),
  body: text(600),
  tags: z.array(text(40)).check(z.maxLength(4)),
  /** The call to action on the card. */
  action: text(60),
  /** What the skill needs besides the AI app, such as a tool connection. */
  requirement: z.nullable(text(120)),
  /** What the clip shows, for whoever cannot see it play. */
  clip: z.nullable(text(600)),
  /** Who made the showcase, said above the title. */
  credit: z.nullable(text(80)),
  demo: z.nullable(showcaseDemoSchema),
});
export type ShowcaseTexts = z.infer<typeof showcaseTextsSchema>;

/** One uploaded file as the pages reach it, with the type the video or picture element needs. */
export const showcaseMediaSchema = z.object({ url: z.string(), type: z.string() });
export type ShowcaseMedia = z.infer<typeof showcaseMediaSchema>;

export const restShowcaseEntrySchema = z.object({
  id: z.string(),
  /** Where the card leads: the address of the skill's repository, with a ref and a path when given. */
  address: z.string(),
  /**
   * Where the result itself is: an `https` URL or a path of the deployment, or `null` for an
   * entry whose result is its media. Absent from an answer of a deployment older than the field.
   */
  link: z.optional(z.nullable(z.string())),
  /**
   * What the result at `link` is, when it is an upload of the deployment (`image/webp`,
   * `application/pdf`, say), so that a page can show it in place; `null` for a result
   * elsewhere. Absent from an answer of a deployment older than the field.
   */
  linkType: z.optional(z.nullable(z.string())),
  /** Whose work the entry shows (`SHOWCASE_ORIGINS`); absent from an older deployment: `pack`. */
  origin: z.optional(z.enum(SHOWCASE_ORIGINS)),
  position: z.int(),
  /** Pixel size of the clip and its poster. */
  width: z.int(),
  height: z.int(),
  /** One pass of the clip, when there is one. */
  durationMs: z.nullable(z.int()),
  /** When the clip was published, `YYYY-MM-DD`, for the structured data that describes it. */
  published: z.nullable(z.string()),
  media: z.object({
    clip: z.nullable(showcaseMediaSchema),
    animation: z.nullable(showcaseMediaSchema),
    poster: showcaseMediaSchema,
    reference: z.nullable(showcaseMediaSchema),
    picture: z.nullable(showcaseMediaSchema),
    social: z.nullable(showcaseMediaSchema),
  }),
  /** By language tag. The pages fall back to the default language, then to any language. */
  texts: z.record(z.string(), showcaseTextsSchema),
});
export type RestShowcaseEntry = z.infer<typeof restShowcaseEntrySchema>;

/** An organization named beside the showcase, with its mark: a pack's publisher, a builder's company. */
export const restShowcaseOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Its site, where the mark leads. */
  url: z.string(),
  logo: showcaseMediaSchema,
  position: z.int(),
});
export type RestShowcaseOrganization = z.infer<typeof restShowcaseOrganizationSchema>;

export const restShowcaseSchema = z.object({
  items: z.array(restShowcaseEntrySchema),
  /** The organizations, in order; absent from an answer of a deployment older than the field. */
  organizations: z.optional(z.array(restShowcaseOrganizationSchema)),
});
export type RestShowcase = z.infer<typeof restShowcaseSchema>;

const optionalText = (max: number) => z.optional(z.nullable(text(max)));

/** The words of an entry as the operator writes them: what may be left out is left out. */
export const showcaseTextsInputSchema = z.object({
  title: text(120),
  body: text(600),
  tags: z.optional(z.array(text(40)).check(z.maxLength(4))),
  action: text(60),
  requirement: optionalText(120),
  clip: optionalText(600),
  credit: optionalText(80),
  demo: z.optional(z.nullable(showcaseDemoSchema)),
});
export type ShowcaseTextsInput = z.infer<typeof showcaseTextsInputSchema>;

const sha256 = z.string().check(z.regex(SHA256_PATTERN));
const optionalSha = z.optional(z.nullable(sha256));
const pixels = z.int().check(z.minimum(1), z.maximum(8192));

/**
 * An entry as the operator sends it to the admin API. Media is named by the SHA-256 of an upload;
 * the server checks that each one exists and is a video or a picture as its slot needs. A clip
 * needs its duration and its publication date, which the structured data of the page requires.
 */
const link = z.string().check(z.minLength(1), z.maxLength(2048), z.refine(isShowcaseLink));

export const showcaseInputSchema = z
  .object({
    address: z.string().check(z.minLength(1), z.maxLength(512)),
    link: z.optional(z.nullable(link)),
    origin: z.optional(z.enum(SHOWCASE_ORIGINS)),
    position: z.optional(z.int().check(z.minimum(-1_000_000), z.maximum(1_000_000))),
    width: pixels,
    height: pixels,
    durationMs: z.optional(z.nullable(z.int().check(z.minimum(1), z.maximum(3_600_000)))),
    published: z.optional(z.nullable(z.string().check(z.regex(DATE_PATTERN)))),
    media: z.object({
      poster: sha256,
      clip: optionalSha,
      animation: optionalSha,
      reference: optionalSha,
      picture: optionalSha,
      social: optionalSha,
    }),
    texts: z.record(z.string().check(z.regex(SHOWCASE_LANGUAGE_PATTERN)), showcaseTextsInputSchema),
  })
  .check(
    z.refine((entry) => Object.keys(entry.texts).length > 0, {
      message: "texts must have at least one language",
      path: ["texts"],
    }),
    z.refine(
      (entry) =>
        entry.media.clip === undefined ||
        entry.media.clip === null ||
        (typeof entry.durationMs === "number" && typeof entry.published === "string"),
      {
        message: "a clip needs durationMs and published",
        path: ["media", "clip"],
      },
    ),
  );
export type ShowcaseInput = z.infer<typeof showcaseInputSchema>;

/** An organization as the operator sends it to the admin API; its logo is an uploaded picture. */
export const showcaseOrganizationInputSchema = z.object({
  name: text(80),
  url: z.string().check(
    z.minLength(1),
    z.maxLength(2048),
    z.refine((value) => /^https?:\/\//.test(value)),
  ),
  logo: sha256,
  position: z.optional(z.int().check(z.minimum(-1_000_000), z.maximum(1_000_000))),
});
export type ShowcaseOrganizationInput = z.infer<typeof showcaseOrganizationInputSchema>;

/** The texts of an entry as the pages read them: every optional word present, as `null`. */
export function completeShowcaseTexts(input: ShowcaseTextsInput): ShowcaseTexts {
  return {
    title: input.title,
    body: input.body,
    tags: input.tags ?? [],
    action: input.action,
    requirement: input.requirement ?? null,
    clip: input.clip ?? null,
    credit: input.credit ?? null,
    demo: input.demo ?? null,
  };
}

/** The URL an upload is served at. */
export function mediaUrl(sha: string): string {
  return `${MEDIA_ROUTE}/${sha}`;
}

/** The upload a link names, when it is one of the deployment's own: the SHA-256 in `/media/<sha>`. */
export function mediaShaOfLink(link: string): string | undefined {
  const sha = link.startsWith(`${MEDIA_ROUTE}/`) ? link.slice(MEDIA_ROUTE.length + 1) : "";
  return SHA256_PATTERN.test(sha) ? sha : undefined;
}

/** Whether an upload of this type may take this slot. */
export function mediaFitsSlot(slot: ShowcaseMediaSlot, contentType: string): boolean {
  const accepted: readonly string[] =
    SHOWCASE_MEDIA_SLOTS[slot] === "video" ? VIDEO_CONTENT_TYPES : IMAGE_CONTENT_TYPES;
  return accepted.includes(contentType);
}
