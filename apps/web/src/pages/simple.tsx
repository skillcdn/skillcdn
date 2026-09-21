import type { AddressError } from "@skillcdn/core";
import { AddressForm } from "../components/address-form.js";
import { Callout, Container } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import styles from "./simple.module.css";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Container className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>{t.notFound.title}</h1>
      <p className={styles.body}>{t.notFound.body}</p>
      <p>
        <Link href={PATHS.landing}>{t.notFound.home}</Link>
      </p>
    </Container>
  );
}

/** A URL under /gh/ that is not an address: say which rule it breaks, and offer the form again. */
export function BadAddressPage(props: { readonly origin: string; readonly error: AddressError }) {
  const { t } = useI18n();
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>{t.address.invalid}</h1>
      <Callout tone="danger">{t.address.errors[props.error.code]}</Callout>
      <div className={styles.form}>
        <AddressForm origin={props.origin} examples />
      </div>
    </Container>
  );
}
