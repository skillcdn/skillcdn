import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { FEATURED_VIDEO } from "../site.js";
import styles from "./featured-skill.module.css";

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

/** Editorial media is bundled with the site; repository content never supplies image URLs. */
export function FeaturedSkill() {
  const { t } = useI18n();
  const copy = t.landing.featured.video;
  return (
    <article className={styles.card}>
      <div className={styles.art}>
        <img
          src={FEATURED_VIDEO.image}
          alt={copy.imageAlt}
          width="1536"
          height="1024"
          loading="lazy"
        />
        <span className={styles.preview}>{copy.preview}</span>
        <span className={styles.artCaption}>
          {copy.category}
          <span aria-hidden="true">↗</span>
        </span>
      </div>
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
