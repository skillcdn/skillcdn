import {
  createCanvas,
  GlobalFonts,
  loadImage,
  Path2D,
  type SKRSContext2D,
  type Image as SkiaImage,
} from "@napi-rs/canvas";
import {
  BRAND_LOCKUP_WIDTH,
  BRAND_SYMBOL_COLOR,
  BRAND_SYMBOL_PATH,
  BRAND_WORDMARK_PATH,
  SOCIAL_CARD_SIZE,
  type SocialCard,
} from "@skillcdn/core";

// Draws the social preview of an address (ADR-0032): the same dark ground as the pages, the
// owner's picture, what the page is, its name, where it is, what it says of itself, a few facts
// as pills, and the site's mark. Pure: the words and the picture come in, a PNG goes out.

/** The family the web build's fonts are registered under; the system's fonts stand in without. */
const FAMILY = "Pretendard";
const STACK = `"${FAMILY}", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

// The pages' tokens, as the card cannot read a stylesheet.
const COLORS = {
  background: "#0b1019",
  sky: "#0d1730",
  sourceCore: "#dbe7ff",
  sourceBody: "#93b4f2",
  sourceMid: "#7f7ae8b8",
  sourceHalo: "#3a5fd488",
  border: "#263042",
  inset: "#151d2b",
  text: "#e8ebf0",
  muted: "#9aa4b2",
  faint: "#8b97a9",
  accent: "#6ea1ff",
  accentSubtle: "#111a2b",
  point: "#ffb13a",
  pointSubtle: "#2a1a0e",
  contrast: "#ffffff",
  /* The wordmark's white (`--color-wordmark` on the pages): the brand's own, not the text's. */
  wordmark: "#ffffff",
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
/** The lockup at the foot of the card, as tall as the row of pills it stands in, less a little air. */
const BRAND_HEIGHT = 36;

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

// The ground of the pages (apps/web `components/layout.module.css`), read against the card's own
// size: the numbers are copied because the card cannot read a stylesheet, as the colours are.
// Change one, change the other.

/** The card is a crop from well above where the field starts to go, so it is flat almost to the foot. */
const SKY_FLAT = 0.92;
/**
 * The one source, in fractions of the card: an ellipse nearly white at the middle, turning to its
 * own blue, then violet, then deep blue on the way out, and then blurred, because a blur falls off
 * the way light does while a gradient ramps evenly. `core` is how far the white holds, `body` where
 * the light has become its own colour, `mid` where it has turned violet; the same four stops the
 * pages use. The blur is a fraction of the light and not most of it: blurred much harder, the
 * middle stops being a middle and the whole thing reads as a region that happens to be lighter.
 */
const SOURCE = {
  x: 0.5,
  y: 0.8,
  rx: 0.42,
  ry: 0.267,
  core: 0.02,
  body: 0.16,
  mid: 0.5,
  blur: 45,
  strength: 0.34,
} as const;

/** The ground of the pages: a flat dark field with one source of light standing low in it. */
function drawGround(ctx: SKRSContext2D): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, COLORS.sky);
  sky.addColorStop(SKY_FLAT, COLORS.sky);
  sky.addColorStop(1, `${COLORS.sky}d9`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // The source is blurred on a layer of its own: a filter set on the card's own context would
  // blur everything drawn after it as well.
  const layer = createCanvas(WIDTH, HEIGHT);
  const paint = layer.getContext("2d");
  const radius = SOURCE.rx * WIDTH;
  paint.filter = `blur(${SOURCE.blur}px)`;
  paint.save();
  // A canvas gradient is round, so the canvas is squashed instead: the circle becomes the ellipse.
  paint.translate(SOURCE.x * WIDTH, SOURCE.y * HEIGHT);
  paint.scale(1, (SOURCE.ry * HEIGHT) / radius);
  const light = paint.createRadialGradient(0, 0, 0, 0, 0, radius);
  light.addColorStop(0, COLORS.sourceCore);
  light.addColorStop(SOURCE.core, COLORS.sourceCore);
  light.addColorStop(SOURCE.body, COLORS.sourceBody);
  light.addColorStop(SOURCE.mid, COLORS.sourceMid);
  light.addColorStop(1, COLORS.sourceHalo);
  paint.fillStyle = light;
  paint.beginPath();
  paint.arc(0, 0, radius, 0, Math.PI * 2);
  paint.fill();
  paint.restore();
  ctx.globalAlpha = SOURCE.strength;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
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
    // The count is the page's point colour; what says the repository is verified stays the accent,
    // because that is a state and the point colour never carries one.
    ctx.fillStyle = verified ? COLORS.accentSubtle : COLORS.pointSubtle;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.stroke();
    if (verified) {
      drawCheck(ctx, x + 18, y + (height - size) / 2, size);
    }
    ctx.fillStyle = verified ? COLORS.accent : COLORS.point;
    ctx.fillText(badge, x + 20 + iconWidth, y + height / 2 + 1);
    x += width + 12;
  });
}

/**
 * The mark of the site, symbol and wordmark, `height` tall with its right edge at `right` and its
 * middle at `middle`: the same path data the pages draw, the symbol in its own blue and the
 * wordmark in the brand's white, as the pages and the brand files have it. The wordmark is the
 * site's name, so the card does not set it in type as well.
 */
function drawBrand(ctx: SKRSContext2D, right: number, middle: number, height: number): void {
  const scale = height / 100;
  ctx.save();
  ctx.translate(right - BRAND_LOCKUP_WIDTH * scale, middle - height / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = BRAND_SYMBOL_COLOR;
  ctx.fill(new Path2D(BRAND_SYMBOL_PATH));
  ctx.fillStyle = COLORS.wordmark;
  ctx.fill(new Path2D(BRAND_WORDMARK_PATH));
  ctx.restore();
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
  drawBrand(ctx, WIDTH - MARGIN, rowY + 24, BRAND_HEIGHT);

  return new Uint8Array(canvas.toBuffer("image/png"));
}
