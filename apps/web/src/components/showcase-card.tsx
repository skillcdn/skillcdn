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
import { ArrowIcon, cx, ExternalIcon } from "./ui.js";
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
    <div ref={ref} className={styles.stage}>
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
 * One showcase entry (ADR-0028): what was asked, in quotes, as the title; whose work it is and
 * what it came from; the stage with the result; and two ways out, to the result itself and to
 * the skill that made it. The result is the card's click target when the entry links one,
 * stretched over the card; the skill stays a link of its own above it. Media comes from the
 * build or from the operator's uploads; repository content never supplies a media URL.
 */
export function ShowcaseCard(props: {
  readonly entry: RestShowcaseEntry;
  readonly language: Language;
  /** The first entry: the stage beside the words, wide, rather than above them. */
  readonly lead?: boolean;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const { entry } = props;
  const texts: ShowcaseTexts = showcaseTexts(entry, props.language);
  const copy = t.landing.showcase;
  const link = entry.link ?? null;
  const origin = entry.origin ?? "pack";
  const external = link !== null && /^https?:\/\//.test(link);
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
      <Stage entry={entry} description={texts.clip ?? texts.title} />
      <div className={styles.words}>
        <p className={styles.meta}>
          <span className={cx(styles.origin, origin === "builder" && styles.builder)}>
            {copy.origins[origin]}
          </span>
          {texts.credit !== null && <span className={styles.credit}>{texts.credit}</span>}
        </p>
        <h3 className={styles.title}>
          {link === null ? (
            <Link
              href={entry.address}
              className={styles.stretched}
              onClick={() => track("showcase_click", { target: "skill" })}
            >
              {texts.title}
            </Link>
          ) : (
            <a
              href={link}
              className={styles.stretched}
              {...(external ? { rel: "noopener" } : {})}
              onClick={() => track("showcase_click", { target: "result" })}
            >
              {texts.title}
            </a>
          )}
        </h3>
        <p className={styles.body}>{texts.body}</p>
        {texts.tags.length > 0 && (
          <ul className={styles.tags}>
            {texts.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <p className={styles.links}>
          {link !== null && (
            <span className={styles.result} aria-hidden="true">
              {texts.action}
              <ExternalIcon />
            </span>
          )}
          <Link
            href={entry.address}
            className={styles.skill}
            onClick={() => track("showcase_click", { target: "skill" })}
          >
            {link === null ? texts.action : copy.skill}
            <ArrowIcon />
          </Link>
        </p>
        {texts.requirement !== null && <p className={styles.requirement}>{texts.requirement}</p>}
      </div>
    </article>
  );
}

/**
 * The entries as the front page lays them out: the first one wide, the stage beside the words,
 * and the rest as cards in as many columns as fit; on a phone, a row to swipe through.
 */
export function ShowcaseGrid(props: {
  readonly entries: readonly RestShowcaseEntry[];
  readonly language: Language;
}) {
  return (
    <div className={styles.grid}>
      {props.entries.map((entry, index) => (
        <ShowcaseCard
          key={entry.id}
          entry={entry}
          language={props.language}
          lead={index === 0}
          className={cx(
            glass.reveal,
            index % 3 === 1 && glass.late,
            index % 3 === 2 && glass.later,
          )}
        />
      ))}
    </div>
  );
}
