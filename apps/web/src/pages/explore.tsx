import { formatAddress, parseAddress, type RestFeatured } from "@skillcdn/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useResource } from "../api/use-resource.js";
import { AddressForm } from "../components/address-form.js";
import { Badge, Button, Container, Skeleton, VerifiedMark } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { repositoryDescription, repositoryName } from "../i18n/repository-text.js";
import { Link } from "../navigation.js";
import { LINKS } from "../site.js";
import styles from "./explore.module.css";

/** Cards per page. The list is the operator's and arrives whole; the page keeps it readable. */
const PAGE_SIZE = 12;

/**
 * One featured repository: the name it gives itself, else its address; what it is, from its
 * manifest or from what the host says about it; and the first of its skills by name.
 */
function FeaturedCard(props: { readonly item: RestFeatured["items"][number] }) {
  const { t, language } = useI18n();
  const { item } = props;
  const repository = `${item.repository.owner}/${item.repository.name}`;
  const name =
    (item.manifest === null ? null : repositoryName(item.manifest, language)) ?? repository;
  const description =
    item.manifest === null
      ? item.repository.description
      : repositoryDescription(item.manifest, language);
  const address = item.address.replace(/^\/gh\//, "");
  const more = (item.skillCount ?? 0) - item.skills.length;
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>
          <Link className={styles.cardLink} href={item.address}>
            {name}
          </Link>
        </h3>
        {item.verified && <VerifiedMark label={t.mount.verified} hint={t.mount.verifiedHint} />}
      </div>
      {address.toLowerCase() !== name.toLowerCase() && (
        <p className={styles.cardAddress}>{address}</p>
      )}
      {description !== null && description !== "" && (
        <p className={styles.cardBody}>{description}</p>
      )}
      <p className={styles.cardMeta}>
        {item.status === "ready" && item.skillCount !== null && (
          <Badge tone="accent">{t.explore.featuredSkills(item.skillCount)}</Badge>
        )}
        {item.status === "indexing" && <Badge>{t.explore.featuredIndexing}</Badge>}
        {item.status === "failed" && <Badge tone="warning">{t.explore.featuredFailed}</Badge>}
      </p>
      {item.skills.length > 0 && (
        <ul className={styles.chips}>
          {item.skills.map((skill) => (
            <li key={skill}>{skill}</li>
          ))}
          {more > 0 && <li className={styles.chipMore}>{t.explore.moreSkills(more)}</li>}
        </ul>
      )}
    </li>
  );
}

/**
 * The operator's featured list (ADR-0026, ADR-0028): what the explorer leads with. It is its own
 * list, apart from the showcase of the front page; a fresh deployment features the reference
 * repository until the operator features something.
 */
function Featured() {
  const { t } = useI18n();
  const featured = useResource("featured", (signal) => api.featured(signal));
  const [page, setPage] = useState(1);
  const top = useRef<HTMLElement>(null);
  // A new page starts where the list starts, not wherever the buttons were.
  useEffect(() => {
    if (page > 1) top.current?.scrollIntoView({ block: "start" });
  }, [page]);

  // The front page works without this list, so a failure to load it is not worth an error.
  if (featured.state === "error") {
    return null;
  }
  if (featured.state === "loading") {
    return (
      <section className={styles.featured}>
        <h2 className={styles.heading}>{t.explore.featured}</h2>
        <p className={styles.featuredLead}>{t.explore.featuredLead}</p>
        <Skeleton label={t.common.loading} />
      </section>
    );
  }
  const seen = new Set<string>();
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
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <section className={styles.featured} ref={top}>
      <h2 className={styles.heading}>{t.explore.featured}</h2>
      <p className={styles.featuredLead}>{t.explore.featuredLead}</p>
      <ul className={styles.grid}>
        {shown.map((item) => (
          <FeaturedCard key={item.address} item={item} />
        ))}
      </ul>
      {pageCount > 1 && (
        <nav className={styles.pagination} aria-label={t.explore.pages}>
          <Button size="sm" disabled={current === 1} onClick={() => setPage(current - 1)}>
            {t.explore.previous}
          </Button>
          <span aria-live="polite">{t.explore.page(current, pageCount)}</span>
          <Button size="sm" disabled={current === pageCount} onClick={() => setPage(current + 1)}>
            {t.explore.next}
          </Button>
        </nav>
      )}
    </section>
  );
}

export function ExplorePage(props: { readonly origin: string }) {
  const { t } = useI18n();
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>{t.explore.title}</h1>
      <p className={styles.lead}>{t.explore.lead}</p>
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
