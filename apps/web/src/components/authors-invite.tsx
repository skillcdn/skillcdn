import { useI18n } from "../i18n/index.js";
import { LINKS } from "../site.js";
import { AddressForm } from "./address-form.js";
import styles from "./authors-invite.module.css";
import { cx } from "./ui.js";

/**
 * The invitation to open a repository one already has in mind, at the foot of the landing page
 * and under the explorer's grid. The same words and the same box in both places: a reader who
 * arrives at it from either side should not have to work out that it is the same thing.
 */
export function AuthorsInvite(props: {
  readonly origin: string;
  /** What the page around it needs: its own spacing, and whatever it hangs off the box. */
  readonly className?: string;
  /** The small line under the field. The explorer has room for it; the landing page does not. */
  readonly footnote?: boolean;
}) {
  const { t } = useI18n();
  const copy = t.landing.authors;
  return (
    <section className={cx(styles.section, props.className)}>
      <div className={styles.copy}>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <a href={LINKS.convention}>
          {copy.convention}
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
      <AddressForm origin={props.origin} label={copy.check} footnote={props.footnote} />
    </section>
  );
}
