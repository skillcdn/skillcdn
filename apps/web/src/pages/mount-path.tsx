import type { Address } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { Link } from "../navigation.js";
import { mountHref } from "../router.js";
import styles from "./mount.module.css";

export function parentDirectory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** File identities are repository paths even when the connection begins in a subdirectory. */
export function contentHref(address: Address, path: string): string {
  return mountHref(
    address,
    path === "SKILL.md" || path.endsWith("/SKILL.md")
      ? { kind: "skill", path }
      : { kind: "file", path },
  );
}

export function MountPath(props: { readonly address: Address; readonly path: string }) {
  const { t } = useI18n();
  const { address, path } = props;
  const base = address.path;
  const relative =
    path === base
      ? ""
      : base === ""
        ? path
        : path.startsWith(`${base}/`)
          ? path.slice(base.length + 1)
          : "";
  const segments = relative === "" ? [] : relative.split("/");
  const crumbs = [
    { path: base, label: base === "" ? t.mount.browse.root : base },
    ...segments.map((segment, index) => ({
      path: [base, ...segments.slice(0, index + 1)].filter(Boolean).join("/"),
      label: segment,
    })),
  ];
  return (
    <nav aria-label={t.mount.browse.breadcrumb}>
      <ol className={styles.breadcrumbs}>
        {crumbs.map((crumb, index) => (
          <li key={crumb.path}>
            {index > 0 && (
              <span aria-hidden="true" className={styles.separator}>
                /
              </span>
            )}
            <Link
              href={mountHref(address, { kind: "overview", path: crumb.path, query: undefined })}
              aria-current={index === crumbs.length - 1 ? "page" : undefined}
            >
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
