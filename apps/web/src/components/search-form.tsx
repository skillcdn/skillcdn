import { normalizeSearchTerm } from "@skillcdn/core";
import { type FormEvent, useId, useState } from "react";
import { track } from "../analytics.js";
import { useI18n } from "../i18n/index.js";
import { appHref, navigate } from "../navigation.js";
import { searchHref } from "../router.js";
import styles from "./search-form.module.css";
import { cx, SearchIcon } from "./ui.js";

/**
 * The search box (ADR-0075): one field and one button, which lead to the page of the term. The
 * form has a real action, so that it works without a script, where the server turns the query
 * into the page of the term; with one, the page is navigated to at once. The chips under it are
 * terms to try, each a link to its page.
 */
export function SearchForm(props: {
  readonly initialValue?: string | undefined;
  /** The box as the first thing on the page: taller and lit. */
  readonly large?: boolean;
  readonly placeholder?: string;
  readonly chips?: readonly string[];
  readonly className?: string;
  /** Where the submit is counted from (`hero`, `explore`, `results`). */
  readonly from: string;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const [value, setValue] = useState(props.initialValue ?? "");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const term = normalizeSearchTerm(value);
    // The term is never sent anywhere but to the page of it (ADR-0050).
    track("search_submit", { from: props.from, empty: term === "" });
    navigate(appHref(searchHref(term)));
  };

  return (
    <div className={cx(styles.wrapper, props.className)}>
      <form
        className={cx(styles.form, props.large === true && styles.large)}
        action={searchHref()}
        method="get"
        onSubmit={onSubmit}
      >
        <label className="visually-hidden" htmlFor={inputId}>
          {t.search.label}
        </label>
        <span className={styles.mark} aria-hidden="true">
          <SearchIcon size={props.large === true ? 22 : 18} />
        </span>
        <input
          id={inputId}
          className={styles.input}
          type="search"
          name="q"
          autoComplete="off"
          placeholder={props.placeholder ?? t.search.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className={styles.submit}>
          {t.search.submit}
        </button>
      </form>
      {props.chips !== undefined && props.chips.length > 0 && (
        <ul className={styles.chips}>
          {props.chips.map((chip) => (
            <li key={chip}>
              <a
                className={styles.chip}
                href={appHref(searchHref(chip))}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    track("search_submit", { from: `${props.from}_chip`, empty: false });
                    navigate(appHref(searchHref(chip)));
                  }
                }}
              >
                {chip}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
