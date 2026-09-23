import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { FEATURED_VIDEO } from "../site.js";
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
 * The concept clip. It is fetched only once it is on screen and plays, muted and looped, while
 * it is there. Where motion is not wanted, or a browser refuses to play (one saving power, say),
 * its poster stands in for it. Nothing is written over it: the card beside it says what it is.
 */
function ConceptClip(props: { readonly description: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const video = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const node = video.current;
    if (node === null) return;
    if (!inView) {
      node.pause();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.play().catch((error: unknown) => {
      // A play that was only interrupted, by scrolling away, is not a refusal.
      if (error instanceof DOMException && error.name === "NotAllowedError") setStill(true);
    });
  }, [inView]);

  return (
    <div ref={ref} className={styles.art}>
      {still ? (
        <img
          src={FEATURED_VIDEO.poster}
          alt={props.description}
          width={FEATURED_VIDEO.width}
          height={FEATURED_VIDEO.height}
        />
      ) : (
        <video
          ref={video}
          src={FEATURED_VIDEO.clip}
          poster={FEATURED_VIDEO.poster}
          width={FEATURED_VIDEO.width}
          height={FEATURED_VIDEO.height}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          aria-label={props.description}
        />
      )}
    </div>
  );
}

/** Editorial media is bundled with the site; repository content never supplies media URLs. */
export function FeaturedSkill() {
  const { t } = useI18n();
  const copy = t.landing.featured.video;
  return (
    <article className={styles.card}>
      <ConceptClip description={copy.clip} />
      <div className={styles.content}>
        <p className={styles.eyebrow}>{copy.credit}</p>
        <h3>{copy.title}</h3>
        <p className={styles.body}>{copy.body}</p>
        <ul className={styles.tags}>
          {copy.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
        <Link href={FEATURED_VIDEO.href} className={styles.action}>
          {copy.action}
          <ArrowIcon />
        </Link>
        <p className={styles.requirement}>{copy.requirement}</p>
      </div>
    </article>
  );
}
