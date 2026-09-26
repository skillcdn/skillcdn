import type { LegalDocumentKind } from "@skillcdn/core";
import { useEffect } from "react";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { Markdown } from "../components/markdown.js";
import { Callout, Container, Skeleton } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { legalTexts } from "../legal.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./legal.module.css";
import { NotFoundPage } from "./simple.js";

export interface LegalPageProps {
  readonly origin: string;
  readonly kind: LegalDocumentKind;
}

/**
 * A page of the deployment's own (ADR-0029): its terms of service or its privacy policy, as the
 * operator wrote it, in the visitor's language when it was written in it. A page that has not
 * been written is not there.
 */
export function LegalPage(props: LegalPageProps) {
  const { t, language } = useI18n();
  const { kind, origin } = props;
  const document = useResource(resourceKeys.legal(kind), (signal) => api.legal(kind, signal));
  const loaded = document.state === "ready" ? document.value : undefined;

  // The head says what this page is, once it knows: the same head the server writes.
  useEffect(() => {
    applyHead(buildHead({ name: "legal", kind }, language, origin, { legal: loaded }));
  }, [kind, language, origin, loaded]);

  if (document.state === "loading") {
    return (
      <Container className={styles.page}>
        <Skeleton lines={8} label={t.common.loading} />
      </Container>
    );
  }
  if (document.state === "error") {
    return document.error.status === 404 ? (
      <NotFoundPage />
    ) : (
      <Container className={styles.page}>
        <Callout tone="danger">{t.errors.generic}</Callout>
      </Container>
    );
  }
  const words = legalTexts(document.value, language);
  if (words === undefined) {
    return <NotFoundPage />;
  }
  return (
    <Container className={styles.page}>
      <article className={styles.article}>
        <h1 className={styles.title}>{words.title}</h1>
        {document.value.revised !== null && (
          <p className={styles.revised}>{t.legal.revised(document.value.revised)}</p>
        )}
        <Markdown source={words.body} baseDirectory="" fileHref={(path) => `/${path}`} />
      </article>
    </Container>
  );
}
