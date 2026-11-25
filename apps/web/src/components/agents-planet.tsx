import styles from "./agents-stage.module.css";
import { cx } from "./ui.js";

// The faces of the agent accounts on the front page: small planets, flat and of two tones, the
// way the reference console draws the avatar of an agent account (skillcdn/console, its
// `avatar.ts`): the lighter tone left of the middle, the next darker right of it. Each is drawn
// once as a symbol and shown wherever it is needed; the colours are the tones of whatever shows
// it (`--t0` to `--t4`, and `--a0`, `--a1` for what stands beside it), so one shape has many
// faces.

/** The planets, by the agent that has each; the last is a face nobody picks. */
const PLANETS = [0, 1, 2, 3] as const;
export type PlanetKind = (typeof PLANETS)[number];
/** The ramps a planet is drawn in. */
export type PlanetTone = "violet" | "sunset" | "mint" | "ocean" | "rose";

/** The colour of a tone of the ramp in use. */
const tone = (n: number): string => `var(--t${n})`;

/** The bumps on the rim of the lumpy body: the middle of each, and its radius. */
const BUMPS = [
  [54.89, 27.01, 5.2],
  [70.35, 38.25, 4.4],
  [72.99, 54.89, 5],
  [62.45, 69.93, 4.2],
  [44.31, 72.8, 5.4],
  [29.65, 61.75, 4.6],
  [27.41, 43.52, 5],
  [38.25, 29.65, 4.2],
] as const;

const RING = "M10 50a40 11 0 1 0 80 0a40 11 0 1 0-80 0ZM18 50a32 8 0 1 1 64 0a32 8 0 1 1-64 0Z";
const SPARKLE = "M76 14q1.4 7.6 9 9q-7.6 1.4-9 9q-1.4-7.6-9-9q7.6-1.4 9-9Z";

/** What lies on a planet's surface, in the tones from `by` on: once for each half. */
function Surface(props: { readonly kind: PlanetKind; readonly by: number }) {
  const { kind, by } = props;
  switch (kind) {
    case 0:
      return (
        <>
          <rect x="20" y="20" width="60" height="60" fill={tone(1 + by)} />
          <rect x="20" y="10" width="60" height="21.5" fill={tone(2 + by)} />
          <path d="M20 40.5q6.5-4.4 13 0t13 0t13 0t13 0t13 0V54H20Z" fill={tone(by)} />
          <path d="M20 67q6.5-4.4 13 0t13 0t13 0t13 0t13 0V90H20Z" fill={tone(2 + by)} />
        </>
      );
    case 1:
      return (
        <>
          <rect x="18" y="18" width="64" height="64" fill={tone(by)} />
          <rect x="38" y="31" width="70" height="12" rx="6" fill={tone(1 + by)} />
          <rect x="-20" y="47" width="74" height="11" rx="5.5" fill={tone(1 + by)} />
          <rect x="18" y="67" width="64" height="20" fill={tone(1 + by)} />
        </>
      );
    case 2:
      return (
        <>
          <rect x="20" y="20" width="60" height="60" fill={tone(by)} />
          <rect x="20" y="10" width="60" height="21" fill={tone(1 + by)} />
          <rect x="20" y="69" width="60" height="20" fill={tone(1 + by)} />
          <rect x="20" y="46.5" width="60" height="7" fill={tone(1 + by)} />
          <ellipse cx="50" cy="50" rx="15.5" ry="9.5" fill={tone(1 + by)} />
          <ellipse cx="50" cy="50" rx="8.5" ry="5" fill={tone(by)} />
        </>
      );
    case 3:
      return (
        <>
          <rect x="20" y="20" width="60" height="60" fill={tone(1 + by)} />
          <circle cx="38" cy="40" r="6.2" fill={tone(2 + by)} />
          <circle cx="63" cy="45" r="4.6" fill={tone(2 + by)} />
          <circle cx="42" cy="63" r="5.2" fill={tone(2 + by)} />
          <circle cx="50" cy="80" r="7.5" fill={tone(2 + by)} />
          <rect x="56" y="57" width="4" height="4" rx="0.6" fill={tone(2 + by)} />
        </>
      );
  }
}

/** A planet, its left half in one tone and its right half in the next, cut to its body. */
function Body(props: { readonly kind: PlanetKind }) {
  return (
    <g clipPath={`url(#agents-body-${props.kind === 1 ? "lumps" : "disc"})`}>
      <Surface kind={props.kind} by={0} />
      <g clipPath="url(#agents-right)">
        <Surface kind={props.kind} by={1} />
      </g>
    </g>
  );
}

/** What stands beside a planet, drawn in two tones as the planet is. */
function Accent(props: { readonly kind: PlanetKind; readonly before: boolean }) {
  switch (props.kind) {
    case 0:
      return (
        <g transform="rotate(-14 50 50)">
          <g clipPath={props.before ? "url(#agents-lower)" : undefined}>
            <path d={RING} fillRule="evenodd" fill="var(--a0)" />
            <path d={RING} fillRule="evenodd" fill="var(--a1)" clipPath="url(#agents-right)" />
          </g>
        </g>
      );
    case 2:
      return props.before ? <path d={SPARKLE} fill="var(--a0)" /> : null;
    case 3:
      return props.before ? (
        <>
          <circle cx="74.5" cy="27.5" r="9" fill="var(--a0)" />
          <path d="M74.5 18.5a9 9 0 0 1 0 18Z" fill="var(--a1)" />
        </>
      ) : null;
    default:
      return null;
  }
}

/** The shapes the planets are shown from: once on the page, before whatever shows one. */
export function PlanetShapes() {
  return (
    <svg className={styles.shapes} width="0" height="0" aria-hidden="true">
      <defs>
        <clipPath id="agents-body-disc">
          <circle cx="50" cy="50" r="27" />
        </clipPath>
        <clipPath id="agents-body-lumps">
          <circle cx="50" cy="50" r="24.5" />
          {BUMPS.map(([x, y, radius]) => (
            <circle key={`${x} ${y}`} cx={x} cy={y} r={radius} />
          ))}
        </clipPath>
        <clipPath id="agents-right">
          <rect x="50" y="-20" width="80" height="140" />
        </clipPath>
        <clipPath id="agents-lower">
          <rect x="-20" y="50" width="140" height="70" />
        </clipPath>
      </defs>
      {PLANETS.map((kind) => (
        <symbol key={kind} id={`agents-planet-${kind}`} viewBox="0 0 100 100">
          <Accent kind={kind} before={false} />
          <Body kind={kind} />
          <Accent kind={kind} before={true} />
        </symbol>
      ))}
    </svg>
  );
}

/** A planet by itself, in the tones of one of the ramps. */
export function Planet(props: {
  readonly kind: PlanetKind;
  readonly tone: PlanetTone;
  readonly className?: string | undefined;
}) {
  return (
    <svg
      className={cx(styles.planet, styles[`tone-${props.tone}`], props.className)}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <use href={`#agents-planet-${props.kind}`} />
    </svg>
  );
}

/** The avatar of an agent account: its planet on a graphite tile. */
export function PlanetTile(props: {
  readonly kind: PlanetKind;
  readonly tone: PlanetTone;
  readonly className?: string | undefined;
}) {
  return (
    <span className={cx(styles.tile, props.className)}>
      <Planet kind={props.kind} tone={props.tone} />
    </span>
  );
}
