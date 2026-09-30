import { type Address, compactSummary, formatAddress, type RestMount } from "@skillcdn/core";
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

/** How much of a description an app's form is given: a sentence or two, as such a field holds. */
const DESCRIPTION_LENGTH = 160;

/** A link that opens the client with the server filled in. */
export function cursorInstallLink(name: string, url: string): string {
  const config = btoa(JSON.stringify({ url }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

export function vscodeInstallLink(name: string, url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url }))}`;
}

/**
 * Claude's add-connector dialog with the name and the address filled in, which Claude marks as
 * having come from a link and asks the person to confirm (the format its connector docs give).
 */
export function claudeInstallLink(name: string, url: string): string {
  const query = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: name,
    connectorUrl: url,
  });
  return `https://claude.ai/customize/connectors?${query}`;
}

function ClientGuide({
  client,
  name,
  url,
  description,
}: {
  readonly client: ConnectClient;
  readonly name: string;
  readonly url: string;
  readonly description: string;
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
        : client === "claude"
          ? claudeInstallLink(name, url)
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
  // A client that takes a link with the server filled in leads with that link, where the
  // address would otherwise be: the one step that does most of the work comes first, and the
  // address waits under manual setup for whoever needs it.
  const installCard = install !== undefined && (
    <div className={styles.installCard}>
      <div className={styles.copyLabel}>
        <span className={styles.linkSymbol} aria-hidden="true">
          ↗
        </span>
        <div>
          <strong>{t.connect.installTitle(c.label)}</strong>
          <p>{t.connect.installHint}</p>
        </div>
      </div>
      <a className={cx(ui.button, ui.primary, styles.openLink)} href={install}>
        {t.connect.add(c.label)}
        <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
  return (
    <div className={styles.clientGuide}>
      {install === undefined ? addressCard : installCard}
      <div className={styles.guideHeading}>
        <div>
          <h3>{t.connect.follow(c.label)}</h3>
          <p className={styles.hint}>{t.connect.guideHint}</p>
        </div>
        {install === undefined && details.web !== undefined && (
          <a
            className={cx(ui.button, ui.secondary, styles.openLink)}
            href={details.web}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.connect.open(c.label)}
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      <ConnectWalkthrough
        key={`${client}-${language}`}
        client={client}
        name={name}
        url={url}
        description={description}
      />
      {terminal ? (
        <CodeBlock code={configuration} label={t.connect.preview.terminal} copy />
      ) : (
        install !== undefined && (
          <details className={styles.manual}>
            <summary>{t.connect.manual}</summary>
            {addressCard}
            {client !== "claude" && <CodeBlock code={configuration} copy />}
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
  // What an app that asks for a description is told: the repository's own words, shortened to
  // what such a field holds, so that an agent choosing among servers knows what this one is for.
  const repository =
    mount === undefined
      ? `${address.owner}/${address.repo}`
      : `${mount.repository.owner}/${mount.repository.name}`;
  const description = compactSummary(
    manifest?.description ?? mount?.repository.description ?? t.connect.describes(repository),
    DESCRIPTION_LENGTH,
  );
  // The message names the server as the steps told the visitor to name it, so that an agent with
  // other servers and skills connected is asked about this one and not about everything it has.
  const message = t.connect.firstMessage.text(name);
  const tabs = CONNECT_CLIENTS.map((client) => ({
    id: client,
    label: t.connect.clients[client].label,
    icon: <ClientIcon client={client} />,
    content: (
      <ClientGuide key={client} client={client} name={name} url={url} description={description} />
    ),
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
