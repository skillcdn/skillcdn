import {
  HUB_MAX_LIMIT,
  parseAddress,
  type RestFindSection,
  type RestHubItem,
  type RestHubPack,
  type RestSearch,
} from "@skillcdn/core";
import { useEffect, useState } from "react";
import { track } from "../analytics.js";
import { api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { AddressForm } from "../components/address-form.js";
import { ErrorCallout } from "../components/error-callout.js";
import glass from "../components/glass.module.css";
import { SearchForm } from "../components/search-form.js";
import {
  Avatar,
  Button,
  Container,
  cx,
  EmptyState,
  Skeleton,
  VerifiedMark,
} from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { skillDescription, skillTitle } from "../i18n/repository-text.js";
import { Link } from "../navigation.js";
import { mountHref, searchHref } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./search.module.css";

export interface SearchPageProps {
  readonly origin: string;
  /** The term, as the URL names it; none for the page of the box alone. */
  readonly term: string | undefined;
}

type Filter = "all" | "skill" | "document";

/** The pill of a pack, saying what kind of pack it is; a pack an older deployment says nothing of is a repository. */
function PackKind(props: { readonly pack: RestHubPack | undefined }) {
  const { t } = useI18n();
  const kind = props.pack?.kind ?? "repository";
  return <span className={cx(styles.packKind, styles[`kind-${kind}`])}>{t.packKinds[kind]}</span>;
}

/** The pack a result is in: its name, what it is, whether it is vouched for, and where in it the result is. */
function PackLine(props: { readonly item: RestHubItem; readonly path: string }) {
  const { t } = useI18n();
  const { item } = props;
  const avatar = item.pack?.avatar ?? "";
  return (
    <p className={styles.packLine}>
      {avatar !== "" && <Avatar src={avatar} size="sm" />}
      <span className={styles.packName}>{item.repository}</span>
      <PackKind pack={item.pack} />
      {item.pack?.verified === true && (
        <VerifiedMark label={t.search.verified} hint={t.mount.verifiedHint} />
      )}
      <span className={styles.path}>{props.path}</span>
    </p>
  );
}

/**
 * One result (ADR-0075): a skill, with its name and what it does, or a document, with the
 * section that matched and a glimpse of it; under each, the pack it is in, and the ways on: into
 * the result, into the pack, and to a search within that pack alone.
 */
function Result(props: { readonly found: RestHubItem; readonly term: string }) {
  const { t, language } = useI18n();
  const { found, term } = props;
  const address = parseAddress(found.address);
  if (!address.ok) {
    return null;
  }
  // A pack an older deployment says nothing of is a repository, as its pill says.
  const repository = (found.pack?.kind ?? "repository") === "repository";
  const onOpen = (kind: "skill" | "document" | "section" | "pack") =>
    track("search_result_click", { kind, pack: found.pack?.kind ?? "repository" });
  /** The ways on: into the result first, then into the pack, then a search within the pack alone. */
  const ways = (first: {
    readonly href: string;
    readonly label: string;
    readonly kind: "skill" | "document" | "section";
  }) => (
    <p className={styles.ways}>
      <Link href={first.href} className={styles.first} onClick={() => onOpen(first.kind)}>
        {first.label}
      </Link>
      <Link href={mountHref(address.value)} onClick={() => onOpen("pack")}>
        {repository ? t.search.actions.repository : t.search.actions.pack}
      </Link>
      <Link href={mountHref(address.value, { kind: "overview", query: term })}>
        {repository ? t.search.actions.moreRepository : t.search.actions.more}
      </Link>
    </p>
  );
  if (found.item.kind === "skill") {
    const skill = found.item;
    const path = skill.path ?? `${skill.directory}/SKILL.md`;
    const href = mountHref(address.value, { kind: "skill", path });
    return (
      <li className={cx(styles.result, glass.reveal)}>
        <span className={cx(styles.mark, styles.markSkill)} aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
          </svg>
        </span>
        <div className={styles.body}>
          <p className={styles.kindLine}>
            <span className={styles.kindSkill}>{t.search.kinds.skill}</span>
            <span className={styles.area}>{skill.directory}</span>
          </p>
          <h2 className={styles.resultTitle}>
            <Link href={href} onClick={() => onOpen("skill")}>
              {skillTitle(skill, language)}
            </Link>
          </h2>
          <p className={styles.description}>{skillDescription(skill, language)}</p>
          <PackLine item={found} path={path} />
          {ways({ href, label: t.search.actions.skill, kind: "skill" })}
        </div>
      </li>
    );
  }
  const document = found.item;
  const sections: readonly RestFindSection[] = document.sections ?? [];
  const best = sections[0];
  const href =
    best === undefined
      ? mountHref(address.value, { kind: "file", path: document.path })
      : mountHref(address.value, { kind: "file", path: document.path, section: best.offset });
  return (
    <li className={cx(styles.result, glass.reveal)}>
      <span className={cx(styles.mark, styles.markDocument)} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h8" />
        </svg>
      </span>
      <div className={styles.body}>
        <p className={styles.kindLine}>
          <span className={styles.kindDocument}>{t.search.kinds.document}</span>
          {document.skillDirectory !== null && (
            <span className={styles.area}>{t.search.partOf(document.skillDirectory)}</span>
          )}
        </p>
        <h2 className={styles.resultTitle}>
          <Link href={href} onClick={() => onOpen(best === undefined ? "document" : "section")}>
            {document.title ?? document.path.split("/").at(-1) ?? document.path}
          </Link>
        </h2>
        {best === undefined ? (
          document.summary !== null && <p className={styles.description}>{document.summary}</p>
        ) : (
          <div className={styles.section}>
            <b>
              {best.heading.length === 0 ? t.mount.search.sectionStart : best.heading.join(" › ")}
            </b>
            {best.excerpt !== null && <span>{best.excerpt}</span>}
          </div>
        )}
        <PackLine item={found} path={document.path} />
        {ways(
          best === undefined
            ? { href, label: t.search.actions.document, kind: "document" }
            : { href, label: t.search.actions.section, kind: "section" },
        )}
      </div>
    </li>
  );
}

function Results(props: { readonly term: string; readonly origin: string }) {
  const { t } = useI18n();
  const { term } = props;
  const found = useResource(resourceKeys.search(term), (signal) =>
    api.search(term, HUB_MAX_LIMIT, signal),
  );
  const [filter, setFilter] = useState<Filter>("all");
  if (found.state === "loading") {
    return <Skeleton lines={6} label={t.common.loading} />;
  }
  if (found.state === "error") {
    return <ErrorCallout error={found.error} onRetry={found.reload} />;
  }
  const results: RestSearch = found.value;
  const counts = {
    all: results.items.length,
    skill: results.items.filter((item) => item.item.kind === "skill").length,
    document: results.items.filter((item) => item.item.kind === "document").length,
  };
  const shown = results.items.filter((item) => filter === "all" || item.item.kind === filter);
  return (
    <>
      <p className={styles.facts}>
        <span>{t.search.found(results.items.length, results.packs)}</span>
        {results.ranking !== undefined && (
          <span>{results.ranking.meaning ? t.search.ranking.meaning : t.search.ranking.words}</span>
        )}
      </p>
      {results.items.length > 0 && (
        <fieldset className={styles.filters}>
          <legend className="visually-hidden">{t.search.filters.all}</legend>
          {(["all", "skill", "document"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={filter === kind ? "primary" : "ghost"}
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {t.search.filters[kind]}
              <span className={styles.filterCount}>{counts[kind]}</span>
            </Button>
          ))}
        </fieldset>
      )}
      {shown.length === 0 ? (
        <EmptyState title={t.search.none} />
      ) : (
        <ol className={styles.results}>
          {shown.map((item) => (
            <Result
              key={`${item.address} ${item.item.kind} ${item.item.kind === "skill" ? item.item.directory : item.item.path}`}
              found={item}
              term={term}
            />
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * The page of a search across the packs (ADR-0075): the box with the term, the results under it,
 * each in the pack it comes from, and beside them the address field and terms to try. Without
 * a term it is the page of the box alone.
 */
export function SearchPage(props: SearchPageProps) {
  const { t, language } = useI18n();
  const { term } = props;
  // The head says what the page found, once it has: the same head the server writes.
  const found = useResource(
    term === undefined ? "search none" : resourceKeys.search(term),
    (signal) =>
      term === undefined ? Promise.resolve(undefined) : api.search(term, HUB_MAX_LIMIT, signal),
  );
  const results = found.state === "ready" ? found.value : undefined;
  useEffect(() => {
    applyHead(buildHead({ name: "search", term }, language, props.origin, { search: results }));
  }, [language, props.origin, term, results]);

  return (
    <div className={styles.page}>
      <section className={styles.top}>
        <Container>
          {term === undefined && (
            <div className={styles.bare}>
              <h1>{t.search.bare.title}</h1>
              <p>{t.search.bare.lead}</p>
            </div>
          )}
          <SearchForm
            className={styles.form}
            initialValue={term}
            large={term === undefined}
            from="results"
            chips={term === undefined ? t.landing.search.chips : undefined}
          />
          {term !== undefined && <h1 className={styles.heading}>{t.search.heading(term)}</h1>}
        </Container>
      </section>
      <Container className={cx(styles.layout, term === undefined && styles.layoutBare)}>
        {term !== undefined && (
          <div className={styles.main}>
            <Results term={term} origin={props.origin} />
          </div>
        )}
        <aside className={styles.aside}>
          <div className={cx(glass.pane, styles.box)}>
            <h2>{t.search.aside.address.title}</h2>
            <p>{t.search.aside.address.body}</p>
            <AddressForm origin={props.origin} />
          </div>
          <div className={cx(glass.pane, styles.box)}>
            <h2>{t.search.aside.suggestions}</h2>
            <ul className={styles.suggestions}>
              {t.search.suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <Link href={searchHref(suggestion)}>{suggestion}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className={cx(glass.pane, styles.box)}>
            <h2>{t.packKinds.legend.title}</h2>
            <dl className={styles.legend}>
              {(["skills", "documents", "repository"] as const).map((kind) => (
                <div key={kind}>
                  <dt>
                    <span className={cx(styles.packKind, styles[`kind-${kind}`])}>
                      {t.packKinds[kind]}
                    </span>
                  </dt>
                  <dd>{t.packKinds.legend[kind]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </Container>
    </div>
  );
}
