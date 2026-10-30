import { describe, expect, it } from "vitest";
import {
  isShowcaseLink,
  MEDIA_CONTENT_TYPES,
  mediaFitsSlot,
  mediaShaOfLink,
  restShowcaseSchema,
  showcaseCut,
  showcaseInputSchema,
  showcaseOrganizationInputSchema,
} from "./showcase.js";

// The landing showcase (ADR-0028): an entry may link to the result it shows and say whose work
// it is, and organizations stand beside the entries.

const sha = "a".repeat(64);

const entry = {
  address: "/gh/acme/skills",
  width: 1200,
  height: 750,
  media: { poster: sha },
  texts: { en: { title: "Card news", body: "Eight slides.", action: "See the result" } },
};

describe("a result link", () => {
  it("is an https URL or an absolute path of the deployment, and nothing that could be read as another", () => {
    expect(isShowcaseLink("https://example.com/post/1")).toBe(true);
    expect(isShowcaseLink(`/media/${sha}`)).toBe(true);
    expect(isShowcaseLink("/showcase/deck.pdf")).toBe(true);
    expect(isShowcaseLink("http://example.com")).toBe(false);
    expect(isShowcaseLink("//example.com/x")).toBe(false);
    expect(isShowcaseLink("javascript:alert(1)")).toBe(false);
    expect(isShowcaseLink("showcase/deck.pdf")).toBe(false);
    expect(isShowcaseLink("/a path")).toBe(false);
    expect(isShowcaseLink("https://example.com/\u0000")).toBe(false);
  });

  it("is optional in what the operator writes, with whose work the entry shows", () => {
    expect(showcaseInputSchema.safeParse(entry).success).toBe(true);
    const linked = showcaseInputSchema.safeParse({
      ...entry,
      link: "https://example.com/result",
      origin: "builder",
    });
    expect(linked.success).toBe(true);
    expect(showcaseInputSchema.safeParse({ ...entry, link: null }).success).toBe(true);
    expect(showcaseInputSchema.safeParse({ ...entry, link: "ftp://x" }).success).toBe(false);
    expect(showcaseInputSchema.safeParse({ ...entry, origin: "friend" }).success).toBe(false);
  });

  it("may be a document the operator uploaded, which no slot takes", () => {
    expect(MEDIA_CONTENT_TYPES).toContain("application/pdf");
    expect(mediaFitsSlot("poster", "application/pdf")).toBe(false);
    expect(mediaFitsSlot("clip", "application/pdf")).toBe(false);
  });

  it("names an upload of the deployment by its hash, and nothing else", () => {
    expect(mediaShaOfLink(`/media/${sha}`)).toBe(sha);
    expect(mediaShaOfLink("/media/not-a-hash")).toBeUndefined();
    expect(mediaShaOfLink(`https://example.com/media/${sha}`)).toBeUndefined();
    expect(mediaShaOfLink("/showcase/deck.pdf")).toBeUndefined();
  });
});

describe("the showcase on the wire", () => {
  it("reads an answer of an older deployment, without the newer fields", () => {
    const older = {
      items: [
        {
          id: "spring",
          address: "/gh/acme/skills",
          position: 0,
          width: 640,
          height: 480,
          durationMs: null,
          published: null,
          media: {
            clip: null,
            animation: null,
            poster: { url: `/media/${sha}`, type: "image/webp" },
            reference: null,
            picture: null,
            social: null,
          },
          texts: {
            en: {
              title: "A poster",
              body: "Only a picture.",
              tags: [],
              action: "Open",
              requirement: null,
              clip: null,
              credit: null,
              demo: null,
            },
          },
        },
      ],
    };
    expect(restShowcaseSchema.safeParse(older).success).toBe(true);
    const newer = restShowcaseSchema.safeParse({
      items: [{ ...older.items[0], link: "https://example.com/post", origin: "pack" }],
      organizations: [
        {
          id: "acme",
          name: "Acme",
          url: "https://acme.example",
          logo: { url: `/media/${sha}`, type: "image/png" },
          position: 0,
        },
      ],
    });
    expect(newer.success).toBe(true);
    expect(newer.data?.organizations).toHaveLength(1);
  });

  it("cuts a result per language, each cut its own files, and reads an entry without cuts", () => {
    const other = "b".repeat(64);
    const cut = { ko: { link: `/media/${other}`, media: { clip: other, poster: other } } };
    // A cut's clip needs the entry's duration and date as the entry's own does; a cut is
    // named by a language tag.
    expect(showcaseInputSchema.safeParse({ ...entry, cuts: cut }).success).toBe(false);
    const dated = { ...entry, durationMs: 9000, published: "2026-10-30", cuts: cut };
    expect(showcaseInputSchema.safeParse(dated).success).toBe(true);
    expect(showcaseInputSchema.safeParse({ ...dated, cuts: { Korean: cut.ko } }).success).toBe(
      false,
    );
    expect(
      showcaseInputSchema.safeParse({ ...entry, cuts: { ko: { link: `/media/${other}` } } })
        .success,
    ).toBe(true);

    const wire = restShowcaseSchema.parse({
      items: [
        {
          id: "spring",
          address: "/gh/acme/skills",
          link: "https://acme.example/spring",
          position: 0,
          width: 640,
          height: 480,
          durationMs: 9000,
          published: "2026-10-30",
          media: {
            clip: { url: `/media/${sha}`, type: "video/mp4" },
            animation: null,
            poster: { url: `/media/${sha}`, type: "image/webp" },
            reference: null,
            picture: null,
            social: { url: `/media/${sha}`, type: "image/png" },
          },
          texts: {},
          cuts: {
            ko: {
              link: null,
              media: {
                clip: { url: `/media/${other}`, type: "video/mp4" },
                animation: null,
                poster: null,
                social: null,
              },
            },
          },
        },
      ],
    });
    const item = wire.items[0];
    if (item === undefined) throw new Error("no item");
    // The Korean page gets the Korean clip and the entry's own poster, link and preview; the
    // English page the entry's own throughout; and an entry without cuts is read as before.
    expect(showcaseCut(item, "ko")).toEqual({
      link: "https://acme.example/spring",
      media: { ...item.media, clip: { url: `/media/${other}`, type: "video/mp4" } },
    });
    expect(showcaseCut(item, "en")).toEqual({ link: item.link, media: item.media });
    const { cuts: _cuts, ...bare } = item;
    expect(showcaseCut(bare, "ko")).toEqual({ link: item.link, media: item.media });
  });

  it("takes an organization as a name, a site and an uploaded mark", () => {
    expect(
      showcaseOrganizationInputSchema.safeParse({
        name: "Acme",
        url: "https://acme.example",
        logo: sha,
      }).success,
    ).toBe(true);
    expect(
      showcaseOrganizationInputSchema.safeParse({ name: "Acme", url: "acme.example", logo: sha })
        .success,
    ).toBe(false);
    expect(
      showcaseOrganizationInputSchema.safeParse({
        name: "",
        url: "https://acme.example",
        logo: sha,
      }).success,
    ).toBe(false);
  });
});
