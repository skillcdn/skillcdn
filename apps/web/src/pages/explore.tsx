import { formatAddress, parseAddress } from "@skillcdn/core";
import { api } from "../api/client.js";
import { useResource } from "../api/use-resource.js";
import { AddressForm } from "../components/address-form.js";
import { FeaturedSkill } from "../components/featured-skill.js";
import { Badge, Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { FEATURED_VIDEO, LINKS } from "../site.js";
import styles from "./explore.module.css";

function Featured() {
  const { t } = useI18n();
  const featured = useResource("featured", (signal) => api.featured(signal));

  // The front page works without this list, so a failure to load it is not worth an error.
  if (featured.state === "error") {
    return null;
  }
  if (featured.state === "loading") {
    return (
      <section className={styles.featured}>
        <h2 className={styles.heading}>{t.explore.featured}</h2>
        <Skeleton label={t.common.loading} />
      </section>
    );
  }
  const seen = new Set<string>([FEATURED_VIDEO.address]);
  const items = featured.value.items.filter((item) => {
    const parsed = parseAddress(item.address);
    if (!parsed.ok) return false;
    const address = parsed.value;
    // Retired public examples are now hidden, test-only fixtures, including at named refs.
    if (
      address.owner === "skillcdn" &&
      address.repo === "skillcdn" &&
      /^skills\/(?:single-skill|multi-skill|hostile|with-manifest)(?:\/|$)/.test(address.path)
    )
      return false;
    const canonical = formatAddress(address);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
  if (items.length === 0) {
    return null;
  }
  return (
    <section className={styles.featured}>
      <h2 className={styles.heading}>{t.explore.featured}</h2>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.address}>
            <Link className={styles.card} href={item.address}>
              <span className={styles.cardTitle}>
                {item.manifest?.name ?? `${item.repository.owner}/${item.repository.name}`}
              </span>
              <span className={styles.cardAddress}>{item.address}</span>
              <span className={styles.cardMeta}>
                {item.status === "ready" && item.skillCount !== null && (
                  <Badge tone="accent">{t.explore.featuredSkills(item.skillCount)}</Badge>
                )}
                {item.status === "indexing" && <Badge>{t.explore.featuredIndexing}</Badge>}
                {item.status === "failed" && (
                  <Badge tone="warning">{t.explore.featuredFailed}</Badge>
                )}
              </span>
              {item.skills.length > 0 && (
                <span className={styles.cardSkills}>{item.skills.join(" · ")}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExplorePage(props: { readonly origin: string }) {
  const { t } = useI18n();
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>{t.explore.title}</h1>
      <p className={styles.lead}>{t.explore.lead}</p>
      <div className={styles.selection}>
        <FeaturedSkill />
      </div>
      <Featured />
      <section className={styles.form}>
        <h2 className={styles.heading}>{t.landing.authors.title}</h2>
        <p className={styles.formLead}>{t.landing.authors.body}</p>
        <AddressForm origin={props.origin} label={t.landing.authors.check} footnote />
        <a className={styles.authorLink} href={LINKS.convention}>
          {t.landing.authors.convention}
        </a>
      </section>
    </Container>
  );
}
