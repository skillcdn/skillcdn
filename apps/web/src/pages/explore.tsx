import { formatAddress, parseAddress } from "@skillcdn/core";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useResource } from "../api/use-resource.js";
import { AuthorsInvite } from "../components/authors-invite.js";
import { RepositoryGrid } from "../components/repository-card.js";
import { Button, Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import styles from "./explore.module.css";

/** Cards per page. The list is the operator's and arrives whole; the page keeps it readable. */
const PAGE_SIZE = 12;

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
    if (page > 1) top.current?.scrollIntoView({ block: "start", behavior: "instant" });
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
      <RepositoryGrid items={shown} />
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
      <AuthorsInvite origin={props.origin} className={styles.invite} footnote />
    </Container>
  );
}
