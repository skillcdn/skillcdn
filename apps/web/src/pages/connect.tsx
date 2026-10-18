import {
  parseConnectCode,
  REPO_TOKEN_DEFAULT_DAYS,
  REPO_TOKEN_LIFETIMES_DAYS,
  REPO_TOKEN_MAX_LABEL_LENGTH,
  type RestConnectDecided,
} from "@skillcdn/core";
import { type FormEvent, useEffect, useState } from "react";
import { track } from "../analytics.js";
import { ApiError, api } from "../api/client.js";
import { resourceKeys } from "../api/keys.js";
import { useResource } from "../api/use-resource.js";
import { useSession } from "../auth/session.js";
import { ErrorCallout } from "../components/error-callout.js";
import { SignIn } from "../components/sign-in.js";
import { Avatar, Button, Callout, Container, cx, Skeleton, Spinner } from "../components/ui.js";
import ui from "../components/ui.module.css";
import { useI18n } from "../i18n/index.js";
import { Link, navigate, useLocation } from "../navigation.js";
import { accountHref, connectHref } from "../router.js";
import { applyHead, buildHead } from "../seo/head.js";
import styles from "./connect.module.css";
import shared from "./consent.module.css";
import { NotFoundPage } from "./simple.js";

export interface ConnectPageProps {
  readonly origin: string;
  /** The code as the URL carries it, or none: the page then asks for one. */
  readonly code: string | undefined;
}

/** How long what a person types as a code may be: the code, and a space or two around it. */
const MAX_TYPED_LENGTH = 12;

/** A card with one message and, where there is one, a way on. */
function Notice(props: {
  readonly tone: "info" | "warning";
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly href: string; readonly label: string } | undefined;
}) {
  return (
    <Container className={shared.page}>
      <div className={shared.card}>
        <Callout tone={props.tone} title={props.title}>
          <p>{props.body}</p>
          {props.action !== undefined && (
            <p>
              <Link className={cx(ui.button, ui.secondary, ui.small)} href={props.action.href}>
                {props.action.label}
              </Link>
            </p>
          )}
        </Callout>
      </div>
    </Container>
  );
}

/** Where a person who has a code and no link types it. */
function EnterCode() {
  const { t } = useI18n();
  const k = t.connectCommand.enter;
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = parseConnectCode(typed);
    if (code === undefined) {
      setInvalid(true);
      return;
    }
    navigate(connectHref(code));
  };
  return (
    <Container className={shared.page}>
      <form className={shared.card} onSubmit={submit}>
        <h1 className={shared.title}>{k.title}</h1>
        <p className={shared.text}>{k.lead}</p>
        <div className={styles.field}>
          <label htmlFor="connect-code">{k.label}</label>
          <input
            id="connect-code"
            className={cx(styles.control, styles.codeInput)}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={MAX_TYPED_LENGTH}
            placeholder="ABCD-EFGH"
            aria-invalid={invalid}
            aria-describedby={invalid ? "connect-code-problem" : undefined}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setInvalid(false);
            }}
          />
        </div>
        {invalid && (
          <p id="connect-code-problem" className={styles.problem}>
            {k.invalid}
          </p>
        )}
        <div className={shared.actions}>
          <Button type="submit" variant="primary">
            {k.submit}
          </Button>
        </div>
      </form>
    </Container>
  );
}

/**
 * Where a person approves a command that asked to connect (ADR-0059). The command showed them
 * this page's address and a code; the page shows what asks, for which repository and as whom,
 * and the code to compare; they name the token, say how long it is good for, and approve, or
 * say that it is not theirs. The command is handed its token afterwards, by itself: nothing
 * here is copied anywhere.
 *
 * As on the consent page, there is a question only when the person can open the repository;
 * when they cannot, the page says so in one sentence for every reason, and offers to look again.
 */
export function ConnectPage(props: ConnectPageProps) {
  const { t, language } = useI18n();
  const k = t.connectCommand;
  const { session, signOut } = useSession();
  const location = useLocation();
  const code = props.code === undefined ? undefined : parseConnectCode(props.code);
  const [answering, setAnswering] = useState(false);
  const [failure, setFailure] = useState<ApiError>();
  const [outcome, setOutcome] = useState<RestConnectDecided["status"] | "public">();
  const [label, setLabel] = useState("");
  /** The lifetime chosen, in days; `null` for a token without an end. */
  const [days, setDays] = useState<number | null>(REPO_TOKEN_DEFAULT_DAYS);

  useEffect(() => {
    applyHead(buildHead({ name: "connect", code: props.code }, language, props.origin));
  }, [props.code, language, props.origin]);

  const login = session.status === "user" ? session.user.login : undefined;
  const asked = useResource(resourceKeys.connection(code ?? "", login), async (signal) =>
    // Nothing is asked for nobody: the request is shown to a person signed in, and to no other.
    code === undefined || login === undefined ? undefined : api.connection(code, signal),
  );

  if (session.status === "disabled") {
    return <NotFoundPage />;
  }
  if (props.code === undefined) {
    return <EnterCode />;
  }
  if (code === undefined) {
    return (
      <Notice
        tone="info"
        title={k.notFound.title}
        body={k.notFound.body}
        action={{ href: connectHref(), label: k.notFound.again }}
      />
    );
  }
  if (session.status === "anonymous") {
    return (
      <Container className={shared.page}>
        <div className={shared.card}>
          <h1 className={shared.title}>{k.signIn.title}</h1>
          <p className={shared.text}>{k.signIn.body}</p>
          <SignIn returnTo={`${location.pathname}${location.search}`} from="connect" />
        </div>
      </Container>
    );
  }
  if (outcome !== undefined) {
    const agent = asked.state === "ready" && asked.value !== undefined ? asked.value.agent : "";
    return outcome === "approved" ? (
      <Notice
        tone="info"
        title={k.approved.title(agent)}
        body={k.approved.body}
        action={{ href: accountHref("tokens"), label: k.approved.tokens }}
      />
    ) : outcome === "denied" ? (
      <Notice tone="info" title={k.denied.title} body={k.denied.body} />
    ) : (
      <Notice tone="info" title={k.public.title} body={k.public.body} />
    );
  }
  if (asked.state === "error") {
    return asked.error.status === 404 ? (
      <Notice
        tone="info"
        title={k.notFound.title}
        body={k.notFound.body}
        action={{ href: connectHref(), label: k.notFound.again }}
      />
    ) : (
      <Container className={shared.page}>
        <div className={shared.card}>
          <ErrorCallout error={asked.error} onRetry={asked.reload} />
        </div>
      </Container>
    );
  }
  if (asked.state === "loading" || asked.value === undefined) {
    return (
      <Container className={shared.page}>
        <div className={shared.card}>
          <Skeleton lines={5} label={t.common.loading} />
        </div>
      </Container>
    );
  }

  const view = asked.value;
  if (view.approved) {
    return <Notice tone="info" title={k.already.title} body={k.already.body} />;
  }
  // Only someone who can open the repository has something to approve. `null` is the git host
  // not answering: nothing is approved on no answer either.
  const openable = view.visible === true;

  const answer = (approve: boolean) => {
    track("command_connect", { approved: approve });
    setAnswering(true);
    setFailure(undefined);
    const name = label.trim();
    api
      .decideConnection(
        code,
        approve
          ? { approve, ...(name.length === 0 ? {} : { label: name }), expiresInDays: days }
          : { approve },
      )
      .then(
        (decided) => {
          setAnswering(false);
          setOutcome(decided.status);
        },
        (error: unknown) => {
          setAnswering(false);
          if (error instanceof ApiError && error.code === "token.public_repository") {
            setOutcome("public");
            return;
          }
          if (error instanceof ApiError && error.code === "mount.repo_not_found") {
            // They could open it when the page was drawn and cannot any more: the page says so.
            asked.reload();
            return;
          }
          setFailure(
            error instanceof ApiError ? error : new ApiError(0, "unknown", "Unexpected failure."),
          );
        },
      );
  };

  return (
    <Container className={shared.page}>
      <div className={shared.card}>
        <h1 className={shared.title}>
          {openable ? k.title(view.agent) : k.refused.title(view.agent)}
        </h1>
        <p className={styles.code}>
          <span className="visually-hidden">{`${k.labels.code}: `}</span>
          <code>{view.code}</code>
        </p>
        <p className={shared.text}>{k.compare}</p>
        <dl className={shared.facts}>
          <dt>{k.labels.agent}</dt>
          <dd>
            <strong>{view.agent}</strong>
          </dd>
          <dt>{k.labels.address}</dt>
          <dd>
            <code>{view.address.replace(/^\/gh\//, "")}</code>
          </dd>
          <dt>{k.labels.account}</dt>
          <dd className={shared.account}>
            <Avatar src={view.user.avatar} size="sm" eager />
            <span>{view.user.login}</span>
          </dd>
        </dl>
        {openable ? (
          <>
            <p className={shared.text}>{k.what}</p>
            <div className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="connect-name">{k.form.name}</label>
                <input
                  id="connect-name"
                  className={styles.control}
                  type="text"
                  autoComplete="off"
                  maxLength={REPO_TOKEN_MAX_LABEL_LENGTH}
                  placeholder={view.agent}
                  aria-describedby="connect-name-hint"
                  value={label}
                  disabled={answering}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="connect-expires">{k.form.expires}</label>
                <select
                  id="connect-expires"
                  className={styles.control}
                  value={days ?? "never"}
                  disabled={answering}
                  onChange={(event) =>
                    setDays(event.target.value === "never" ? null : Number(event.target.value))
                  }
                >
                  {REPO_TOKEN_LIFETIMES_DAYS.map((lifetime) => (
                    <option key={lifetime} value={lifetime}>
                      {t.account.tokens.form.lifetime(lifetime)}
                    </option>
                  ))}
                  <option value="never">{t.account.tokens.form.never}</option>
                </select>
              </div>
            </div>
            <p id="connect-name-hint" className={shared.hint}>
              {k.form.nameHint}
            </p>
            <p className={shared.hint}>{k.selfNamed}</p>
          </>
        ) : view.visible === false ? (
          <Callout tone="warning" title={k.notVisible.title}>
            <p>{k.notVisible.body}</p>
            <p>{k.notVisible.fix}</p>
            {view.installUrl !== null && (
              <p>
                <a href={view.installUrl} target="_blank" rel="noopener noreferrer">
                  {k.notVisible.install}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </p>
            )}
          </Callout>
        ) : (
          <Callout tone="warning" title={k.unknown.title}>
            <p>{k.unknown.body}</p>
          </Callout>
        )}
        {failure !== undefined &&
          (failure.code === "connect.not_found" ? (
            <Callout tone="warning" title={k.notFound.title}>
              {k.notFound.body}
            </Callout>
          ) : (
            <ErrorCallout error={failure} />
          ))}
        <div className={shared.actions}>
          {openable ? (
            <>
              <Button variant="primary" disabled={answering} onClick={() => answer(true)}>
                {k.approve}
              </Button>
              <Button disabled={answering} onClick={() => answer(false)}>
                {k.deny}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={answering} onClick={asked.reload}>
                {k.refused.recheck}
              </Button>
              <Button disabled={answering} onClick={() => answer(false)}>
                {k.deny}
              </Button>
            </>
          )}
          {answering && <Spinner label={k.working} />}
        </div>
        <p className={shared.notYou}>
          {/* Signed out, the page offers to sign in again, and the git host asks as whom. */}
          <button type="button" disabled={answering} onClick={() => void signOut()}>
            {k.notYou}
          </button>
        </p>
      </div>
    </Container>
  );
}
