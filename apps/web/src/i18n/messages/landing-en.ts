/** The states of the console’s board, as the front page shows them (`console-demo.tsx`). */
export type DemoTaskState = "idea" | "ready" | "in_progress" | "in_review" | "done";
export type DemoCategory = "marketing" | "design" | "engineering" | "product" | "operations";
export type DemoPriority = "urgent" | "high" | "normal" | "low";

/** A task on the board of the front page’s console: its words, and what the badges say. */
export interface DemoTask {
  readonly number: number;
  readonly title: string;
  readonly category: DemoCategory;
  readonly priority: DemoPriority;
  readonly state: DemoTaskState;
  /** When it is due, in words; left out for none. */
  readonly due?: string;
  /** How many decisions wait on it. */
  readonly decisions?: number;
  /** Whether an agent has it. */
  readonly working?: boolean;
}

/** One moment of what the board does as it comes into view: a task moves, or a task arrives. */
export type DemoMoment =
  | {
      readonly kind: "move";
      /** The number of the task that moves. */
      readonly task: number;
      readonly to: DemoTaskState;
      /** The line the feed gains. */
      readonly feed: string;
    }
  | { readonly kind: "add"; readonly task: DemoTask; readonly feed: string };

export const landingEn = {
  eyebrow: "A one-person company, run with AI agents",
  title: "Start alone.",
  titleAccent: "The team is already here.",
  lead: "Take the way experts work, as skills.\nThe AI you already use works as your marketer, your designer and your developer.\nOne person can run a whole company.",
  search: {
    label: "What will you make?",
    placeholder: "What will you make? Card news, a short ad, a website that takes payments…",
    submit: "Search",
    chips: [
      "Instagram card news",
      "Short video ad",
      "Meeting deck",
      "Build and deploy a web app",
      "Ask our documents",
      "Competitor ad research",
    ],
  },
  clients: "Right in the AI apps you already use",
  organizations: {
    title: "Working with us",
    join: "Join the builders",
    more: "+ solo builders working with us",
  },
  showcase: {
    eyebrow: "Showcase",
    title: "Real work, made by AI",
    lead: "Each one started from a one-sentence request, and AI saw it through by the skill.",
    origins: { pack: "Skill pack", builder: "Builder" },
    skill: "See the skill",
    /** The result shown over the page: the way to it as a file, and the way out. */
    viewer: { open: "Open in a new tab", close: "Close" },
    entries: {
      ad: {
        title: "“Make a 15-second short ad for a fruit lollipop”",
        body: "The AI found a candy ad that has run for over a year in the ad library, studied it, and chose a different idea: a fruit falls, and a lollipop of the same shape falls in the same spot. It made a first frame for each shot, generated the motion, and added captions and on-set sound for a 15-second vertical video. An English ad for a fictional brand.",
        tags: ["15 s · 9:16", "5 shots", "English"],
        action: "Watch the ad",
        credit: "skillcdn/skills · marketing",
        /** What the skill needs besides the AI app; `null` for nothing. */
        requirement: "This skill needs a Higgsfield account connected.",
        poster:
          "A 15-second vertical ad with a film look. A wet strawberry lands on a wooden board by a kitchen window, and a strawberry-shaped lollipop lands in the same place. At a morning fruit market a hand lifts a peach lollipop out of a paper bag into the sun, then holds a strawberry lollipop against the light; on a linen table a hand sets a lollipop beside a bowl of fruit; a jar of fruit lollipops by the window and the brand name close it. One caption per shot.",
      },
      cards: {
        title: "“Pick a recent issue and make card news about it”",
        body: "The AI picked the Tesla Roadster reveal from this week's news. It studied a well-known news magazine's Instagram posts to set the format, drew twenty facts with checked sources from eleven articles, and made eight slides: a cover, a reader's question and its answer on each slide, and a closing. Checked on a phone screen.",
        tags: ["8 slides", "Format studied", "20 sourced facts"],
        action: "See the result",
        credit: "skillcdn/skills · design",
        requirement: null,
        poster:
          "An 18-second vertical clip of the post as a phone shows it: the magazine's feed with the eight slides swiped through one by one. The cover reads 'The Tesla Roadster is here' and 'A flying car you can buy?' in two orange boxes over a photograph of the white car in the air on jets of gas; each slide after it asks a question in a white box and answers it in orange.",
      },
      deck: {
        title: "“Turn this idea into a business plan for investors”",
        body: "A one-page idea for a morning running-crew app became a twelve-slide business plan: the problem, the solution, the revenue model, the schedule and the ask. The skill laid out the structure and exported HTML and PDF, and the video shows the plan being pitched to investors.",
        tags: ["12 slides", "HTML + PDF", "18 s pitch video"],
        action: "Open the PDF",
        credit: "skillcdn/skills · design",
        requirement: null,
        poster:
          "An 18-second video of a presenter pitching the plan to an audience, the white slides of the deck changing on the screen behind her.",
      },
      site: {
        title: "“Make a web page for our bakery”",
        body: "The reservation page of Mildo, a fictional bakery open on Thursdays only, laid out like a magazine with a large title over a full-width photograph of bread. This week's breads and how many are left, how to reserve, opening hours and common questions are all on one page. The photographs were made with AI, and the page was checked on phone and desktop screens.",
        tags: ["One page", "Phone + desktop", "Fictional shop"],
        action: "Open the page",
        credit: "skillcdn/skills · engineering",
        requirement: null,
        poster:
          "A bakery web page scrolled slowly at desktop width: a large serif title over a full-width photograph of rye loaves, a rye-brown band, four bread photographs of different sizes, a photograph of hands shaping dough beside the three steps of a reservation, the shop at dawn and a week with only Thursday marked.",
      },
    },
  },
  console: {
    eyebrow: "Console",
    title: "Put the work on the board, and just decide.",
    lead: "AI agents do the work, and you only make the calls. The whole company runs on one board.",
    window: {
      name: "My company",
      tabs: ["Board", "Roadmap", "Calendar", "Documents", "Decisions", "Feed", "Skills"],
      live: "Live",
      columns: {
        idea: "Ideas",
        ready: "Ready",
        in_progress: "In progress",
        in_review: "In review",
        done: "Done",
      },
      categories: {
        marketing: "Marketing",
        design: "Design",
        engineering: "Engineering",
        product: "Product",
        operations: "Operations",
      },
      priorities: { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" },
      decisions: (count: number) => (count === 1 ? "1 decision" : `${count} decisions`),
      worker: "AI",
      tasks: [
        {
          number: 31,
          title: "Plan the first newsletter",
          category: "marketing",
          priority: "normal",
          state: "idea",
        },
        {
          number: 29,
          title: "Switch payments from test mode to live",
          category: "engineering",
          priority: "low",
          state: "idea",
        },
        {
          number: 27,
          title: "Two card news posts this week",
          category: "marketing",
          priority: "high",
          due: "Friday",
          state: "ready",
        },
        {
          number: 26,
          title: "Four looks for the landing page",
          category: "design",
          priority: "normal",
          state: "ready",
        },
        {
          number: 25,
          title: "Competitor ads: three keywords",
          category: "product",
          priority: "normal",
          state: "ready",
        },
        {
          number: 24,
          title: "15-second short ad, v2",
          category: "marketing",
          priority: "high",
          decisions: 1,
          state: "in_progress",
          working: true,
        },
        {
          number: 23,
          title: "Add payments",
          category: "engineering",
          priority: "urgent",
          due: "Tomorrow",
          state: "in_progress",
          working: true,
        },
        {
          number: 22,
          title: "Intro deck, first draft",
          category: "design",
          priority: "normal",
          state: "in_progress",
          working: true,
        },
        {
          number: 21,
          title: "Deploy website v1",
          category: "engineering",
          priority: "high",
          state: "in_review",
          working: true,
        },
        {
          number: 20,
          title: "The manual as a document pack",
          category: "engineering",
          priority: "normal",
          state: "in_review",
          working: true,
        },
      ] satisfies readonly DemoTask[],
      done: 12,
      decision: {
        title: "Waiting for your answer",
        question: "#24 15-second short ad, v2 · Which of the two openings should we use?",
        options: [
          "A. Show the problem first, then solve it with the product",
          "B. Show the result first, then rewind through the making",
        ],
        answer: "Answer",
      },
      feed: {
        title: "Feed",
        /** When a line the board adds as it plays happened. */
        now: "Just now",
        items: [
          { when: "Just now", text: "An agent took #23 Add payments." },
          {
            when: "3 min ago",
            text: "#24 report: first frame and estimated credits are up. Waiting for a look.",
          },
          { when: "11 min ago", text: "#21 Deploy website v1 moved to In review." },
          { when: "1 hour ago", text: "#27 Two card news posts this week was added." },
        ],
      },
      /** What happens on the board as it comes into view, one moment after another. */
      play: [
        {
          kind: "move",
          task: 27,
          to: "in_progress",
          feed: "An agent took #27 Two card news posts this week.",
        },
        {
          kind: "add",
          task: {
            number: 32,
            title: "30-second product video",
            category: "marketing",
            priority: "normal",
            state: "idea",
          },
          feed: "#32 30-second product video was added.",
        },
        {
          kind: "move",
          task: 22,
          to: "in_review",
          feed: "#22 Intro deck, first draft moved to In review.",
        },
      ] satisfies readonly DemoMoment[],
      description:
        "The console’s board: task cards in the columns Ideas, Ready, In progress, In review and Done, the ones an agent has taken marked as such. Beside it, one decision waiting for your answer, and a feed of who did what.",
    },
    points: [
      {
        title: "Post a task, and AI does it",
        body: "Put a task on the board as a card. A connected AI takes it, does the work, and leaves it in Review when it is done.",
      },
      {
        title: "You check and choose",
        body: "Progress reports and results collect in the feed. A question comes only when a direction needs choosing, and the work goes on once you answer.",
      },
      {
        title: "The AI you already use",
        body: "Connect the AI you already use, such as Claude Code or Codex. It gets the skills made for this project along with it.",
      },
    ],
    pack: {
      lead: "The console comes as a skill pack too. Connect this address to your AI app, and the AI guides you from setup to everyday use.",
      open: "Open the console pack",
      guide: "Setup guide",
    },
  },
  steps: {
    eyebrow: "How to start",
    title: "Three steps, and your AI team gets to work.",
    items: [
      {
        title: "Get the skill pack",
        body: "Copy skillcdn/skills to your own GitHub (fork it). Skills for marketing, design, engineering, product and video work become your company’s own.",
        link: "Open the pack",
      },
      {
        title: "Open the console",
        body: "The board where you post work and watch it move. Connect the console pack to your AI, and it walks you through the setup from the start.",
        link: "Open the console pack",
      },
      {
        title: "Connect your AI",
        body: "Connect the pack’s address to the AI app you already use, such as ChatGPT, Claude, Cursor, Codex or Gemini CLI. It then works by the pack’s skills.",
        link: "Connection guide",
      },
    ],
  },
  packs: {
    eyebrow: "Skill packs",
    title: "Open any skill pack, or your own repository, by its address.",
    lead: "Start with the verified packs. Enter the address of your own GitHub repository, and it opens as a pack.",
    all: "See all featured packs",
    skills: (count: number) => (count === 1 ? "1 skill" : `${count} skills`),
  },
  builders: {
    eyebrow: "SkillCDN Builders",
    title: "One hundred solo founders by 2027.",
    lead: "By 2027 we are bringing together one hundred solo founders who run their companies with AI agents. A one-person unicorn built on AI agents is coming. Be the one.",
    features: [
      {
        title: "Your seat on the shared console",
        body: "A work board and a skill pack for every project.",
      },
      {
        title: "The skill pack and the setup",
        body: "Start right away with ready skills, and add the ones you need yourself.",
      },
      {
        title: "A review every week",
        body: "Progress is recorded every week, and the making is done in the open.",
      },
      {
        title: "For the builders selected",
        body: "Tools, and support each time you reach a milestone.",
      },
    ],
    many: "Many solo builders are each building a company of their own. Join them in the GitHub organization.",
    join: "Join the builders",
  },
  faq: {
    title: "Common questions before you start",
    items: [
      {
        question: "Which AI app do I need?",
        answer:
          "Any app that supports MCP, the standard for connecting outside tools to an AI app, such as ChatGPT, Claude, Cursor, Codex or Gemini CLI. The subscription you already have is all it takes.",
      },
      {
        question: "How do I start?",
        answer:
          "Search for what you want to make, pick a skill, and connect the address of the pack it is in to your AI app. The pack’s page shows how to connect each app.",
      },
      {
        question: "What should I start with?",
        answer:
          "Start with one job you need done now. Search for something you can ask for in one sentence, such as card news or an intro deck, and see the result. Once you have several jobs, connect the console pack and manage them on a board.",
      },
      {
        question: "Who are the builders?",
        answer:
          "A community of solo founders who run their companies with AI agents. Join the GitHub organization SkillCDN Builders to start with a seat on the shared console and the skill pack, with progress recorded in a weekly review.",
      },
    ],
  },
  cta: {
    title: "Start your AI team today.",
    search: "Search for what to make",
    join: "Join the builders",
    share: "Share a pack you made",
  },
  authors: {
    title: "Your repository is a pack too, by its address.",
    body: "A public repository opens at once. A private one opens after you sign in, for what your account can see.",
    convention: "Share a pack of your own",
    check: "Open a repository",
  },
};

export type LandingMessages = typeof landingEn;
