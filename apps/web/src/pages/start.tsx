import { REFERENCE_REPOSITORY_ADDRESS } from "@skillcdn/core";
import { type ReactNode, useEffect } from "react";
import { track } from "../analytics.js";
import {
  Planet,
  type PlanetKind,
  PlanetShapes,
  type PlanetTone,
  toneClass,
} from "../components/agents-planet.js";
import { CodeBlock, CopyButton } from "../components/code-block.js";
import { clientConfiguration } from "../components/connect-clients.js";
import glass from "../components/glass.module.css";
import { SearchForm } from "../components/search-form.js";
import { ArrowIcon, Container, cx, ExternalIcon } from "../components/ui.js";
import { useFeatures } from "../features.js";
import { useI18n } from "../i18n/index.js";
import type { StartStepWords } from "../i18n/messages/start-en.js";
import { Link } from "../navigation.js";
import { PATHS, START_STEPS, type StartStep } from "../router.js";
import { CONSOLE_PACK_ADDRESS, LINKS } from "../site.js";
import styles from "./start.module.css";

/** The name the connection guide gives the console pack in a client's configuration. */
const CONSOLE_SERVER_NAME = "skillcdn-console";
/** The coding agents the second step names a command for; the pack's page has every app. */
const AGENTS = ["claudeCode", "codex"] as const;

/** What a face shows: one of the page's own drawings, or planets of the front page's scene. */
type Look = "skill" | "board" | readonly (readonly [PlanetKind, PlanetTone])[];

/**
 * The face of each way to start: a skill is a sentence sent in an AI app and answered with one,
 * a console of one's own a card of its board in hand, the first employee the ringed planet the
 * scene hires first, and a team three planets together. The first two are what the reader does,
 * the last two the AI employees themselves.
 */
const FACES: Readonly<Record<StartStep, Look>> = {
  skills: "skill",
  board: "board",
  employee: [[0, "violet"]],
  team: [
    [0, "violet"],
    [1, "sunset"],
    [2, "mint"],
  ],
};

/** The face of the last word, which sends the reader to their AI: an AI's own. */
const STUCK: Look = [[3, "ocean"]];

/** What is learned, as the scene of the front page draws it: a point of light, in a box of 24. */
const SPARK =
  "M12 1.5c1.1 6.4 4.1 9.4 10.5 10.5C16.1 13.1 13.1 16.1 12 22.5 10.9 16.1 7.9 13.1 1.5 12 7.9 10.9 10.9 7.9 12 1.5Z";
/** The hand of the console's board holding a card, in a box of 24 (console-demo.tsx). */
const GRAB =
  "M7.4 13.2V11.3C7.4 9.9 9.6 9.9 9.6 11.3V10.6C9.6 9.1 12 9.1 12 10.6V10.9C12 9.4 14.4 9.4 14.4 10.9V11.7C14.4 10.3 16.8 10.3 16.8 11.7V16.4C16.8 19.6 14.5 22 11.4 22H10.5C8.4 22 6.7 21 5.7 19.4L3.5 16.1C2.8 15 3.7 13.6 5 13.9C5.4 14 5.7 14.2 6 14.6L7.4 16.3Z";
/** The two messages: the reader's, sent, its corner toward them, and the answer under it. */
const SENT =
  "M44 18H75A8 8 0 0 1 83 26V37.5A2.5 2.5 0 0 1 80.5 40H44A8 8 0 0 1 36 32V26A8 8 0 0 1 44 18Z";
const ANSWER =
  "M25 46H63A8 8 0 0 1 71 54V71A8 8 0 0 1 63 79H19.5A2.5 2.5 0 0 1 17 76.5V54A8 8 0 0 1 25 46Z";

/** A line of words in a drawing: a bar as tall as a small letter. */
function Words(props: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fill: string;
  readonly className?: string;
}) {
  return (
    <rect
      className={props.className}
      x={props.x}
      y={props.y}
      width={props.width}
      height="3.4"
      rx="1.7"
      fill={props.fill}
    />
  );
}

/**
 * The page's own drawings, once on the page, made of what the front page shows: the first a
 * sentence sent in an AI app and its answer, given with a skill, which the spark of the scene
 * marks; the second a card of the console's board in the hand that carries it, with its badges
 * and the face of the agent at work on it. They are drawn as small as a planet, so that the four
 * stand in a row as equals.
 */
function StartShapes() {
  return (
    <svg className={styles.shapes} width="0" height="0" aria-hidden="true">
      <defs>
        <linearGradient id="start-sent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={styles.sentFrom} />
          <stop offset="1" className={styles.sentTo} />
        </linearGradient>
        <clipPath id="start-tile">
          <rect x="37" y="19" width="11" height="11" rx="2.6" />
        </clipPath>
      </defs>
      <symbol id="start-skill" viewBox="0 0 100 100">
        <path d={SENT} fill="url(#start-sent)" />
        <Words x={43} y={25} width={30} fill="var(--color-accent-contrast)" />
        <Words x={43} y={31.5} width={18} fill="var(--color-accent-contrast)" />
        <path d={ANSWER} fill="var(--console-sheet-hover)" />
        {/* The answer says what it was given with, as a card of the scene does. */}
        <rect x="24" y="53" width="25" height="8" rx="4" fill="var(--console-accent-subtle)" />
        <path
          d={SPARK}
          transform="translate(26.2 54.2) scale(0.233)"
          fill="var(--console-accent)"
        />
        <Words
          x={33.4}
          y={55.3}
          width={11.5}
          fill="var(--console-accent)"
          className={styles.faint}
        />
        <Words x={24} y={66} width={39} fill="var(--console-neutral)" />
        <Words x={24} y={72} width={24} fill="var(--console-neutral)" />
        <path d={SPARK} transform="translate(9 33) scale(0.62)" className={styles.spark} />
      </symbol>
      <symbol id="start-board" viewBox="0 0 100 100">
        {/* Where the card stood in its column, left pale while it is carried. */}
        <rect x="13" y="46" width="50" height="32" rx="7" className={styles.place} />
        <g transform="translate(31 20) scale(1.08) rotate(-5 26 16.5)">
          <g className={styles.carried}>
            <rect
              width="52"
              height="33"
              rx="7"
              fill="var(--console-sheet-hover)"
              stroke="var(--console-accent)"
              strokeWidth="1.2"
            />
            <Words
              x={6}
              y={6}
              width={9}
              fill="var(--console-text-faint)"
              className={styles.faint}
            />
            <rect x="6" y="11.5" width="30" height="4.4" rx="2.2" fill="var(--console-text)" />
            <rect
              x="6"
              y="21"
              width="14"
              height="7"
              rx="3.5"
              fill="var(--console-category-marketing)"
            />
            <rect x="22" y="21" width="10" height="7" rx="3.5" fill="var(--console-neutral)" />
            <rect x="37" y="19" width="11" height="11" rx="2.6" fill="var(--agents-tile)" />
            <g className={toneClass("violet")} clipPath="url(#start-tile)">
              <use href="#agents-planet-0" x="35.5" y="17.5" width="14" height="14" />
            </g>
          </g>
          <path
            d={GRAB}
            transform="translate(10 21.5) scale(0.95)"
            className={styles.hand}
            stroke="var(--console-hand-stroke)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </g>
      </symbol>
    </svg>
  );
}

function Face(props: { readonly look: Look; readonly className?: string }) {
  const { look } = props;
  if (typeof look === "string") {
    return (
      <span className={cx(styles.face, styles[`halo-${look}`], props.className)} aria-hidden="true">
        <span>
          <svg className={styles.drawing} viewBox="0 0 100 100" aria-hidden="true">
            <use href={`#start-${look}`} />
          </svg>
        </span>
      </span>
    );
  }
  const [first] = look;
  return (
    <span
      className={cx(
        styles.face,
        look.length > 1 && styles.crowd,
        first !== undefined && styles[`halo-${first[1]}`],
        props.className,
      )}
      aria-hidden="true"
    >
      {look.map(([kind, tone]) => (
        <span key={`${kind}-${tone}`}>
          <Planet kind={kind} tone={tone} />
        </span>
      ))}
    </span>
  );
}

/** The marks of the moves of a step: what to connect, what to say, and what comes then. */
function MoveIcon(props: { readonly kind: "connect" | "say" | "next" }) {
  const path = {
    connect: "M9 7V3m6 4V3M6 7h12v4a6 6 0 0 1-12 0Zm6 10v4",
    say: "M4 5h16v11H9l-5 4Z",
    next: "M12 3q1 7 8 9q-7 2-8 9q-1-7-8-9q7-2 8-9Z",
  }[props.kind];
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16 9.8" />
    </svg>
  );
}

/** One move of a step, in the order it is made. */
function Move(props: {
  readonly kind: "connect" | "say" | "next";
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <li className={styles.move}>
      <span className={styles.mark}>
        <MoveIcon kind={props.kind} />
      </span>
      <div className={styles.moveBody}>
        <p className={styles.moveTitle}>{props.title}</p>
        {props.children}
      </div>
    </li>
  );
}

/**
 * The sentence to tell an AI, drawn as a message one sends, to copy as it stands. It is words,
 * so it is set in the face of the page and not in the code face, which has no Hangul.
 */
function Say(props: { readonly words: string; readonly step: StartStep }) {
  const { t } = useI18n();
  return (
    <figure className={styles.say}>
      <blockquote className={styles.bubble}>{props.words}</blockquote>
      <figcaption>
        <CopyButton
          text={props.words}
          label={t.start.copySentence}
          variant="secondary"
          onCopied={() => track("start_copy", { step: props.step, what: "sentence" })}
        />
      </figcaption>
    </figure>
  );
}

/** One way to start: what comes of it, what to have ready, and the moves that make it. */
function Step(props: {
  readonly id: StartStep;
  readonly number: number;
  readonly words: StartStepWords;
  readonly aside?: ReactNode;
  readonly after?: ReactNode;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const { words } = props;
  return (
    <li id={props.id} className={styles.step}>
      <div className={styles.rail}>
        <Face look={FACES[props.id]} className={styles.railFace} />
      </div>
      <div className={styles.body}>
        <header className={styles.stepHead}>
          <p className={styles.meta}>
            <span className={styles.number}>{t.start.step(props.number)}</span>
            <span className={styles.where}>{words.where}</span>
          </p>
          <h2>{words.title}</h2>
          <p className={styles.gain}>{words.gain}</p>
        </header>
        <div className={styles.work}>
          <section className={styles.needs}>
            <h3 className={styles.label}>{t.start.needs}</h3>
            <ul>
              {words.needs.map((need) => (
                <li key={need}>
                  <CheckIcon />
                  <span>{need}</span>
                </li>
              ))}
            </ul>
            {props.aside}
          </section>
          <section className={cx(glass.pane, styles.follow)}>
            <h3 className={styles.label}>{t.start.follow}</h3>
            <ol className={styles.moves}>
              {props.children}
              <Move kind="next" title={t.start.next}>
                <p className={styles.next}>{words.next}</p>
              </Move>
            </ol>
          </section>
        </div>
        {props.after}
      </div>
    </li>
  );
}

/**
 * Where a newcomer starts (ADR-0129): the ways to start, from one skill to a team's console, at
 * a glance at the top and one after another under it, each with what to have ready, what to
 * connect, the one sentence to tell an AI and what the AI does then. How a thing is done is the
 * pack's to say, to the agent that does it. A deployment whose front page shows neither the
 * console nor the agents has the first way alone, and no row at the top.
 */
export function StartPage(props: { readonly origin: string }) {
  const { t } = useI18n();
  const copy = t.start;
  const features = useFeatures();
  const shows = (section: "agents" | "console" | "builders") =>
    features.landingSections.includes(section);
  const withConsole = shows("console") || shows("agents");
  const skillsUrl = `${props.origin}${REFERENCE_REPOSITORY_ADDRESS}`;
  const consoleUrl = `${props.origin}${CONSOLE_PACK_ADDRESS}`;
  const steps = START_STEPS.filter((step) => step === "skills" || withConsole);

  // A link from another page names a step by its fragment, and moving between pages of the app
  // loads no document: the step is brought into view here, at once.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if ((START_STEPS as readonly string[]).includes(id)) {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);

  const howToConnect = (href: string) => (
    <p className={styles.more}>
      <Link href={href}>
        {copy.howToConnect}
        <ArrowIcon />
      </Link>
    </p>
  );

  const step = (id: StartStep, number: number): ReactNode => {
    const words = copy.steps[id];
    switch (id) {
      case "skills":
        return (
          <Step
            key={id}
            id={id}
            number={number}
            words={words}
            after={
              features.search && (
                <div className={styles.search}>
                  <h3 className={styles.label}>{copy.search}</h3>
                  <SearchForm from="start" />
                </div>
              )
            }
          >
            <Move kind="connect" title={copy.connectApp}>
              <CodeBlock
                label={copy.address}
                code={skillsUrl}
                copy
                onCopied={() => track("start_copy", { step: id, what: "address" })}
              />
              {howToConnect(REFERENCE_REPOSITORY_ADDRESS)}
            </Move>
            <Move kind="say" title={copy.say}>
              <Say words={words.say} step={id} />
            </Move>
          </Step>
        );
      case "board":
        return (
          <Step
            key={id}
            id={id}
            number={number}
            words={words}
            aside={
              shows("builders") && (
                <div className={styles.shared}>
                  <p className={styles.sharedTitle}>{copy.shared.title}</p>
                  <p>{copy.shared.body}</p>
                  <a href={LINKS.builders} target="_blank" rel="noopener noreferrer">
                    {copy.shared.join}
                    <ExternalIcon />
                  </a>
                </div>
              )
            }
          >
            <Move kind="connect" title={copy.connectAgent}>
              {AGENTS.map((client) => (
                <CodeBlock
                  key={client}
                  label={t.connect.clients[client].label}
                  code={clientConfiguration(client, CONSOLE_SERVER_NAME, consoleUrl)}
                  copy
                  onCopied={() => track("start_copy", { step: id, what: "command", client })}
                />
              ))}
              {howToConnect(CONSOLE_PACK_ADDRESS)}
            </Move>
            <Move kind="say" title={copy.say}>
              <Say words={words.say} step={id} />
            </Move>
          </Step>
        );
      case "employee":
      case "team":
        return (
          <Step key={id} id={id} number={number} words={words}>
            <Move kind="say" title={copy.sayToAgent}>
              <Say words={words.say} step={id} />
            </Move>
          </Step>
        );
    }
  };

  return (
    <>
      <PlanetShapes />
      <StartShapes />
      <Container className={styles.page}>
        <header className={styles.head}>
          <p className={styles.kicker}>{copy.kicker}</p>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.lead}>{copy.lead}</p>
        </header>
        {steps.length > 1 && (
          <nav className={styles.map} aria-label={copy.map}>
            <ol>
              {steps.map((id, index) => (
                <li key={id}>
                  <a className={styles.stop} href={`#${id}`}>
                    <Face look={FACES[id]} className={styles.stopFace} />
                    <span className={styles.number}>{copy.step(index + 1)}</span>
                    <span className={styles.stopTitle}>{copy.steps[id].title}</span>
                    <span className={styles.stopWhere}>{copy.steps[id].where}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <ol className={styles.steps}>{steps.map((id, index) => step(id, index + 1))}</ol>
        <aside className={cx(glass.pane, styles.stuck)}>
          <Face look={STUCK} className={styles.stuckFace} />
          <div>
            <h2>{copy.stuck.title}</h2>
            <p>{copy.stuck.body}</p>
          </div>
          <p className={styles.stuckLinks}>
            <Link href={PATHS.docs}>
              {copy.stuck.docs}
              <ArrowIcon />
            </Link>
            <Link href={PATHS.explore}>
              {copy.stuck.explore}
              <ArrowIcon />
            </Link>
          </p>
        </aside>
      </Container>
    </>
  );
}
