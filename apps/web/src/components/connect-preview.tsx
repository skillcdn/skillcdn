import type { ReactNode } from "react";
import { useI18n } from "../i18n/index.js";
import { ClientIcon } from "./client-icon.js";
import {
  DemoPointer,
  type PreviewLoop,
  PreviewTime,
  previewPhase,
  usePreviewLoop,
} from "./connect-animation.js";
import { type ConnectClient, clientConfiguration, isTerminalClient } from "./connect-clients.js";
import styles from "./connect-preview.module.css";
import { PreviewCopy } from "./connect-preview-copy.js";

function Highlight({
  children,
  action = false,
  pointer = true,
  className,
}: {
  readonly children: ReactNode;
  readonly action?: boolean;
  readonly pointer?: boolean;
  /** The control's own look, when it is more than an outline: a filled button, say. */
  readonly className?: string;
}) {
  return (
    <span
      className={className === undefined ? styles.highlight : `${styles.highlight} ${className}`}
      data-action={action}
    >
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

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
  description,
}: {
  readonly client: ConnectClient;
  readonly step: number;
  readonly name: string;
  readonly url: string;
  /** What to describe the server as where an app asks: the repository's own words, shortened. */
  readonly description: string;
}) {
  const { t } = useI18n();
  const p = t.connect.preview;
  const label = t.connect.clients[client].label;
  const terminal = isTerminalClient(client);
  const editor = client === "cursor" || client === "vscode";
  // What the scene does sets its loop: the first step of Claude and ChatGPT opens a menu and
  // chooses from it, two clicks; the forms, chats and terminals type and send.
  const loop: PreviewLoop =
    terminal || step === 2 || (step === 1 && !editor)
      ? "type"
      : step === 0 && (client === "claude" || client === "chatgpt")
        ? "clicks"
        : "click";
  const { root, time } = usePreviewLoop(loop);
  const file = client === "vscode" ? ".vscode/mcp.json" : ".cursor/mcp.json";
  const code = clientConfiguration(client, name, url);

  // Claude and ChatGPT bring an added server into a chat on their own, so their chats show no
  // menu to switch it on and no mention to make; the message is the whole of the step. The
  // editors and an unknown client keep a tools list, because theirs have one to check.
  const picks = editor || client === "other";
  const ask = p.ask(name);
  const chat = (
    <div className={styles.chat}>
      <div className={styles.chatTitle}>
        <ClientIcon client={client} />
        <strong>
          {client === "chatgpt"
            ? p.work
            : editor
              ? client === "vscode"
                ? p.chatView
                : p.agent
              : p.newChat}
        </strong>
      </div>
      {picks && (
        <div className={styles.chatMenu}>
          <span>{p.tools}</span>
          <Highlight pointer={false}>
            <span>{name}</span>
            <Toggle />
          </Highlight>
        </div>
      )}
      <div className={styles.composer}>
        {picks && <span className={styles.chip}>{`+ ${name}`}</span>}
        <div className={styles.composerText}>
          <PreviewCopy text={ask} appearance="text" />
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
        {ask}
      </div>
    </div>
  );

  const form = (
    <div className={styles.dialog}>
      <div className={styles.dialogTitle}>
        <strong>
          {client === "chatgpt" ? p.newPlugin : client === "claude" ? p.addConnector : p.remote}
        </strong>
        <span>×</span>
      </div>
      <Field label={p.name} value={name} />
      {client === "chatgpt" && <Field label={p.description} value={description} />}
      {client === "chatgpt" && (
        <div className={styles.formRow}>
          <span>{p.connection}</span>
          <span className={styles.segment}>
            <span className={styles.segmentSelected}>{p.serverUrl}</span>
            <span>{p.tunnel}</span>
          </span>
        </div>
      )}
      <Field label={client === "chatgpt" ? p.serverUrl : p.url} value={url} highlight />
      {client === "chatgpt" ? (
        // The authentication list comes up on OAuth and the step says to choose none: the first
        // pointer takes it from the open list, and the field then shows the choice.
        <div className={styles.formRow}>
          <span>{p.authentication}</span>
          <span className={styles.select}>
            <span className={styles.selectValue}>
              <span className={styles.beforeChoice}>{p.oauth}</span>
              <span className={styles.afterChoice}>{p.noAuth}</span>
              <Chevron />
            </span>
            <span className={styles.dropdown}>
              <span>{p.oauth}</span>
              <Highlight>{p.noAuth}</Highlight>
              <span>{p.oauthOrNone}</span>
            </span>
          </span>
        </div>
      ) : (
        client === "other" && (
          <div className={styles.formRow}>
            <span>{p.authentication}</span>
            <span className={styles.selectValue}>
              {p.none}
              <Chevron />
            </span>
          </div>
        )
      )}
      {client === "chatgpt" && (
        <div className={styles.formRow}>
          <span className={styles.checked}>
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m3.5 8.5 3 3 6-7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {p.acknowledge}
          </span>
        </div>
      )}
      <div className={styles.formActions}>
        <Highlight action>
          {client === "chatgpt" ? p.create : client === "claude" ? p.continue : p.add}
        </Highlight>
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
          {step === 0 ? p.commandHint : step === 1 ? p.checkHint : ask}
        </p>
        <div className={styles.terminalCommands} key={step}>
          {step === 1 ? (
            <>
              <PreviewCopy text={launch} />
              <PreviewCopy text={client === "gemini" ? "/mcp list" : "/mcp"} />
            </>
          ) : (
            <PreviewCopy text={step === 0 ? code : ask} />
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
            {step === 1 && client !== "cursor" ? file : p.settings}
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
                <Highlight>{p.trust}</Highlight>
              </div>
              <PreviewCopy text={code} appearance="code" />
            </>
          ) : (
            <div className={styles.editorSettings}>
              <h4>{p.installServer}</h4>
              <Field label={p.name} value={name} />
              <Field label={p.url} value={url} />
              <Highlight>{p.installServer}</Highlight>
            </div>
          )}
        </div>
      </div>
    );
  } else if (step === 2) {
    scene = chat;
  } else if (step === 1) {
    scene = <div className={styles.modalBackdrop}>{form}</div>;
  } else if (client === "claude" || client === "chatgpt") {
    // The two apps lay this page out alike: a page with tabs across the top, an Add button at the
    // end of them and its menu open on the entry the step names. Claude's is the Customize page
    // from the sidebar on its Connectors tab (the same page opens from the account menu's
    // settings, which the note says); ChatGPT's is the Plugins page of its settings on the MCP
    // tab. One drawing each is enough.
    const claude = client === "claude";
    scene = (
      <div className={styles.settings}>
        <div className={styles.sidebar}>
          {claude ? (
            <>
              <span>{p.newChat}</span>
              <span>{p.projects}</span>
              <span className={styles.sidebarSelected}>{p.customize}</span>
            </>
          ) : (
            <>
              <strong>{p.chatgptCustomize}</strong>
              <span className={styles.sidebarSelected}>{p.plugins}</span>
              <span>{p.skills}</span>
            </>
          )}
        </div>
        <div className={styles.settingsContent}>
          <h4>{claude ? p.customize : p.plugins}</h4>
          <div className={styles.tabRow}>
            {claude ? (
              <>
                <span>{p.skills}</span>
                <span className={styles.tabSelected}>{p.connectors}</span>
                <span>{p.plugins}</span>
              </>
            ) : (
              <>
                <span className={styles.tabSelected}>{p.publicPlugins}</span>
                <span>{p.personalPlugins}</span>
              </>
            )}
            {/* The first click opens the menu; the second, by the action pointer, takes its entry. */}
            <Highlight className={styles.addButton}>
              {claude ? `+ ${p.add}` : `${p.add} ▾`}
            </Highlight>
          </div>
          <div className={styles.menu}>
            {/* The entry to take and no other: the rest of the menu changes between releases. */}
            <Highlight action>{claude ? p.addConnector : p.createMcpApp}</Highlight>
          </div>
          <div className={styles.skeleton} />
          <div className={styles.skeletonShort} />
        </div>
      </div>
    );
  } else {
    scene = (
      <div className={styles.settings}>
        <div className={styles.sidebar}>
          <strong>{p.settings}</strong>
          <span>{p.general}</span>
          <span>{p.account}</span>
          <span className={styles.sidebarSelected}>{p.mcp}</span>
        </div>
        <div className={styles.settingsContent}>
          <h4>{p.mcp}</h4>
          <div className={styles.settingRow}>
            <span>{p.mcp}</span>
            <span>+</span>
          </div>
          <Highlight>{p.add}</Highlight>
          <div className={styles.skeleton} />
          <div className={styles.skeletonShort} />
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
        data-phase={previewPhase(time, loop)}
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
