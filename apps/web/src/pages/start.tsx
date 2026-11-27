import { REFERENCE_REPOSITORY_ADDRESS } from "@skillcdn/core";
import { type ReactNode, useEffect } from "react";
import { track } from "../analytics.js";
import {
  Planet,
  type PlanetKind,
  PlanetShapes,
  type PlanetTone,
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
 * The face of each way to start: a skill is a page with the spark of learning, a console of
 * one's own its board, the first employee the ringed planet the scene hires first, and a team
 * three planets together. The first two are things, the last two the AI employees themselves.
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

/** The tone each drawing is in, as a planet has one. */
const DRAWN: Readonly<Record<"skill" | "board", PlanetTone>> = { skill: "mint", board: "ocean" };

const mint = (n: number): string => `var(--agents-mint-${n})`;
const ocean = (n: number): string => `var(--agents-ocean-${n})`;

/** A page with its corner turned, and the spark on it. */
const PAGE = "M32 20H60L72 32V76A4 4 0 0 1 68 80H32A4 4 0 0 1 28 76V24A4 4 0 0 1 32 20Z";
const CORNER = "M60 20V28A4 4 0 0 0 64 32H72Z";
const SPARK = "M72 63q1.8 8.2 10 10q-8.2 1.8-10 10q-1.8-8.2-10-10q8.2-1.8 10-10Z";
/** The board's three lanes and the cards that lie in them. */
const LANES = [25.5, 42.5, 59.5] as const;
const CARDS = [
  [25.5, 36],
  [25.5, 47],
  [25.5, 58],
  [42.5, 36],
  [59.5, 36],
] as const;

/** A skill's page in the tones from `by` on, drawn once for each half as a planet is. */
function SkillPage(props: { readonly by: number }) {
  const { by } = props;
  return (
    <>
      <path d={PAGE} fill={mint(by)} />
      <path d={CORNER} fill={mint(1 + by)} />
      <rect x="36" y="40" width="28" height="5" rx="2.5" fill={mint(1 + by)} />
      <rect x="36" y="50" width="28" height="5" rx="2.5" fill={mint(1 + by)} />
      <rect x="36" y="60" width="16" height="5" rx="2.5" fill={mint(1 + by)} />
    </>
  );
}

/** A board in the tones from `by` on: its lanes and the cards in them. */
function BoardFrame(props: { readonly by: number }) {
  const { by } = props;
  return (
    <>
      <rect x="20" y="26" width="60" height="50" rx="8" fill={ocean(1 + by)} />
      {LANES.map((x) => (
        <rect key={x} x={x} y="33" width="15" height="37" rx="3" fill={ocean(2 + by)} />
      ))}
      {CARDS.map(([x, y]) => (
        <rect key={`${x} ${y}`} x={x + 2} y={y} width="11" height="8" rx="2" fill={ocean(by)} />
      ))}
    </>
  );
}

/**
 * The page's own drawings, once on the page: flat and of two tones as the planets are, the
 * lighter left of the middle, so that they stand among them as one family.
 */
function StartShapes() {
  return (
    <svg className={styles.shapes} width="0" height="0" aria-hidden="true">
      <defs>
        <clipPath id="start-right">
          <rect x="50" y="-20" width="80" height="140" />
        </clipPath>
      </defs>
      {/* Seen a little closer than a planet, whose ring and moons reach further out. */}
      <symbol id="start-skill" viewBox="7 7 86 86">
        <SkillPage by={0} />
        <g clipPath="url(#start-right)">
          <SkillPage by={1} />
        </g>
        <path d={SPARK} fill="var(--agents-sunset-0)" />
      </symbol>
      <symbol id="start-board" viewBox="7 7 86 86">
        <BoardFrame by={0} />
        <g clipPath="url(#start-right)">
          <BoardFrame by={1} />
        </g>
        {/* A card on its way from one lane to the next. */}
        <g transform="rotate(-9 56 51)">
          <rect x="45" y="46" width="22" height="10" rx="2.5" fill="var(--agents-sunset-0)" />
          <rect
            x="45"
            y="46"
            width="22"
            height="10"
            rx="2.5"
            fill="var(--agents-sunset-1)"
            clipPath="url(#start-right)"
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
      <span
        className={cx(styles.face, styles[`halo-${DRAWN[look]}`], props.className)}
        aria-hidden="true"
      >
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
