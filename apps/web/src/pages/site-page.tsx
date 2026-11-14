import { useEffect, useMemo, useState } from "react";
import { restClient } from "../api/client.js";
import { Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { navigate, useLocation } from "../navigation.js";
import type { SiteNavigation, SitePage } from "../site-pages.js";
import styles from "./site-page.module.css";

const NAVIGATION: SiteNavigation = {
  go: (href) => navigate(href),
  replace: (href) => navigate(href, { replace: true }),
};

/**
 * A page of an installation's own (ADR-0099), given what the pages of the product are given. It
 * is drawn once the frame is up in the browser, and never before: where the pages are rendered
 * to HTML, and on the browser's first render, which must agree with it, there is the
 * placeholder every page has while it loads. So nothing of an installation's page runs in the
 * server, and nothing of it is there for a search engine to read.
 */
export function SitePageView(props: { readonly page: SitePage; readonly origin: string }) {
  const { language, t } = useI18n();
  const location = useLocation();
  const [up, setUp] = useState(false);
  useEffect(() => {
    setUp(true);
  }, []);
  const context = useMemo(
    () => ({
      client: restClient,
      language,
      words: t,
      origin: props.origin,
      search: location.search,
      navigation: NAVIGATION,
    }),
    [language, t, props.origin, location.search],
  );
  if (!up) {
    return (
      <Container>
        <div className={styles.placeholder}>
          <Skeleton lines={6} label={t.common.loading} />
        </div>
      </Container>
    );
  }
  return <>{props.page.render(context)}</>;
}
