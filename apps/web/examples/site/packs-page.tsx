import type { SitePageContext } from "@skillcdn/web";
import { useEffect, useState } from "react";
import styles from "./packs-page.module.css";

// The page of the example configuration: the repositories the deployment leads with, read from
// its REST API as any page of the product reads them, each a link the pages follow in place.
// What it says, it says in its own words, by language; what it looks like, it takes from the
// tokens of the pages (`var(--...)`), so that it reads as one of them.

const WORDS: Readonly<
  Record<string, { title: string; lead: string; none: string; failed: string }>
> = {
  en: {
    title: "Packs of this installation",
    lead: "What this deployment serves first, as its REST API lists it.",
    none: "Nothing is listed yet.",
    failed: "The list could not be read.",
  },
  ko: {
    title: "이 설치의 팩",
    lead: "이 배포가 먼저 내보이는 것을 REST API가 답하는 대로 보여 줍니다.",
    none: "아직 목록에 아무것도 없습니다.",
    failed: "목록을 읽지 못했습니다.",
  },
};

type Listed =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly addresses: readonly string[] };

export function PacksPage(props: SitePageContext) {
  const words = WORDS[props.language] ?? WORDS.en;
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const { client } = props;
  useEffect(() => {
    const stop = new AbortController();
    client.featured(stop.signal).then(
      (featured) =>
        setListed({ status: "ready", addresses: featured.items.map((item) => item.address) }),
      () => {
        if (!stop.signal.aborted) {
          setListed({ status: "failed" });
        }
      },
    );
    return () => stop.abort();
  }, [client]);
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>{words?.title}</h1>
      <p className={styles.lead}>{words?.lead}</p>
      {listed.status === "loading" ? (
        <p className={styles.note}>{props.words.common.loading}</p>
      ) : listed.status === "failed" ? (
        <p className={styles.note}>{words?.failed}</p>
      ) : listed.addresses.length === 0 ? (
        <p className={styles.note}>{words?.none}</p>
      ) : (
        <ul className={styles.list}>
          {listed.addresses.map((address) => (
            <li key={address}>
              <a
                href={address}
                onClick={(event) => {
                  event.preventDefault();
                  props.navigation.go(address);
                }}
              >
                {`${props.origin}${address}`}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
