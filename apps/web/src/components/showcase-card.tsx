import type { RestShowcaseEntry, ShowcaseTexts } from "@skillcdn/core";
import { useEffect, useRef, useState } from "react";
import { track } from "../analytics.js";
import { useI18n } from "../i18n/index.js";
import type { Language } from "../i18n/languages.js";
import { Link } from "../navigation.js";
import { showcaseTexts } from "../showcase.js";
import { ClipAnimation, isRefusal } from "./clip-animation.js";
import glass from "./glass.module.css";
import styles from "./showcase-card.module.css";
import { ArrowIcon, cx } from "./ui.js";
import { useInView } from "./use-in-view.js";

/**
 * The stage of an entry: its clip, fetched once it is on screen and played muted and looped
 * while it is there, or its poster. Where the browser will not start the clip by itself, the
 * same clip as an animated image takes its place, as it does for an entry without a clip.
 * Under reduced motion it does not start, and the poster stands.
 */
function Stage(props: { readonly entry: RestShowcaseEntry; readonly description: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const { media, width, height } = props.entry;
  // A tall result, a phone's clip, stands whole in the stage, over itself blurred; as the lead
  // of a wide screen it stands as a column of its own, at its own shape.
  const portrait = height > width;

  useEffect(() => {
    const node = video.current;
    if (node === null) return;
    if (!inView) {
      node.pause();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A browser lets a video start by itself only when it is muted, and the property is what it
    // checks; a client-rendered element does not always have it from the markup alone.
    node.muted = true;
    node.play().catch((error: unknown) => {
      if (isRefusal(error)) setFailed(true);
    });
  }, [inView]);

  return (
    <div ref={ref} className={cx(styles.stage, portrait && styles.portrait)}>
      {portrait && (
        <img className={styles.backdrop} src={media.poster.url} alt="" aria-hidden="true" />
      )}
      {failed || media.clip === null ? (
        <ClipAnimation entry={props.entry} alt={props.description} />
      ) : (
        <video
          ref={video}
          src={media.clip.url}
          poster={media.poster.url}
          width={width}
          height={height}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          aria-label={props.description}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/**
 * One showcase entry (ADR-0028), read in the order the work happened: what was asked, in quotes,
 * with whose work it is and what it came from above it; then the stage with the result; then
 * what came of it and the facts of the deliverable. The whole card leads to the skill that made
 * it, through the title's link stretched over the card. Media comes from the build or from the
 * operator's uploads; repository content never supplies a media URL.
 */
export function ShowcaseCard(props: {
  readonly entry: RestShowcaseEntry;
  readonly language: Language;
  /** The first entry: wide across the row, or a column of its own when its result is tall. */
  readonly lead?: boolean;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const { entry } = props;
  const texts: ShowcaseTexts = showcaseTexts(entry, props.language);
  const copy = t.landing.showcase;
  const origin = entry.origin ?? "pack";
  return (
    <article
      className={cx(
        glass.pane,
        glass.lit,
        styles.card,
        props.lead === true && styles.lead,
        props.className,
      )}
    >
      <div className={styles.head}>
        <p className={styles.meta}>
          <span className={cx(styles.origin, origin === "builder" && styles.builder)}>
            {copy.origins[origin]}
          </span>
          {texts.credit !== null && <span className={styles.credit}>{texts.credit}</span>}
        </p>
        <h3 className={styles.title}>
          <Link
            href={entry.address}
            className={styles.stretched}
            onClick={() => track("showcase_click", { target: "skill" })}
          >
            {texts.title}
          </Link>
        </h3>
      </div>
      <Stage entry={entry} description={texts.clip ?? texts.title} />
      <div className={styles.foot}>
        <p className={styles.body}>{texts.body}</p>
        {texts.tags.length > 0 && (
          <ul className={styles.facts}>
            {texts.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <p className={styles.links}>
          <span className={styles.skill} aria-hidden="true">
            {copy.skill}
            <ArrowIcon />
          </span>
        </p>
        {texts.requirement !== null && <p className={styles.requirement}>{texts.requirement}</p>}
      </div>
    </article>
  );
}

/**
 * The entries as the front page lays them out. The first one leads: a tall result, a phone's
 * clip, stands as a column of its own beside the rest, which lie in two columns with the first
 * of them wide, so that every result is shown at its own shape; a wide result lies across the
 * row instead, its stage beside its words, with the rest in as many columns as fit. On a phone
 * they are a row to swipe through.
 */
export function ShowcaseGrid(props: {
  readonly entries: readonly RestShowcaseEntry[];
  readonly language: Language;
}) {
  const [lead, ...rest] = props.entries;
  const tall = lead !== undefined && lead.height > lead.width;
  return (
    <div className={cx(styles.grid, tall && styles.tall)}>
      {lead !== undefined && (
        <ShowcaseCard entry={lead} language={props.language} lead className={glass.reveal} />
      )}
      {rest.length > 0 && (
        <div className={styles.rest}>
          {rest.map((entry, index) => (
            <ShowcaseCard
              key={entry.id}
              entry={entry}
              language={props.language}
              className={cx(
                glass.reveal,
                index === 0 && styles.wide,
                index % 3 === 0 && glass.late,
                index % 3 === 1 && glass.later,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
