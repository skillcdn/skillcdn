import { type Address, formatAddress, type RestMount } from "@skillcdn/core";
import type { ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { CodeBlock, CopyButton } from "./code-block.js";
import styles from "./connect-guide.module.css";
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

function Steps(props: {
  readonly items: readonly { readonly text: string; readonly extra?: ReactNode }[];
}) {
  return (
    <ol className={styles.steps}>
      {props.items.map((item) => (
        // The list item keeps its marker. Inside, the words sit beside the picture of the screen
        // they describe, and anything to copy runs the full width under both.
        <li key={item.text} className={styles.step}>
          <div className={styles.stepMain}>
            <p className={styles.stepText}>{item.text}</p>
            <span className={styles.stepShot} aria-hidden="true" />
          </div>
          {item.extra}
        </li>
      ))}
    </ol>
  );
}

function InstallLink(props: { readonly href: string; readonly label: string }) {
  return (
    <p className={styles.actions}>
      <a className={cx(ui.button, ui.primary, styles.link)} href={props.href}>
        {props.label}
      </a>
    </p>
  );
}

/**
 * How to point an agent at this address: copy it, then the steps for each common client, and
 * what to say first. The server goes by the name the repository gives itself. The address is
 * shown once, in the step that copies it; a step that says "paste the address you copied" must
 * not print it again.
 */
export function ConnectGuide(props: {
  readonly origin: string;
  readonly address: Address;
  /** What the address serves, once known: the name comes from it. */
  readonly mount: RestMount | undefined;
}) {
  const { t } = useI18n();
  const { origin, address, mount } = props;
  const url = `${origin}${formatAddress(address)}`;
  const manifest = mount?.index.status === "ready" ? mount.index.manifest : undefined;
  const name = serverNameOf(address, manifest?.name);
  const displayName = displayNameOf(address, mount);
  const c = t.connect.clients;
  const config = (shape: Record<string, unknown>) => JSON.stringify(shape, null, 2);

  // Apps first, then the tools that run in a terminal: a visitor who is not a developer
  // should meet what they use before what they do not.
  const tabs = [
    {
      id: "chatgpt",
      label: c.chatgpt.label,
      content: (
        <Steps
          items={[
            { text: c.chatgpt.steps[0] },
            { text: c.chatgpt.steps[1] },
            { text: c.chatgpt.steps[2] },
          ]}
        />
      ),
    },
    {
      id: "claude",
      label: c.claude.label,
      content: (
        <Steps
          items={[
            { text: c.claude.steps[0] },
            { text: c.claude.steps[1] },
            { text: c.claude.steps[2] },
          ]}
        />
      ),
    },
    {
      id: "cursor",
      label: c.cursor.label,
      content: (
        <Steps
          items={[
            {
              text: c.cursor.steps[0],
              extra: (
                <>
                  <InstallLink
                    href={cursorInstallLink(name, url)}
                    label={t.connect.add(c.cursor.label)}
                  />
                  <CodeBlock code={config({ mcpServers: { [name]: { url } } })} copy />
                </>
              ),
            },
          ]}
        />
      ),
    },
    {
      id: "vscode",
      label: c.vscode.label,
      content: (
        <Steps
          items={[
            {
              text: c.vscode.steps[0],
              extra: (
                <>
                  <InstallLink
                    href={vscodeInstallLink(name, url)}
                    label={t.connect.add(c.vscode.label)}
                  />
                  <CodeBlock code={config({ servers: { [name]: { type: "http", url } } })} copy />
                </>
              ),
            },
            {
              text: c.vscode.steps[1],
              extra: (
                <CodeBlock
                  code={`code --add-mcp '${JSON.stringify({ name, type: "http", url })}'`}
                  copy
                />
              ),
            },
          ]}
        />
      ),
    },
    {
      id: "windsurf",
      label: c.windsurf.label,
      content: (
        <Steps
          items={[
            {
              text: c.windsurf.steps[0],
              extra: (
                <CodeBlock code={config({ mcpServers: { [name]: { serverUrl: url } } })} copy />
              ),
            },
          ]}
        />
      ),
    },
    {
      id: "claude-code",
      label: c.claudeCode.label,
      content: (
        <Steps
          items={[
            {
              text: c.claudeCode.steps[0],
              extra: <CodeBlock code={`claude mcp add --transport http ${name} ${url}`} copy />,
            },
            { text: c.claudeCode.steps[1] },
          ]}
        />
      ),
    },
    {
      id: "codex",
      label: c.codex.label,
      content: (
        <Steps
          items={[
            {
              text: c.codex.steps[0],
              extra: <CodeBlock code={`codex mcp add ${name} --url ${url}`} copy />,
            },
          ]}
        />
      ),
    },
    {
      id: "gemini",
      label: c.gemini.label,
      content: (
        <Steps
          items={[
            {
              text: c.gemini.steps[0],
              extra: <CodeBlock code={`gemini mcp add --transport http ${name} ${url}`} copy />,
            },
          ]}
        />
      ),
    },
    {
      id: "other",
      label: c.other.label,
      content: (
        <Steps
          items={[
            {
              text: c.other.steps[0],
              extra: (
                <CodeBlock code={config({ mcpServers: { [name]: { type: "http", url } } })} copy />
              ),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <section className={styles.guide} aria-labelledby="connect-title">
      <h2 id="connect-title" className={styles.title}>
        {t.connect.title}
      </h2>
      {/* Two things to do, in order. Someone who has never added an MCP server should get through
          the page without having to know what one is. */}
      <ol className={styles.phases}>
        <li className={styles.phase}>
          <p className={styles.phaseHead}>
            <span className={styles.phaseNumber} aria-hidden="true">
              1
            </span>
            <span className={styles.phaseTitle}>{t.connect.phases.copy}</span>
          </p>
          {/* One button, because copying is the only thing to do here. The address itself stays in
              the page as text and shows when the button is pointed at or focused. */}
          <p className={styles.copyAddress}>
            <CopyButton text={url} label={t.connect.copyButton} variant="primary" size="md" />
            <span className={styles.address}>{url}</span>
          </p>
        </li>
        <li className={styles.phase}>
          <p className={styles.phaseHead}>
            <span className={styles.phaseNumber} aria-hidden="true">
              2
            </span>
            <span className={styles.phaseTitle}>{t.connect.phases.pick}</span>
          </p>
          <p className={styles.hint}>{t.connect.pickHint}</p>
          <Tabs label={t.connect.clientsLabel} tabs={tabs} variant="tiles" />
        </li>
      </ol>
      <p className={styles.hint}>
        {manifest?.name != null ? t.connect.nameFromManifest(name) : t.connect.nameHint(name)}
      </p>
      <CodeBlock
        label={t.connect.firstMessage.label}
        code={t.connect.firstMessage.text(displayName)}
        copy
      />
      <p className={styles.hint}>{t.connect.firstMessage.hint}</p>
    </section>
  );
}
