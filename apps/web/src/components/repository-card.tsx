import type { RestRepositoryCard } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { repositoryDescription, repositoryName } from "../i18n/repository-text.js";
import { Link } from "../navigation.js";
import styles from "./repository-card.module.css";
import { Avatar, Badge, Picture, VerifiedMark } from "./ui.js";

/**
 * One repository on a card: its picture when it has one, its owner's, the name it gives itself,
 * else its address; what it is, from its manifest or from what the host says about it; and the
 * first of its skills by name. What the explorer features and what the page of an account leads
 * with are both lists of these.
 */
export function RepositoryCard(props: { readonly item: RestRepositoryCard }) {
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
      {item.image !== null && <Picture className={styles.cardArt} src={item.image} />}
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <Avatar src={item.repository.avatar} />
          <div className={styles.cardTitles}>
            <h3 className={styles.cardTitle}>
              <Link className={styles.cardLink} href={item.address}>
                {name}
              </Link>
              {item.verified && (
                <>
                  {" "}
                  <VerifiedMark label={t.mount.verified} hint={t.mount.verifiedHint} />
                </>
              )}
            </h3>
            {address.toLowerCase() !== name.toLowerCase() && (
              <p className={styles.cardAddress}>{address}</p>
            )}
          </div>
        </div>
        {description !== null && description !== "" && (
          <p className={styles.cardText}>{description}</p>
        )}
        <p className={styles.cardMeta}>
          {/* The point is for something to look at; a count of nothing is not that. */}
          {item.status === "ready" && item.skillCount !== null && (
            <Badge tone={item.skillCount > 0 ? "point" : "neutral"}>
              {t.explore.featuredSkills(item.skillCount)}
            </Badge>
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
      </div>
    </li>
  );
}

/** Cards of unequal height in as many columns as fit. */
export function RepositoryGrid(props: { readonly items: readonly RestRepositoryCard[] }) {
  return (
    <ul className={styles.grid}>
      {props.items.map((item) => (
        <RepositoryCard key={item.address} item={item} />
      ))}
    </ul>
  );
}
