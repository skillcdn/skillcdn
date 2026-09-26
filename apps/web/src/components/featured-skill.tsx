import type { RestShowcaseEntry, ShowcaseTexts } from "@skillcdn/core";
import { useEffect, useRef, useState } from "react";
import { Link } from "../navigation.js";
import { ClipAnimation, isRefusal } from "./clip-animation.js";
import styles from "./featured-skill.module.css";
import { useInView } from "./use-in-view.js";

export function ArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

/**
 * The concept clip. It is fetched once it is on screen and plays, muted and looped, while it is
 * there. Where the browser will not start it by itself, or cannot play it, the same clip as an
 * animated image takes its place, as it does for an entry without a clip. Under reduced motion
 * it does not start, and the poster stands.
 */
function ConceptClip(props: { readonly entry: RestShowcaseEntry; readonly description: string }) {
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
    <div ref={ref} className={styles.art}>
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
 * One showcase entry as a card: the clip on top, the words in the visitor's language under it,
 * and the way to the skill. The title is the link, and it stretches over the whole card, so that
 * the card is the click target and the title is what assistive technology reads as the link.
 * Media comes from the build or from the operator's uploads (ADR-0028); repository content never
 * supplies a media URL.
 */
export function FeaturedSkill(props: {
  readonly entry: RestShowcaseEntry;
  readonly texts: ShowcaseTexts;
}) {
  const { entry, texts } = props;
  return (
    <article className={styles.card}>
      <ConceptClip entry={entry} description={texts.clip ?? texts.title} />
      <div className={styles.content}>
        {texts.credit !== null && <p className={styles.eyebrow}>{texts.credit}</p>}
        <h3 className={styles.title}>
          <Link href={entry.address} className={styles.titleLink}>
            {texts.title}
          </Link>
        </h3>
        <p className={styles.body}>{texts.body}</p>
        {texts.tags.length > 0 && (
          <ul className={styles.tags}>
            {texts.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <p className={styles.action} aria-hidden="true">
          {texts.action}
          <ArrowIcon />
        </p>
        {texts.requirement !== null && <p className={styles.requirement}>{texts.requirement}</p>}
      </div>
    </article>
  );
}
