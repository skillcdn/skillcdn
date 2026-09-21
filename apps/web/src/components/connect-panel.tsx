import { type Address, formatAddress } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { CodeBlock } from "./code-block.js";
import styles from "./connect-panel.module.css";
import { Tabs } from "./tabs.js";

/** A name an MCP client can show for the server: the mounted directory, else the repository. */
export function serverNameOf(address: Address): string {
  const last = address.path.split("/").at(-1);
  const base = last === undefined || last === "" ? address.repo : last;
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name.length === 0 ? "skills" : name;
}

/** Everything needed to point an agent at an address: the URL and two ways to add it. */
export function ConnectPanel(props: { readonly origin: string; readonly address: Address }) {
  const { t } = useI18n();
  const url = `${props.origin}${formatAddress(props.address)}`;
  const name = serverNameOf(props.address);
  const config = JSON.stringify({ mcpServers: { [name]: { type: "http", url } } }, null, 2);

  return (
    <section className={styles.panel} aria-labelledby="connect-title">
      <div>
        <h2 id="connect-title" className={styles.title}>
          {t.connect.title}
        </h2>
        <p className={styles.lead}>{t.connect.lead}</p>
      </div>
      <CodeBlock label={t.connect.endpoint} code={url} copy wrap />
      <Tabs
        label={t.connect.title}
        tabs={[
          {
            id: "claude-code",
            label: t.connect.claudeCode,
            content: (
              <CodeBlock code={`claude mcp add --transport http ${name} ${url}`} copy wrap />
            ),
          },
          {
            id: "json",
            label: t.connect.json,
            content: (
              <div className={styles.stack}>
                <CodeBlock code={config} copy />
                <p className={styles.hint}>{t.connect.jsonHint}</p>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
