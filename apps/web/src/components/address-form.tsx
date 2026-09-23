import type { AddressErrorCode } from "@skillcdn/core";
import { type FormEvent, useId, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { appHref, Link, navigate } from "../navigation.js";
import { addressFromInput, mountHref } from "../router.js";
import { EXAMPLE_ADDRESSES, hostOf } from "../site.js";
import styles from "./address-form.module.css";
import { Button, cx } from "./ui.js";

/** Open a known repository directly and see what it serves. */
export function AddressForm(props: {
  readonly origin: string;
  readonly initialValue?: string;
  readonly label?: string;
  readonly large?: boolean;
  /** The small line under the field: what else may be typed, and addresses to try. */
  readonly footnote?: boolean;
}) {
  const { t } = useI18n();
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();
  const [value, setValue] = useState(props.initialValue ?? "");
  const [errorCode, setErrorCode] = useState<AddressErrorCode>();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = addressFromInput(value);
    if (!parsed.ok) {
      setErrorCode(parsed.error.code);
      return;
    }
    setErrorCode(undefined);
    navigate(appHref(mountHref(parsed.value)));
  };

  return (
    <div className={styles.wrapper}>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <label
          className={
            props.label === undefined
              ? "visually-hidden"
              : cx(styles.label, props.large === true && styles.largeLabel)
          }
          htmlFor={inputId}
        >
          {props.label ?? t.address.label}
        </label>
        <div
          className={cx(
            styles.row,
            props.large === true && styles.large,
            errorCode !== undefined && styles.invalid,
          )}
        >
          <div className={styles.field}>
            <span className={styles.prefix} aria-hidden="true">
              {`${hostOf(props.origin)}/gh/`}
            </span>
            <input
              id={inputId}
              className={styles.input}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t.address.placeholder}
              value={value}
              aria-invalid={errorCode !== undefined}
              aria-describedby={errorCode === undefined ? hintId : errorId}
              onChange={(event) => {
                setValue(event.target.value);
                setErrorCode(undefined);
              }}
            />
          </div>
          <Button type="submit" variant="primary" className={styles.submit}>
            {t.address.submit}
          </Button>
        </div>
        {props.footnote === true || errorCode !== undefined ? (
          <div className={styles.footnote}>
            {errorCode === undefined ? (
              <p id={hintId} className={styles.hint}>
                {t.address.hint}
              </p>
            ) : (
              <p id={errorId} className={styles.error} role="alert">
                {t.address.invalid} {t.address.errors[errorCode]}
              </p>
            )}
            {props.footnote === true && (
              <div className={styles.examples}>
                <span className={styles.examplesLabel}>{t.address.examples}</span>
                <ul className={styles.exampleList}>
                  {EXAMPLE_ADDRESSES.map((example) => (
                    <li key={example}>
                      <Link className={styles.example} href={`/gh/${example}`}>
                        {example}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          // Nothing to read here, but the field still describes itself to a screen reader.
          <p id={hintId} className="visually-hidden">
            {t.address.hint}
          </p>
        )}
      </form>
    </div>
  );
}
