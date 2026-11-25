import { type RefObject, useEffect, useRef } from "react";
import { useI18n } from "../i18n/index.js";
import {
  Planet,
  type PlanetKind,
  PlanetShapes,
  PlanetTile,
  type PlanetTone,
} from "./agents-planet.js";
import {
  AGAIN,
  AGENTS,
  agentsScore,
  CARDS,
  COMETS,
  DOING,
  FACES,
  FEED,
  type Geometry,
  JOINED,
  MARKS,
  MESSAGES,
  ORDER,
  PASS_MS,
  type Point,
  REPLY,
  REPORT,
  SQUARES,
  STILL_MS,
} from "./agents-score.js";
import styles from "./agents-stage.module.css";
import { BrandSymbol } from "./brand.js";
import { PointerShape } from "./pointer-shape.js";
import { cx } from "./ui.js";

// The agent accounts on the front page: an infographic that plays. Agents are made on the
// console, told what is wanted in a messenger, split the work and run it side by side on the board,
// ask the one question a person must answer, and report; what they learned of it stays with them,
// and the next order is done without a question; and round again. It is a picture that moves,
// with nothing to press: the windows are drawn the way the console's board under it is,
// on the console's own light ground, and hidden from assistive technology with one paragraph
// that says what they show. What moves and when is the score (`agents-score.ts`); this places the
// parts, measures them and hands the score to the browser, which plays it on its own, pass after
// pass, only while the stage is on screen. Under reduced motion it stands on one moment.

type Words = ReturnType<typeof useI18n>["t"]["landing"]["agents"]["scene"];

/** The planet of each agent: its shape and its ramp. */
const LOOKS: readonly { readonly kind: PlanetKind; readonly tone: PlanetTone }[] = [
  { kind: 0, tone: "violet" },
  { kind: 1, tone: "sunset" },
  { kind: 2, tone: "mint" },
  { kind: 3, tone: "ocean" },
];
/** The faces that roll past before one stands, for each place of the form. */
const ROLLS: readonly (readonly { readonly kind: PlanetKind; readonly tone: PlanetTone }[])[] = [
  [
    { kind: 2, tone: "rose" },
    { kind: 3, tone: "sunset" },
    { kind: 1, tone: "ocean" },
    { kind: 0, tone: "mint" },
  ],
  [
    { kind: 3, tone: "mint" },
    { kind: 0, tone: "ocean" },
    { kind: 2, tone: "violet" },
    { kind: 3, tone: "rose" },
  ],
  [
    { kind: 1, tone: "violet" },
    { kind: 2, tone: "sunset" },
    { kind: 0, tone: "rose" },
    { kind: 1, tone: "mint" },
  ],
  [
    { kind: 0, tone: "sunset" },
    { kind: 1, tone: "rose" },
    { kind: 3, tone: "violet" },
    { kind: 2, tone: "ocean" },
  ],
];

const lookOf = (agent: number) => LOOKS[agent] ?? { kind: 3 as const, tone: "ocean" as const };

/** Text whose mentions stand out, as the messenger has them. */
function Mentions(props: { readonly text: string }) {
  return props.text.split(/(@[^\s,.!?]+)/).map((piece, index) =>
    piece.startsWith("@") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed text.
      <span key={index} className={styles.mention}>
        {piece}
      </span>
    ) : (
      piece
    ),
  );
}

/** A line that is typed: its words, each a part of its own. */
function TypedWords(props: { readonly name: string; readonly text: string }) {
  return props.text.split(" ").map((word, index) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: the words of one fixed text.
      key={index}
      className={cx(styles.typed, word.startsWith("@") && styles.mention)}
      data-part={`${props.name}-${index}`}
      data-typed={props.name}
    >
      {`${word} `}
    </span>
  ));
}

/** What a field is given for each agent in turn, letter by letter, one over the other. */
function TypedField(props: {
  readonly name: "name" | "title";
  readonly values: readonly string[];
}) {
  return props.values.map((value, agent) => (
    <span key={value} className={styles.fieldValue} data-field={`${props.name}-${agent}`}>
      {Array.from(value, (letter, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the letters of one fixed word.
        <span key={index} className={styles.typed} data-part={`${props.name}-${agent}-${index}`}>
          {letter}
        </span>
      ))}
    </span>
  ));
}

/** The form an agent account is made with: the faces, the two fields and the button. */
function Hire(props: { readonly words: Words }) {
  const { words } = props;
  const faces = [...words.agents, words.spare];
  return (
    <div className={styles.hire} data-part="hire">
      <div className={styles.hireHead}>
        <strong>{words.hire.title}</strong>
        <span className={styles.rollButton}>{words.hire.roll}</span>
      </div>
      <div className={styles.faces}>
        {FACES.map((face) => {
          const look = lookOf(face);
          return (
            <div key={face} className={styles.face} data-spot={`face-${face}`}>
              <div className={styles.strip}>
                <div data-part={`strip-${face}`} data-strip="">
                  <PlanetTile {...look} className={styles.faceTile} />
                  {(ROLLS[face] ?? []).map((other) => (
                    <PlanetTile
                      key={`${other.kind} ${other.tone}`}
                      {...other}
                      className={styles.faceTile}
                    />
                  ))}
                </div>
              </div>
              <div className={styles.persona} data-part={`persona-${face}`}>
                <b>{faces[face]?.name}</b>
                <span>{`@${faces[face]?.handle}`}</span>
              </div>
            </div>
          );
        })}
        <i className={styles.pick} data-part="pick" />
      </div>
      <div className={styles.fields}>
        <div className={styles.field}>
          <span>{words.hire.name}</span>
          <div>
            <TypedField name="name" values={words.agents.map((agent) => agent.name)} />
          </div>
        </div>
        <div className={styles.field}>
          <span>{words.hire.role}</span>
          <div>
            <TypedField name="title" values={words.agents.map((agent) => agent.title)} />
          </div>
        </div>
      </div>
      <span className={styles.addSlot} data-spot="add">
        <span className={styles.add} data-part="add">
          {words.hire.add}
        </span>
      </span>
    </div>
  );
}

/** A lollipop, and the fruit it is made of: what the team of the scene launches. */
function Candy(props: { readonly fruit: boolean }) {
  return (
    <svg viewBox="0 0 120 72" className={styles.candy} aria-hidden="true">
      {props.fruit ? (
        <>
          <g className={styles.berry} transform="translate(26 34) rotate(-16)">
            <path d="M0 24C-15 13-17-5-5-9-1-10 1-10 5-9 17-5 15 13 0 24Z" />
            <path className={styles.leaf} d="M-9-8 0-13 9-8 4-3 0-7-4-3Z" />
          </g>
          <g className={styles.berry} transform="translate(93 46) rotate(14) scale(0.72)">
            <path d="M0 24C-15 13-17-5-5-9-1-10 1-10 5-9 17-5 15 13 0 24Z" />
            <path className={styles.leaf} d="M-9-8 0-13 9-8 4-3 0-7-4-3Z" />
          </g>
          <g transform="translate(60 30) scale(0.78)">
            <Lollipop />
          </g>
        </>
      ) : (
        <g transform="translate(60 40) scale(1.28)">
          <Lollipop />
        </g>
      )}
    </svg>
  );
}

function Lollipop() {
  return (
    <>
      <rect className={styles.stick} x="-2" y="14" width="4" height="44" rx="2" />
      <circle className={styles.sweet} r="21" />
      <path
        className={styles.swirl}
        d="M0 0c3-3 8 0 6 5-2 6-11 6-14-1-3-8 4-16 13-14 11 2 15 15 8 23"
      />
      <path className={styles.shine} d="M-14-8a17 17 0 0 1 9-9" />
    </>
  );
}

/** The conversation: what is said in the channel, what is being typed, and by whom. */
function Chat(props: { readonly words: Words }) {
  const { words } = props;
  const { chat, agents } = words;
  return (
    <div className={styles.chat} data-part="chat">
      <div className={styles.rail}>
        <span className={styles.workspace}>
          <BrandSymbol className={styles.workspaceSymbol} />
        </span>
        <i className={cx(styles.railDot, styles.railOn)} />
        <i className={styles.railDot} />
        <i className={styles.railDot} />
        <i className={styles.railDot} />
      </div>
      <div className={styles.channel}>
        <div className={styles.chatHead}>
          <strong>{`# ${chat.channel}`}</strong>
          <span className={styles.members}>
            {AGENTS.map((agent) => (
              <PlanetTile key={agent} {...lookOf(agent)} className={styles.memberTile} />
            ))}
          </span>
        </div>
        <div className={styles.log} data-log="">
          <div data-part="messages">
            {MESSAGES.map((message, index) => {
              const by = message.by;
              const text = chat.messages[index] ?? "";
              return (
                <div
                  key={message.at}
                  className={cx(styles.message, index < JOINED && styles.joined)}
                  data-part={`message-${index}`}
                >
                  {by === "me" ? (
                    <span className={cx(styles.messageTile, styles.person)}>
                      {chat.me.slice(0, 1)}
                    </span>
                  ) : (
                    <PlanetTile {...lookOf(by)} className={styles.messageTile} />
                  )}
                  <div className={styles.said}>
                    <b>{by === "me" ? chat.me : agents[by]?.name}</b>
                    <p>
                      <Mentions text={text} />
                    </p>
                    {index === ORDER && (
                      <span className={styles.seen} data-part="seen">
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m3 8.5 3.2 3.2L13 4.8" />
                        </svg>
                      </span>
                    )}
                    {index === REPORT && (
                      <span className={styles.results}>
                        <span className={styles.resultPage}>
                          <i className={styles.resultBar} />
                          <Candy fruit={true} />
                          <span>{chat.page}</span>
                        </span>
                        <span className={styles.resultAd}>
                          <Candy fruit={false} />
                          <svg className={styles.playMark} viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="11" />
                            <path d="M9.5 7.8v8.4l7-4.2Z" />
                          </svg>
                          <span>{chat.ad}</span>
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={styles.composer}>
          <i className={styles.boxTop} data-part="grow" />
          <i className={styles.boxFoot} />
          <span className={styles.placeholder} data-part="empty">
            {chat.placeholder}
          </span>
          <span className={styles.draft} data-part="draft-order">
            <TypedWords name="order" text={chat.messages[ORDER] ?? ""} />
          </span>
          <span className={styles.draft} data-part="draft-reply">
            <TypedWords name="reply" text={chat.messages[REPLY] ?? ""} />
          </span>
          <span className={styles.send} data-part="send">
            <i data-part="ready" />
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 8 14 2.8 10.4 13.6 8 9.2Z" />
            </svg>
          </span>
        </div>
        <div className={styles.typing}>
          {AGENTS.map((agent) => (
            <span key={agent} data-part={`typing-${agent}`}>
              <i />
              <i />
              <i />
              {chat.typing(agents[agent]?.name ?? "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The console's board: three columns, the cards the agents carry across them, and the feed. */
function Board(props: { readonly words: Words }) {
  const { t } = useI18n();
  const { board, agents } = props.words;
  const desk = t.landing.console.window;
  const columns = [
    { key: "doing", title: desk.columns.in_progress, base: 0, most: AGENTS.length },
    { key: "review", title: desk.columns.in_review, base: 0, most: AGENTS.length },
    { key: "done", title: desk.columns.done, base: desk.done, most: CARDS.length },
  ] as const;
  return (
    <div className={styles.board} data-part="board">
      <div className={styles.boardHead}>
        <BrandSymbol className={styles.boardSymbol} />
        <strong>{desk.name}</strong>
        <span className={styles.tabs}>
          {board.tabs.map((tab, index) => (
            <span key={tab} className={cx(styles.tab, index === 0 && styles.tabOn)}>
              {tab}
              {index === 1 && (
                <i className={styles.waiting} data-part="waiting">
                  1
                </i>
              )}
            </span>
          ))}
        </span>
        <span className={styles.live}>
          <i />
          {desk.live}
        </span>
      </div>
      <div className={styles.boardField}>
        <div className={styles.columns}>
          {columns.map((column, index) => (
            <div
              key={column.key}
              className={cx(styles.column, styles[`column-${column.key}`])}
              data-spot={`column-${index}`}
            >
              <div className={styles.columnHead}>
                <span>{column.title}</span>
                <span className={styles.count}>
                  {Array.from({ length: column.most + 1 }, (_, more) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the index is the count itself.
                    <i key={more} data-part={`count-${column.key}-${more}`}>
                      {column.base + more}
                    </i>
                  ))}
                </span>
              </div>
            </div>
          ))}
          {CARDS.map((index) => {
            const card = board.cards[index];
            if (card === undefined) return null;
            return (
              <div
                key={card.number}
                // The second job comes to the first place, which is free by then.
                className={cx(styles.cardPlace, styles[`place-${index === AGAIN ? 0 : index}`])}
                data-spot={`card-${index}`}
              >
                <div data-part={`card-${index}-x`}>
                  <div data-part={`card-${index}-y`}>
                    <div className={styles.card} data-part={`card-${index}`}>
                      <span className={styles.number}>{`#${card.number}`}</span>
                      <span className={styles.cardTitle}>{card.title}</span>
                      <span className={styles.meta}>
                        {index === AGAIN ? (
                          <span className={cx(styles.badge, styles.known)}>
                            <Spark />
                            {board.known}
                          </span>
                        ) : (
                          <span className={cx(styles.badge, styles[`category-${card.category}`])}>
                            {desk.categories[card.category]}
                          </span>
                        )}
                        {index === 1 && (
                          <span className={cx(styles.badge, styles.flag)} data-part="flag">
                            {board.decision}
                          </span>
                        )}
                        <span className={styles.worker} data-part={`worker-${index}`}>
                          {(index === AGAIN ? AGENTS : [index]).map((agent) => (
                            <PlanetTile
                              key={agent}
                              {...lookOf(agent)}
                              className={styles.workerTile}
                            />
                          ))}
                        </span>
                      </span>
                      <span className={styles.progress}>
                        <i data-part={`bar-${index}`} />
                      </span>
                      <span className={styles.check} data-part={`check-${index}`}>
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m3.2 8.4 3.1 3.1 6.5-6.7" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div className={styles.squares}>
            {SQUARES.map((square) => (
              <i key={square} className={styles.square} data-part={`square-${square}`} />
            ))}
          </div>
        </div>
        <div className={styles.feed}>
          <strong>{board.feed}</strong>
          <div className={styles.lines}>
            <div data-part="feed">
              {FEED.map((_, index) => FEED.length - 1 - index).map((index) => {
                const line = board.lines[index];
                const agent = agents.findIndex((candidate) => candidate.name === line?.by);
                return (
                  <div key={index} className={styles.line} data-part={`line-${index}`} data-line="">
                    {agent < 0 ? (
                      <span className={cx(styles.lineTile, styles.person)}>
                        {line?.by.slice(0, 1)}
                      </span>
                    ) : (
                      <PlanetTile {...lookOf(agent)} className={styles.lineTile} />
                    )}
                    <b>{line?.by}</b>
                    <span>{line?.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What is learned: a point of light, beside a name, on a card, or on its way from one to another. */
function Spark() {
  return (
    <svg className={styles.sparkShape} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5c1.1 6.4 4.1 9.4 10.5 10.5C16.1 13.1 13.1 16.1 12 22.5 10.9 16.1 7.9 13.1 1.5 12 7.9 10.9 10.9 7.9 12 1.5Z" />
    </svg>
  );
}

/** One agent: its planet, its moon while it works, its name and what it is doing. */
function Agent(props: { readonly agent: (typeof AGENTS)[number]; readonly words: Words }) {
  const { agent } = props;
  const words = props.words.agents[agent];
  const look = lookOf(agent);
  return (
    <div className={cx(styles.agent, styles[`agent-${agent}`])} data-spot={`home-${agent}`}>
      <div data-part={`agent-${agent}-x`}>
        <div data-part={`agent-${agent}-y`}>
          <div
            className={cx(styles.body, styles[`tone-${look.tone}`])}
            data-part={`agent-${agent}`}
          >
            <i className={styles.halo} data-part={`halo-${agent}`} />
            {agent === 1 && <i className={styles.need} data-part="need" />}
            <div className={styles.float}>
              <i className={styles.glow} />
              <div className={styles.system}>
                <Planet {...look} />
                <div className={styles.orbit} data-part={`moon-${agent}`}>
                  <i className={styles.track} />
                  <div className={styles.spin}>
                    <i className={styles.moon} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.tag} data-part={`tag-${agent}`}>
            <span className={styles.who}>
              <b>{words?.name}</b>
              <span>{words?.title}</span>
              <i className={styles.marks}>
                {MARKS[agent].map((moment, index) => (
                  <i key={moment} data-part={`mark-${agent}-${index}`}>
                    <Spark />
                  </i>
                ))}
              </i>
            </span>
            <span className={styles.doing}>
              {DOING[agent].map((doing, index) => (
                <span
                  key={doing.from}
                  className={cx(doing.waits === true && styles.waits)}
                  data-part={`doing-${agent}-${index}`}
                >
                  <i />
                  {words?.doing[index]}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The decision a person is asked for: the question, the two pictures and the button. */
function Ask(props: { readonly words: Words }) {
  const { ask, agents } = props.words;
  return (
    <div className={styles.askPlace} data-spot="ask">
      <div className={styles.ask} data-part="ask">
        <div className={styles.askHead}>
          <PlanetTile {...lookOf(1)} className={styles.askTile} />
          <b>{agents[1]?.name}</b>
          <span className={styles.ai}>AI</span>
          <span className={cx(styles.badge, styles.askKind)}>{ask.kind}</span>
        </div>
        <strong>{ask.question}</strong>
        <div className={styles.options}>
          {ask.options.map((option, index) => (
            <div key={option} className={styles.option} data-spot={`option-${index}`}>
              <span className={cx(styles.picture, index === 1 && styles.pictureFruit)}>
                <Candy fruit={index === 1} />
                <i className={styles.pictureLine} />
                <i className={styles.pictureLine} />
              </span>
              <span className={styles.optionName}>
                <i className={styles.radio}>{index === 1 && <i data-part="chosen" />}</i>
                {option}
              </span>
              {index === 0 ? (
                <i className={styles.over} data-part="over-0" />
              ) : (
                <i className={styles.chosen} data-part="chosen" />
              )}
            </div>
          ))}
        </div>
        <span className={styles.answerSlot} data-spot="answer">
          <span className={styles.answer} data-part="answer">
            <i data-part="answerable" />
            <span>{ask.answer}</span>
          </span>
        </span>
        <span className={styles.answered} data-part="answered">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m3.2 8.4 3.1 3.1 6.5-6.7" />
          </svg>
          {ask.answered}
        </span>
      </div>
    </div>
  );
}

/** Where everything stands, read off the stage with nothing moved. */
function measure(stage: HTMLElement): Geometry {
  const origin = stage.getBoundingClientRect();
  const boxOf = (node: Element | null): DOMRect => node?.getBoundingClientRect() ?? new DOMRect();
  const spot = (name: string): Point => {
    const box = boxOf(stage.querySelector(`[data-spot="${name}"]`));
    return {
      x: box.left - origin.left + box.width / 2,
      y: box.top - origin.top + box.height / 2,
    };
  };
  const count = (selector: string): number => stage.querySelectorAll(selector).length;
  const draft = boxOf(stage.querySelector("[data-typed]")).height;
  const lines = (name: string): number[] => {
    const words = [...stage.querySelectorAll(`[data-typed="${name}"]`)];
    const top = boxOf(words[0] ?? null).top;
    return words.map((word) => Math.round((boxOf(word).top - top) / draft));
  };
  const unit = boxOf(stage.querySelector('[data-spot="unit"]')).width / 100;
  const log = stage.querySelector<HTMLElement>("[data-log]");
  const room = log?.clientHeight ?? 0;
  const faces = FACES.map((face) => spot(`face-${face}`));
  return {
    unit,
    homes: AGENTS.map((agent) => spot(`home-${agent}`)),
    lineup: AGENTS.map((agent) => spot(`lineup-${agent}`)),
    brief: AGENTS.map((agent) => spot(`brief-${agent}`)),
    hub: spot("hub"),
    reach: boxOf(stage.querySelector('[data-spot="hub"]')).width / 2,
    faces,
    roll:
      (stage.querySelector<HTMLElement>("[data-strip]")?.offsetHeight ?? 0) -
      (stage.querySelector<HTMLElement>("[data-strip] > *")?.offsetHeight ?? 0),
    add: spot("add"),
    chat: spot("chat"),
    board: spot("board"),
    cards: CARDS.map((card) => spot(`card-${card}`)),
    column: spot("column-1").x - spot("column-0").x,
    deck: boxOf(stage.querySelector('[data-spot="deck"]')).height,
    ask: spot("ask"),
    options: [spot("option-0"), spot("option-1")],
    answer: spot("answer"),
    scrolls: MESSAGES.map((_, index) => {
      const message = stage.querySelector<HTMLElement>(`[data-part="message-${index}"]`);
      return message === null ? 0 : message.offsetTop + message.offsetHeight - room;
    }),
    line: stage.querySelector<HTMLElement>("[data-line]")?.offsetHeight ?? 0,
    names: AGENTS.map((agent) => count(`[data-field="name-${agent}"] > span`)),
    titles: AGENTS.map((agent) => count(`[data-field="title-${agent}"] > span`)),
    order: lines("order"),
    reply: lines("reply"),
    draft,
  };
}

/**
 * Plays the score on the stage while it is on screen. The stage is measured and the animations
 * are made once it comes near, and again whenever its size changes, from the moment the scene
 * had reached; what the stylesheet animates by itself stops and goes with them. A part's animation
 * ends with the part's last move, so that the compositor has it alone while it runs and nobody has
 * it after; a clock of the length of a pass begins them all again.
 */
function useScore(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const stage = ref.current;
    if (stage === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations: Animation[] = [];
    let clock: Animation | undefined;
    let seen = false;
    /** How wide the stage was when it was last measured; nothing before it was near. */
    let width: number | undefined;
    let reached = 0;

    const run = () => {
      stage.dataset.play = seen && !still.matches ? "on" : "off";
      // All of them from one moment, the clock's, so that they are together to the millisecond.
      // Not `play`, which would begin one again that is over for this pass.
      const began = Number(document.timeline.currentTime) - Number(clock?.currentTime ?? 0);
      for (const animation of animations) {
        if (still.matches) {
          animation.pause();
          animation.currentTime = STILL_MS;
        } else if (seen) {
          animation.startTime = began;
        } else {
          animation.pause();
        }
      }
    };
    const again = () => {
      if (clock !== undefined) clock.currentTime = 0;
      run();
    };
    const make = () => {
      reached = Number(clock?.currentTime ?? reached) % PASS_MS;
      for (const animation of animations) animation.cancel();
      clock = undefined;
      animations = [];
      width = stage.clientWidth;
      const geometry = measure(stage);
      // Not laid out yet: its size will say when it is.
      if (!(geometry.unit > 0)) {
        delete stage.dataset.ready;
        return;
      }
      const score = agentsScore(geometry);
      for (const node of stage.querySelectorAll<HTMLElement>("[data-part]")) {
        const play = score.get(node.dataset.part ?? "");
        if (play === undefined) continue;
        // At rest before its stretch and after it.
        animations.push(
          node.animate([...play.keyframes], {
            delay: play.from * 1000,
            duration: (play.until - play.from) * 1000,
            fill: "both",
          }),
        );
      }
      clock = stage.animate([], PASS_MS);
      clock.onfinish = again;
      animations.push(clock);
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = reached;
      }
      stage.dataset.ready = "";
      run();
    };

    const watcher = new IntersectionObserver(
      ([entry]) => {
        seen = entry?.isIntersecting ?? false;
        if (seen && width === undefined) make();
        else run();
      },
      { threshold: 0.15 },
    );
    watcher.observe(stage);
    const sizes = new ResizeObserver(() => {
      if (width !== undefined && stage.clientWidth !== width) make();
    });
    sizes.observe(stage);
    // The words are measured again once the faces they are set in are here.
    let gone = false;
    document.fonts.ready.then(() => {
      if (!gone && width !== undefined) make();
    });
    still.addEventListener("change", run);
    return () => {
      gone = true;
      watcher.disconnect();
      sizes.disconnect();
      still.removeEventListener("change", run);
      for (const animation of animations) animation.cancel();
      delete stage.dataset.ready;
      delete stage.dataset.play;
    };
  }, [ref]);
}

export function AgentsStage() {
  const { t } = useI18n();
  const copy = t.landing.agents;
  const words = copy.scene;
  const stage = useRef<HTMLDivElement>(null);
  useScore(stage);
  return (
    <div className={styles.frame}>
      <div ref={stage} className={styles.stage}>
        <div className={styles.scene} aria-hidden="true">
          <PlanetShapes />
          <i className={cx(styles.spot, styles.unit)} data-spot="unit" />
          <i className={cx(styles.spot, styles.deck)} data-spot="deck" />
          <i className={cx(styles.spot, styles.spotHub)} data-spot="hub" />
          <i className={cx(styles.spot, styles.spotChat)} data-spot="chat" />
          <i className={cx(styles.spot, styles.spotBoard)} data-spot="board" />
          {AGENTS.map((agent) => (
            <i
              key={agent}
              className={cx(styles.spot, styles[`lineup-${agent}`])}
              data-spot={`lineup-${agent}`}
            />
          ))}
          {AGENTS.map((agent) => (
            <i
              key={agent}
              className={cx(styles.spot, styles[`brief-${agent}`])}
              data-spot={`brief-${agent}`}
            />
          ))}
          <div className={styles.rings}>
            <i />
            <i />
            <i />
          </div>
          <i className={styles.link} data-part="link-1" />
          <i className={styles.link} data-part="link-2" />
          <Chat words={words} />
          <Board words={words} />
          {COMETS.map((comet) => (
            <i key={comet} className={styles.comet} data-part={`comet-${comet}`} />
          ))}
          {AGENTS.map((agent) => (
            <i
              key={agent}
              className={cx(styles.seat, styles[`lineup-${agent}`])}
              data-part={`seat-${agent}`}
            />
          ))}
          <Hire words={words} />
          <div className={styles.hub} data-part="hub">
            <BrandSymbol className={styles.hubSymbol} />
          </div>
          <div className={styles.fleet} data-part="fleet">
            {AGENTS.map((agent) => (
              <Agent key={agent} agent={agent} words={words} />
            ))}
          </div>
          {AGENTS.map((agent) => (
            <div key={agent} className={styles.sparkPath} data-part={`spark-${agent}-x`}>
              <div data-part={`spark-${agent}-y`}>
                <i className={styles.spark} data-part={`spark-${agent}`}>
                  <Spark />
                </i>
              </div>
            </div>
          ))}
          <div className={styles.veil} data-part="veil" />
          <Ask words={words} />
          <div className={styles.hand} data-part="hand">
            <i data-part="ripple" />
            <PointerShape />
          </div>
        </div>
      </div>
      <p className="visually-hidden">{words.description}</p>
    </div>
  );
}
