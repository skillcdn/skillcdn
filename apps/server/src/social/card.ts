import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type SKRSContext2D,
  type Image as SkiaImage,
} from "@napi-rs/canvas";
import { SOCIAL_CARD_SIZE, type SocialCard } from "@skillcdn/core";

// Draws the social preview of an address (ADR-0032): the same dark ground as the pages, the
// owner's picture, what the page is, its name, where it is, what it says of itself, a few facts
// as pills, and the site's mark. Pure: the words and the picture come in, a PNG goes out.

/** The family the web build's fonts are registered under; the system's fonts stand in without. */
const FAMILY = "Pretendard";
const STACK = `"${FAMILY}", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

// The pages' tokens, as the card cannot read a stylesheet.
const COLORS = {
  background: "#0b1019",
  atmosphere: "#274576",
  point: "#739bd0",
  border: "#263042",
  inset: "#151d2b",
  text: "#e8ebf0",
  muted: "#9aa4b2",
  faint: "#8b97a9",
  accent: "#6ea1ff",
  accentSubtle: "#111a2b",
  contrast: "#ffffff",
} as const;

const { width: WIDTH, height: HEIGHT } = SOCIAL_CARD_SIZE;
const MARGIN = 72;
const AVATAR = 128;
const AVATAR_RADIUS = 28;
const COLUMN = MARGIN + AVATAR + 32;
const TITLE_SIZE = 58;
const TITLE_LEADING = 70;
const TEXT_SIZE = 30;
const TEXT_LEADING = 44;
const MAX_TITLE_LINES = 2;
const MAX_TEXT_LINES = 3;

let registered = false;

/**
 * Makes the build's fonts available to every card drawn from now on. Called once; a file that
 * cannot be read is skipped, and the card is drawn with what the system has.
 */
export function registerCardFonts(paths: readonly string[]): { readonly registered: number } {
  if (registered) {
    return { registered: 0 };
  }
  registered = true;
  let count = 0;
  for (const path of paths) {
    if (GlobalFonts.registerFromPath(path, FAMILY) !== null) {
      count += 1;
    }
  }
  return { registered: count };
}

/** Cuts `text` into at most `maxLines` lines that fit `maxWidth`, the last one ending in an ellipsis when it had to cut. */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  const fits = (candidate: string): boolean => measure(candidate) <= maxWidth;
  const push = (next: string): void => {
    lines.push(next);
    line = "";
  };
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line.length > 0) {
      push(line);
      if (lines.length === maxLines) break;
    }
    // A word too wide for a line on its own (a path, an address) is cut where it stops fitting.
    let rest = word;
    while (!fits(rest) && lines.length < maxLines) {
      let end = rest.length;
      while (end > 1 && !fits(rest.slice(0, end))) end -= 1;
      push(rest.slice(0, end));
      rest = rest.slice(end);
    }
    line = rest;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line.length > 0) {
    lines.push(line);
    line = "";
  }
  const cut = line.length > 0 || words.join(" ").length > lines.join(" ").length;
  if (cut && lines.length > 0) {
    const last = lines.length - 1;
    let shortened = lines[last] ?? "";
    while (shortened.length > 0 && !fits(`${shortened}…`)) {
      shortened = shortened.slice(0, -1).trimEnd();
    }
    lines[last] = `${shortened}…`;
  }
  return lines;
}

function roundedClip(ctx: SKRSContext2D, x: number, y: number, size: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.closePath();
  ctx.clip();
}

/** The ground of the pages: the dark surface, a soft blue glow at the top and a field of points fading down. */
function drawGround(ctx: SKRSContext2D): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const glow = ctx.createRadialGradient(
    WIDTH * 0.3,
    -HEIGHT * 0.2,
    0,
    WIDTH * 0.3,
    -HEIGHT * 0.2,
    WIDTH * 0.75,
  );
  glow.addColorStop(0, `${COLORS.atmosphere}70`);
  glow.addColorStop(1, `${COLORS.atmosphere}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const step = 24;
  for (let y = step / 2; y < HEIGHT; y += step) {
    // Points fade with the distance from the top, as they do on the pages.
    const alpha = Math.max(0, 0.16 * (1 - y / HEIGHT));
    if (alpha <= 0.01) break;
    ctx.fillStyle = `${COLORS.point}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")}`;
    for (let x = step / 2; x < WIDTH; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawAvatar(ctx: SKRSContext2D, picture: SkiaImage | undefined): void {
  ctx.save();
  roundedClip(ctx, MARGIN, MARGIN, AVATAR, AVATAR_RADIUS);
  ctx.fillStyle = COLORS.inset;
  ctx.fillRect(MARGIN, MARGIN, AVATAR, AVATAR);
  if (picture !== undefined) {
    ctx.drawImage(picture, MARGIN, MARGIN, AVATAR, AVATAR);
  }
  ctx.restore();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(MARGIN + 1, MARGIN + 1, AVATAR - 2, AVATAR - 2, AVATAR_RADIUS - 1);
  ctx.stroke();
}

/** The mark of the site: the branching symbol of public/brand/symbol.svg, at the size of the wordmark. */
function drawSymbol(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  const scale = size / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = COLORS.accent;
  ctx.fillStyle = COLORS.accent;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(10, 16);
  ctx.lineTo(14.5, 16);
  ctx.bezierCurveTo(18, 16, 17.5, 10, 22, 10);
  ctx.moveTo(14.5, 16);
  ctx.bezierCurveTo(18, 16, 17.5, 22, 22, 22);
  ctx.stroke();
  for (const [cx, cy, r] of [
    [10, 16, 3],
    [22.4, 10, 2.5],
    [22.4, 22, 2.5],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A check in a filled circle, the mark of a vouched-for repository, before its word. */
function drawCheck(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.contrast;
  ctx.lineWidth = size * 0.11;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.3, y + size * 0.52);
  ctx.lineTo(x + size * 0.44, y + size * 0.66);
  ctx.lineTo(x + size * 0.71, y + size * 0.37);
  ctx.stroke();
  ctx.restore();
}

function drawPills(ctx: SKRSContext2D, card: SocialCard, y: number): void {
  const size = 24;
  ctx.font = `500 ${size}px ${STACK}`;
  ctx.textBaseline = "middle";
  let x = MARGIN;
  const height = 48;
  card.badges.forEach((badge, index) => {
    const verified = card.verified && index === card.badges.length - 1;
    const iconWidth = verified ? size + 10 : 0;
    const width = ctx.measureText(badge).width + 40 + iconWidth;
    ctx.fillStyle = COLORS.accentSubtle;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.stroke();
    if (verified) {
      drawCheck(ctx, x + 18, y + (height - size) / 2, size);
    }
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(badge, x + 20 + iconWidth, y + height / 2 + 1);
    x += width + 12;
  });
}

function drawBrand(ctx: SKRSContext2D, siteName: string, y: number): void {
  const size = 32;
  ctx.font = `700 ${size}px ${STACK}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.text;
  const width = ctx.measureText(siteName).width;
  const x = WIDTH - MARGIN - width;
  ctx.fillText(siteName, x, y + 1);
  drawSymbol(ctx, x - size - 10, y - size / 2, size);
}

/**
 * Draws the card as a PNG. `avatar` is the owner's picture as fetched, or nothing, in which
 * case its place stays an empty tile.
 */
export async function drawSocialCard(
  card: SocialCard,
  avatar: Uint8Array | undefined,
): Promise<Uint8Array> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  drawGround(ctx);

  let picture: SkiaImage | undefined;
  if (avatar !== undefined) {
    try {
      picture = await loadImage(Buffer.from(avatar.buffer, avatar.byteOffset, avatar.byteLength));
    } catch {
      // Whatever the host served was not a picture: the tile stays empty.
      picture = undefined;
    }
  }
  drawAvatar(ctx, picture);

  const column = WIDTH - COLUMN - MARGIN;
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 20px ${STACK}`;
  ctx.fillStyle = COLORS.muted;
  ctx.letterSpacing = "2px";
  ctx.fillText(card.kicker.toUpperCase(), COLUMN, MARGIN + 24);
  ctx.letterSpacing = "0px";

  ctx.font = `700 ${TITLE_SIZE}px ${STACK}`;
  ctx.fillStyle = COLORS.text;
  const measure = (text: string) => ctx.measureText(text).width;
  const titleLines = wrapText(measure, card.title, column, MAX_TITLE_LINES);
  let y = MARGIN + 24 + 26 + TITLE_SIZE;
  for (const line of titleLines) {
    ctx.fillText(line, COLUMN, y);
    y += TITLE_LEADING;
  }

  ctx.font = `400 24px ${STACK}`;
  ctx.fillStyle = COLORS.faint;
  const [subtitle = ""] = wrapText(measure, card.subtitle, column, 1);
  y += 2;
  ctx.fillText(subtitle, COLUMN, y);

  ctx.font = `400 ${TEXT_SIZE}px ${STACK}`;
  ctx.fillStyle = COLORS.muted;
  const textTop = Math.max(y + 44 + TEXT_SIZE, MARGIN + AVATAR + 56 + TEXT_SIZE);
  // Lines fit between the subtitle and the row of pills, with a little air above the pills.
  const bottom = HEIGHT - MARGIN - 48 - 24;
  const room = Math.max(1, Math.floor((bottom - textTop) / TEXT_LEADING) + 1);
  const lines = wrapText(
    measure,
    card.description,
    WIDTH - 2 * MARGIN,
    Math.min(MAX_TEXT_LINES, room),
  );
  y = textTop;
  for (const line of lines) {
    ctx.fillText(line, MARGIN, y);
    y += TEXT_LEADING;
  }

  const rowY = HEIGHT - MARGIN - 48;
  drawPills(ctx, card, rowY);
  drawBrand(ctx, card.siteName, rowY + 24);

  return new Uint8Array(canvas.toBuffer("image/png"));
}
