import { createCanvas } from "@napi-rs/canvas";
import type { SocialCard } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { drawSocialCard, wrapText } from "./card.js";

const CARD: SocialCard = {
  kicker: "Repository",
  title: "Acme 스킬: 릴리스 노트, 인시던트 리뷰, 그리고 아주 긴 이름의 저장소",
  subtitle: "skills.example/gh/acme/skills",
  description:
    "The skills Acme's teams share. Use them for release notes, incident reviews and API design, and for anything else that a long description can say about a repository until it no longer fits the card and has to be cut.",
  badges: ["6 skills", "Verified"],
  verified: true,
  avatar: "https://avatars.example/acme.png",
  siteName: "SkillCDN",
};

/** The size a PNG declares in its header. */
function pngSize(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("drawSocialCard", () => {
  it("draws a 1200 by 630 PNG, with the owner's picture, without one, and with bytes that are not a picture", async () => {
    const plain = await drawSocialCard(CARD, undefined);
    expect(pngSize(plain)).toEqual({ width: 1200, height: 630 });

    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff6600";
    ctx.fillRect(0, 0, 64, 64);
    const avatar = new Uint8Array(canvas.toBuffer("image/png"));
    const pictured = await drawSocialCard(CARD, avatar);
    expect(pngSize(pictured)).toEqual({ width: 1200, height: 630 });
    expect(Buffer.from(pictured).equals(Buffer.from(plain))).toBe(false);

    const garbage = await drawSocialCard(
      { ...CARD, badges: [], verified: false },
      new TextEncoder().encode("not a picture"),
    );
    expect(pngSize(garbage)).toEqual({ width: 1200, height: 630 });
  });
});

describe("wrapText", () => {
  const measure = (text: string) => text.length * 10;

  it("fills lines up to the width and keeps every word when they fit", () => {
    expect(wrapText(measure, "one two three four", 100, 2)).toEqual(["one two", "three four"]);
  });

  it("ends a cut text with an ellipsis that still fits", () => {
    expect(wrapText(measure, "one two three four", 100, 1)).toEqual(["one two…"]);
    expect(wrapText(measure, "one two three four five six", 100, 2)).toEqual([
      "one two",
      "three fou…",
    ]);
  });

  it("breaks a word wider than a line where it stops fitting", () => {
    expect(wrapText(measure, "abcdefghijklmnop", 100, 2)).toEqual(["abcdefghij", "klmnop"]);
    expect(wrapText(measure, "abcdefghijklmnop", 100, 1)).toEqual(["abcdefghi…"]);
  });

  it("folds whitespace and says nothing for nothing", () => {
    expect(wrapText(measure, "  one \n two  ", 100, 2)).toEqual(["one two"]);
    expect(wrapText(measure, "", 100, 2)).toEqual([]);
  });
});
