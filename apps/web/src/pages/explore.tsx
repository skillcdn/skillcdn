import { api } from "../api/client.js";
import { useResource } from "../api/use-resource.js";
import { AddressForm } from "../components/address-form.js";
import { Badge, Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
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
  if (featured.value.items.length === 0) {
    return null;
  }
  return (
    <section className={styles.featured}>
      <h2 className={styles.heading}>{t.explore.featured}</h2>
      <ul className={styles.grid}>
        {featured.value.items.map((item) => (
          <li key={item.address}>
            <Link className={styles.card} href={item.address}>
              <span className={styles.cardTitle}>
                {item.repository.owner}/{item.repository.name}
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
      <div className={styles.form}>
        <AddressForm origin={props.origin} large footnote />
      </div>
      <Featured />
    </Container>
  );
}
