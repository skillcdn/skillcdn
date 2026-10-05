import { loginPath } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { useLegalLinks } from "../legal-links.js";
import type { LegalLinks } from "../site.js";
import styles from "./sign-in.module.css";
import { cx, Skeleton } from "./ui.js";
import ui from "./ui.module.css";

/** Where the links go in the sentence of a language pack: `{terms}` and `{privacy}`. */
const LINK_SLOT = /\{(terms|privacy)\}/;

/**
 * What continuing agrees to, by what the deployment has: its terms, its privacy policy, both,
 * or nothing to say. The sentence is the pack's; the links stand where it marks them, and open
 * beside the page, so that reading them does not lose what the person was about to do.
 */
function Agreement(props: { readonly legal: LegalLinks }) {
  const { t } = useI18n();
  const { termsUrl, privacyUrl } = props.legal;
  const words = t.auth.agreement;
  const sentence =
    termsUrl !== undefined && privacyUrl !== undefined
      ? words.both
      : termsUrl !== undefined
        ? words.terms
        : privacyUrl !== undefined
          ? words.privacy
          : undefined;
  if (sentence === undefined) {
    return null;
  }
  // Split on a pattern with a group: the words and the names of the slots, in turn.
  const parts = sentence.split(LINK_SLOT);
  return (
    <p className={styles.agreement}>
      {parts.map((part, index) => {
        if (index % 2 === 0) {
          return part;
        }
        const [href, name] =
          part === "terms" ? [termsUrl, words.termsName] : [privacyUrl, words.privacyName];
        return href === undefined ? (
          name
        ) : (
          <a key={part} href={href} target="_blank" rel="noopener noreferrer">
            {name}
          </a>
        );
      })}
    </p>
  );
}

/**
 * The way out to the git host: the one button that leaves to sign in, and under it what
 * continuing agrees to. Signing in and signing up are the same step, so every place that lets a
 * person sign in shows this, or links to the page that does (ADR-0041): nobody leaves for the
 * host without having seen which host that is and what they accept by it. That is also why
 * nothing here is shown before the deployment's own links are known.
 */
export function SignIn(props: {
  /** The page to come back to, signed in: a path of this origin. */
  readonly returnTo: string;
  /**
   * Have the host ask which account, for someone who has just said the one it would take is
   * not theirs. Anyone else is offered that as the smaller way beside the button.
   */
  readonly chooseAccount?: boolean;
  /** Called as the browser leaves, by a page that keeps something until the person is back. */
  readonly onLeave?: () => void;
}) {
  const { t } = useI18n();
  const legal = useLegalLinks();
  if (legal === undefined) {
    return <Skeleton lines={2} label={t.common.loading} />;
  }
  const choosing = props.chooseAccount === true;
  return (
    <div className={styles.signIn}>
      {/* A real navigation: signing in happens at the git host, not in this page. */}
      <a
        className={cx(ui.button, ui.primary, styles.leave)}
        href={loginPath(props.returnTo, { chooseAccount: choosing })}
        onClick={props.onLeave}
      >
        <span className={styles.mark} aria-hidden="true" />
        {t.auth.continueWith}
      </a>
      <Agreement legal={legal} />
      {!choosing && (
        <p className={styles.other}>
          <a href={loginPath(props.returnTo, { chooseAccount: true })} onClick={props.onLeave}>
            {t.auth.switchAccount}
          </a>
        </p>
      )}
    </div>
  );
}
