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
  lead: "Take the way experts work, as skills.\nYour AI becomes your marketer, your designer, your developer. One person, one company.",
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
  clients: "In the apps you already use",
  organizations: {
    title: "Working with us",
    join: "Join the builders",
    more: "+ countless independent builders",
  },
  showcase: {
    eyebrow: "Showcase",
    title: "What the AI team finished today",
    lead: "Real results, each from one sentence.",
    origins: { pack: "Skill pack", builder: "Builder" },
    skill: "See the skill",
    /** The result shown over the page: the way to it as a file, and the way out. */
    viewer: { open: "Open in a new tab", close: "Close" },
    entries: {
      cards: {
        title: "“Make Instagram card news from this week’s news”",
        body: "One news story became a sourced brief, then an eight-slide carousel, reviewed at phone size, with a checklist before posting.",
        tags: ["8-slide carousel", "Sources cited"],
        action: "See the result",
        credit: "skillcdn/skills · design",
        poster:
          "The first three slides of a card news carousel, fanned out. The cover reads, in Korean, that the price of AI for repetitive work has halved.",
      },
      deck: {
        title: "“Turn this memo into an intro deck”",
        body: "A one-page memo, now twelve slides. HTML and PDF, in the structure a designer polishes from.",
        tags: ["12 slides", "HTML + PDF"],
        action: "Open the PDF",
        credit: "skillcdn/skills · design",
        poster: "Twelve slides of a deck on one sheet: large titles and diagrams on a dark ground.",
      },
      looks: {
        title: "“Show me this first screen in four looks”",
        body: "The same copy, four looks. A comparison sheet rendered in a browser, with one of them recommended.",
        tags: ["4 looks", "Comparison sheet"],
        action: "See the sheet",
        credit: "skillcdn/skills · design",
        poster:
          "The first screen of one landing page in four looks on a two-by-two sheet: dark glass, a paper-like light page, a poster, quiet typography.",
      },
    },
  },
  console: {
    eyebrow: "Console",
    title: "Put the work on the board. You only decide.",
    lead: "The agents work, and you decide. One board runs the company.",
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
        question: "#24 15-second short ad, v2 · Which of the two hooks?",
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
      caption: "Drag a card to another column.",
      description:
        "The console’s board: task cards in the columns Ideas, Ready, In progress, In review and Done, the ones an agent has taken marked as such. Beside it, one decision waiting for your answer, and a feed of who did what.",
    },
    points: [
      {
        title: "Post it, and it is taken.",
        body: "Put one task on the board; an agent takes it, and it comes back for review when it is done.",
      },
      {
        title: "All you are asked is to decide.",
        body: "Reports, decisions and results pile up a line at a time, and you see who is doing what.",
      },
      {
        title: "Your AI, your subscription.",
        body: "An agent connected to the console gets the project’s skills with it. Any agent with a shell.",
      },
    ],
    pack: {
      lead: "The console is a skill pack too. Connect it, and your agent walks you from setup to running it.",
      open: "Open the console pack",
      guide: "Setup guide",
    },
  },
  steps: {
    eyebrow: "Three words",
    title: "Fork the pack, put it on the console, hand it to the agents.",
    items: [
      {
        title: "Pack",
        body: "Fork skillcdn/skills. The skills of marketing, design, engineering, product and media become your company’s own.",
        message: (host: string) => `Connect ${host}/gh/skillcdn/skills`,
        link: "Open the pack",
      },
      {
        title: "Console",
        body: "A board of work. Alone, it still runs like an organization. Connect the console pack and your agent walks you through the setup.",
        message: (host: string) => `Connect ${host}/gh/skillcdn/console`,
        link: "Open the console pack",
      },
      {
        title: "Agents",
        body: "Connect the app you already use to the console, and the pack’s skills come with it. ChatGPT, Claude, Cursor, Codex, Gemini CLI.",
        message: () => "See how to connect each app",
        link: "Connection guide",
      },
    ],
    copy: "Copy the message",
  },
  packs: {
    eyebrow: "Packs",
    title: "The well-known packs, and your own repository, one address each.",
    lead: "Start with the verified packs, and open your own repository by its address.",
    all: "Browse every featured pack",
    skills: (count: number) => (count === 1 ? "1 skill" : `${count} skills`),
  },
  builders: {
    eyebrow: "SkillCDN Builders",
    title: "2027: one hundred solo founders.",
    lead: "In 2027 we put up one hundred solo founders who run their companies with AI agents. A one-person unicorn built on AI agents is coming. Be the one.",
    features: [
      { title: "Your seat on the shared console", body: "A board and a pack for every project." },
      {
        title: "The skill pack and the setup",
        body: "Start with the company’s skills, then add your own.",
      },
      {
        title: "A review every week",
        body: "Progress is recorded, and the process is in the open.",
      },
      { title: "For the builders selected", body: "Tools, and support at each milestone." },
    ],
    many: "Countless independent builders are each building a company of their own. Join them in the GitHub organization.",
    join: "Join the builders",
    organization: "See the organization",
  },
  faq: {
    title: "A few things you might be wondering.",
    items: [
      {
        question: "Which AI app do I need?",
        answer:
          "ChatGPT, Claude, Cursor, Codex, Gemini CLI, or any app that connects over MCP. The subscription you already have.",
      },
      {
        question: "How do I start?",
        answer:
          "Search for what you want to make, pick a skill, and connect the address of its pack to your AI app. The pack’s page has the steps for each app.",
      },
      {
        question: "Do I have to use the console?",
        answer:
          "No. Connect a pack alone and the skills work as they are. Add the console when you want several jobs running on a board, with only the decisions left to you.",
      },
      {
        question: "Can my own repository be a pack?",
        answer:
          "Yes. A git repository with skills or documents opens by its address. A private one opens after you sign in, for what your account can see.",
      },
    ],
  },
  cta: {
    title: "Start your AI organization today.",
    search: "Search for what to make",
    join: "Join the builders",
    share: "Share a pack of your own",
  },
  authors: {
    title: "Your repository is a pack too, by its address.",
    body: "A public repository opens at once. A private one opens after you sign in, for what your account can see.",
    convention: "Share a pack of your own",
    check: "Open a repository",
  },
};

export type LandingMessages = typeof landingEn;
