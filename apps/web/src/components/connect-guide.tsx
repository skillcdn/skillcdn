import { type Address, formatAddress, type RestMount } from "@skillcdn/core";
import { useI18n } from "../i18n/index.js";
import { ClientIcon } from "./client-icon.js";
import { CodeBlock, CopyButton } from "./code-block.js";
import {
  CLIENT_DETAILS,
  CONNECT_CLIENTS,
  type ConnectClient,
  clientConfiguration,
  isTerminalClient,
} from "./connect-clients.js";
import styles from "./connect-guide.module.css";
import { ConnectWalkthrough } from "./connect-walkthrough.js";
import { Tabs } from "./tabs.js";
import { cx } from "./ui.js";
import ui from "./ui.module.css";

/**
 * A name an MCP client can show for the server: the name the repository gives itself in its
 * manifest, else the mounted directory, else the repository; as a slug, since clients use it as
 * a key.
 */
export function serverNameOf(address: Address, manifestName?: string | null): string {
  const last = address.path.split("/").at(-1);
  const base = manifestName ?? (last === undefined || last === "" ? address.repo : last);
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name.length === 0 ? "skills" : name;
}

/** What to call the server when talking to the agent: the manifest's name, else the repository. */
export function displayNameOf(address: Address, mount: RestMount | undefined): string {
  const manifest = mount?.index.status === "ready" ? mount.index.manifest : undefined;
  if (manifest?.name != null) {
    return manifest.name;
  }
  return mount === undefined
    ? `${address.owner}/${address.repo}`
    : `${mount.repository.owner}/${mount.repository.name}`;
}

/** A link that opens the client with the server filled in. */
export function cursorInstallLink(name: string, url: string): string {
  const config = btoa(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

export function vscodeInstallLink(name: string, url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url }))}`;
}

function ClientGuide({
  client,
  name,
  url,
}: {
  readonly client: ConnectClient;
  readonly name: string;
  readonly url: string;
}) {
  const { t, language } = useI18n();
  const c = t.connect.clients[client];
  const details = CLIENT_DETAILS[client];
  const terminal = isTerminalClient(client);
  const install =
    client === "cursor"
      ? cursorInstallLink(name, url)
      : client === "vscode"
        ? vscodeInstallLink(name, url)
        : undefined;
  const configuration = clientConfiguration(client, name, url);
  const addressCard = (
    <div className={styles.copyAddress}>
      <div className={styles.copyLabel}>
        <span className={styles.linkSymbol} aria-hidden="true">
          ↗
        </span>
        <div>
          <strong>{t.connect.copyTitle}</strong>
          <p>{t.connect.copyHint}</p>
        </div>
      </div>
      <div className={styles.copyField}>
        <code>{url}</code>
        <CopyButton text={url} label={t.connect.copyButton} variant="primary" size="md" />
      </div>
    </div>
  );
  return (
    <div className={styles.clientGuide}>
      {install === undefined && addressCard}
      <div className={styles.guideHeading}>
        <div>
          <h3>{t.connect.follow(c.label)}</h3>
          <p className={styles.hint}>{t.connect.guideHint}</p>
        </div>
        {(install !== undefined || details.web !== undefined) && (
          <a
            className={cx(
              ui.button,
              install === undefined ? ui.secondary : ui.primary,
              styles.openLink,
            )}
            href={install ?? details.web}
            target={install === undefined ? "_blank" : undefined}
            rel={install === undefined ? "noopener noreferrer" : undefined}
          >
            {install !== undefined ? t.connect.add(c.label) : t.connect.open(c.label)}
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      <ConnectWalkthrough key={`${client}-${language}`} client={client} name={name} url={url} />
      {terminal ? (
        <CodeBlock code={configuration} label={t.connect.preview.terminal} copy />
      ) : (
        (client === "cursor" || client === "vscode" || client === "windsurf") && (
          <details className={styles.manual} open={client === "windsurf"}>
            <summary>{t.connect.manual}</summary>
            {install !== undefined && addressCard}
            <CodeBlock code={configuration} copy />
            {client === "vscode" && (
              <CodeBlock
                code={`code --add-mcp '${JSON.stringify({ name, type: "http", url })}'`}
                label={t.connect.preview.terminal}
                copy
              />
            )}
          </details>
        )
      )}
      <div className={styles.support}>
        <p>{c.note}</p>
        <details>
          <summary>{t.connect.help}</summary>
          <p>{t.connect.helpBody}</p>
          <p>{t.connect.nameHint(name)}</p>
          {details.docs !== undefined && (
            <a href={details.docs} target="_blank" rel="noopener noreferrer">
              {t.connect.official}
              <span aria-hidden="true"> ↗</span>
            </a>
          )}
        </details>
      </div>
    </div>
  );
}

export function ConnectGuide({
  origin,
  address,
  mount,
}: {
  readonly origin: string;
  readonly address: Address;
  readonly mount: RestMount | undefined;
}) {
  const { t } = useI18n();
  const url = `${origin}${formatAddress(address)}`;
  const manifest = mount?.index.status === "ready" ? mount.index.manifest : undefined;
  const name = serverNameOf(address, manifest?.name);
  const message = t.connect.firstMessage.text(displayNameOf(address, mount));
  const tabs = CONNECT_CLIENTS.map((client) => ({
    id: client,
    label: t.connect.clients[client].label,
    icon: <ClientIcon client={client} />,
    content: <ClientGuide key={client} client={client} name={name} url={url} />,
  }));

  return (
    <section className={styles.guide} aria-labelledby="connect-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <span aria-hidden="true">✦</span>
          {t.connect.eyebrow}
        </p>
        <h2 id="connect-title">{t.connect.title}</h2>
        <p className={styles.lead}>{t.connect.lead}</p>
      </header>
      <div className={styles.choose}>
        <h3>{t.connect.choose}</h3>
        <p className={styles.hint}>{t.connect.pickHint}</p>
      </div>
      <Tabs label={t.connect.clientsLabel} tabs={tabs} variant="tiles" />
      <div className={styles.firstMessage}>
        <div className={styles.messageHeading}>
          <span className={styles.messageIcon} aria-hidden="true">
            ✧
          </span>
          <div>
            <h3>{t.connect.firstMessage.label}</h3>
            <p className={styles.hint}>{t.connect.firstMessage.hint}</p>
          </div>
        </div>
        <div className={styles.messageBubble}>
          <p>{message}</p>
          <CopyButton
            text={message}
            label={t.connect.firstMessage.copy}
            variant="secondary"
            size="md"
          />
        </div>
      </div>
    </section>
  );
}
