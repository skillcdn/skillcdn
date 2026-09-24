import type { ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { ClientIcon } from "./client-icon.js";
import { DemoPointer, PreviewTime, previewPhase, usePreviewLoop } from "./connect-animation.js";
import { type ConnectClient, clientConfiguration, isTerminalClient } from "./connect-clients.js";
import styles from "./connect-preview.module.css";
import { PreviewCopy } from "./connect-preview-copy.js";

function Highlight({
  children,
  action = false,
  pointer = true,
}: {
  readonly children: ReactNode;
  readonly action?: boolean;
  readonly pointer?: boolean;
}) {
  return (
    <span className={styles.highlight} data-action={action}>
      {children}
      {pointer && <DemoPointer action={action} />}
    </span>
  );
}

function Toggle() {
  return (
    <span className={styles.toggle}>
      <DemoPointer />
    </span>
  );
}

function Field({
  label,
  value,
  highlight = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly highlight?: boolean;
}) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <div className={styles.fieldControl}>
        <PreviewCopy text={value} appearance={highlight ? "url" : "field"} animated={highlight} />
      </div>
    </div>
  );
}

/** App controls are decorative; meaningful text can be selected and copied. */
export function ConnectPreview({
  client,
  step,
  name,
  url,
}: {
  readonly client: ConnectClient;
  readonly step: number;
  readonly name: string;
  readonly url: string;
}) {
  const { t } = useI18n();
  const p = t.connect.preview;
  const label = t.connect.clients[client].label;
  const terminal = isTerminalClient(client);
  const editor = client === "cursor" || client === "vscode" || client === "windsurf";
  const typing = terminal || step === 2 || (step === 1 && (!editor || client === "windsurf"));
  const { root, time } = usePreviewLoop(typing);
  const file =
    client === "vscode"
      ? ".vscode/mcp.json"
      : client === "windsurf"
        ? "mcp_config.json"
        : ".cursor/mcp.json";
  const code = clientConfiguration(client, name, url);

  const chat = (
    <div className={styles.chat}>
      <div className={styles.chatTitle}>
        <ClientIcon client={client} />
        <strong>
          {client === "chatgpt"
            ? p.work
            : client === "windsurf"
              ? p.cascade
              : editor
                ? client === "vscode"
                  ? p.vscodeAgent
                  : p.agent
                : p.newChat}
        </strong>
      </div>
      <div className={styles.chatMenu}>
        <span>
          {client === "chatgpt" ? p.plugins : client === "claude" ? p.connectors : p.tools}
        </span>
        <Highlight pointer={false}>
          <span>{name}</span>
          <Toggle />
        </Highlight>
      </div>
      <div className={styles.composer}>
        <span className={styles.chip}>{client === "chatgpt" ? `@${name}` : `+ ${name}`}</span>
        <div className={styles.composerText}>
          <PreviewCopy text={p.ask} appearance="text" />
        </div>
        <div className={styles.composerBar}>
          <span className={styles.attach}>+</span>
          <span className={styles.send}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
            <DemoPointer action />
          </span>
        </div>
      </div>
      <div className={styles.sentMessage} aria-hidden="true">
        {p.ask}
      </div>
    </div>
  );

  const form = (
    <div className={styles.dialog}>
      <div className={styles.dialogTitle}>
        <strong>
          {client === "chatgpt" ? p.createPlugin : client === "claude" ? p.addConnector : p.remote}
        </strong>
        <span>×</span>
      </div>
      <Field label={p.name} value={name} />
      {client === "chatgpt" && <Field label={p.description} value={p.descriptionValue} />}
      <Field label={p.url} value={url} highlight />
      {client !== "claude" && (
        <div className={styles.formRow}>
          <span>{p.authentication}</span>
          <span className={styles.selectValue}>
            {p.none}
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4 6 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      )}
      <div className={styles.formActions}>
        <Highlight action>{client === "chatgpt" ? p.createPlugin : p.add}</Highlight>
      </div>
    </div>
  );

  let scene: ReactNode;
  if (terminal) {
    const launch = client === "claudeCode" ? "claude" : client === "codex" ? "codex" : "gemini";
    scene = (
      <div className={styles.terminal}>
        <div className={styles.terminalBrand} aria-hidden="true">
          <ClientIcon client={client} />
          <strong>{label}</strong>
        </div>
        <p className={styles.terminalHint} aria-hidden="true">
          {step === 0 ? p.commandHint : step === 1 ? p.checkHint : p.ask}
        </p>
        <div className={styles.terminalCommands} key={step}>
          {step === 1 ? (
            <>
              <PreviewCopy text={launch} />
              <PreviewCopy text={client === "gemini" ? "/mcp list" : "/mcp"} />
            </>
          ) : (
            <PreviewCopy text={step === 0 ? code : p.ask} />
          )}
        </div>
        {step > 0 && (
          <div className={styles.terminalServer} aria-hidden="true">
            <span className={styles.dot} />
            <code>{name}</code>
            <span>{p.example}</span>
          </div>
        )}
      </div>
    );
  } else if (editor) {
    scene = (
      <div className={styles.editor}>
        <div className={styles.activity} aria-hidden="true">
          <span>▱</span>
          <span>⌕</span>
          <span>⑂</span>
          <span>▦</span>
          <span>⚙</span>
        </div>
        <div className={styles.editorBody}>
          <div className={styles.editorTab} aria-hidden="true">
            {step === 1 && client !== "cursor"
              ? file
              : client === "windsurf"
                ? p.cascade
                : p.settings}
            <span>×</span>
          </div>
          {step === 2 ? (
            chat
          ) : client === "cursor" ? (
            <div className={styles.editorSettings}>
              <h4>{step === 0 ? p.install : p.cursorCustomize}</h4>
              {step === 0 ? (
                <>
                  <Field label={p.name} value={name} />
                  <Field label={p.url} value={url} />
                  <Highlight>{p.install}</Highlight>
                </>
              ) : (
                <>
                  <div className={styles.settingRow}>{p.mcps}</div>
                  <Highlight pointer={false}>
                    <code>{name}</code>
                    <Toggle />
                  </Highlight>
                  <span className={styles.afterClick}>{p.enabled}</span>
                  <div className={styles.serverCard}>
                    {p.tools}
                    <code>{p.toolNames}</code>
                  </div>
                </>
              )}
            </div>
          ) : step === 1 ? (
            <>
              <div className={styles.codeActions} aria-hidden="true">
                <Highlight action={client !== "vscode"}>
                  {client === "vscode" ? p.trust : p.save}
                </Highlight>
              </div>
              <PreviewCopy text={code} appearance="code" animated={client !== "vscode"} />
            </>
          ) : client === "vscode" ? (
            <div className={styles.editorSettings}>
              <h4>{p.installServer}</h4>
              <Field label={p.name} value={name} />
              <Field label={p.url} value={url} />
              <Highlight>{p.installServer}</Highlight>
            </div>
          ) : (
            <div className={styles.editorSettings}>
              <h4>{p.cascade}</h4>
              <div className={styles.settingRow}>
                <span>{p.actions}</span>
                <span>···</span>
              </div>
              <Highlight>{p.openConfig}</Highlight>
              <div className={styles.serverCard}>
                <span className={styles.dot} />
                <code>{name}</code>
                <span className={styles.toggle} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  } else if (step === 2) {
    scene = chat;
  } else if (step === 1) {
    scene = <div className={styles.modalBackdrop}>{form}</div>;
  } else {
    const section = client === "chatgpt" ? p.security : client === "claude" ? p.connectors : p.mcp;
    scene = (
      <div className={styles.settings}>
        <div className={styles.sidebar}>
          <strong>{client === "claude" ? p.customize : p.settings}</strong>
          <span>{p.general}</span>
          <span>{p.account}</span>
          <span className={styles.sidebarSelected}>{section}</span>
        </div>
        <div className={styles.settingsContent}>
          <h4>{section}</h4>
          {client === "chatgpt" ? (
            <>
              <Highlight pointer={false}>
                <span>{p.developer}</span>
                <Toggle />
              </Highlight>
              <div className={styles.settingRow}>
                <span>{p.plugins}</span>
                <span>+</span>
              </div>
            </>
          ) : (
            <>
              <div className={styles.settingRow}>
                <span>{section}</span>
                <span>+</span>
              </div>
              <Highlight>{client === "claude" ? p.addConnector : p.add}</Highlight>
              <div className={styles.skeleton} />
              <div className={styles.skeletonShort} />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <PreviewTime value={time}>
      <div
        ref={root}
        className={`${styles.window} ${!terminal && !editor && step === 1 ? styles.formWindow : ""}`}
        data-client={client}
        data-phase={previewPhase(time)}
      >
        <div className={styles.chrome} aria-hidden="true">
          <span className={styles.traffic}>
            <i />
            <i />
            <i />
          </span>
          <span>{label}</span>
          <span className={styles.windowBadge}>{p.example}</span>
        </div>
        <div className={styles.scene} key={`${client}-${step}`}>
          {scene}
        </div>
      </div>
    </PreviewTime>
  );
}
