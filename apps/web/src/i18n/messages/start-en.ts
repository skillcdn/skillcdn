/** One way to start, as the start page shows it (`pages/start.tsx`). */
export interface StartStepWords {
  /** What the step is: its heading. */
  readonly title: string;
  /** Where it happens, in a few words: under the step on the map at the top, and over its heading. */
  readonly where: string;
  /** What comes of it, in a sentence or two. */
  readonly gain: string;
  /** What to have ready, each a few words. */
  readonly needs: readonly string[];
  /** What to tell the AI, as a person would say it: copied as it stands. */
  readonly say: string;
  /**
   * What the AI does once told, in one sentence: what the pack's skill does as it stands, never
   * how it is done.
   */
  readonly next: string;
}

/**
 * The start page (ADR-0129): the ways to start, from one skill to a team's console, each with
 * what to have ready, the one sentence to tell an AI and what the AI does then. It explains
 * nothing of how a step is done: that is the pack's to say, to the agent that does it.
 */
export const startEn = {
  kicker: "Getting started",
  title: "Where would you like to start?",
  lead: "Try a single skill, or go all the way to an AI team. Each step says what to have ready and gives you one sentence for your AI; your AI walks you through the rest.",
  /** The name of the row of steps at the top, for assistive technology. */
  map: "The steps at a glance",
  step: (number: number) => `Step ${number}`,
  needs: "Have ready",
  follow: "Follow along",
  /** Over the address of the skill pack, in the first step. */
  connectApp: "Connect this address to your AI app",
  /** Over the address itself: what an app asks for when a server is added. */
  address: "MCP server address",
  /** Over the commands that connect the console pack, in the second step. */
  connectAgent: "Connect the console pack to your coding agent",
  /** Over the sentence, where the step shows what to connect first. */
  say: "Then tell your AI",
  /** Over the sentence of a later step, which is told to the agent the second step connected. */
  sayToAgent: "Tell the coding agent you connected in step 2",
  copySentence: "Copy sentence",
  /** Over the line of what the AI does once told: the last move, which is not the reader's. */
  next: "Now it’s your AI’s turn",
  howToConnect: "How to connect each app",
  search: "Hand it other work, too",
  steps: {
    skills: {
      title: "Try a skill",
      where: "In the AI app you use",
      gain: "Add one address to the AI app you already use, and it makes a result the way an expert would. No SkillCDN sign-up needed.",
      needs: ["An AI app that connects tools: ChatGPT, Claude, Cursor, Codex, Gemini CLI"],
      say: "Turn this idea into a business plan for investors: a bakery that opens on Thursdays only.",
      next: "Your AI finds the skill for the job in the pack, reads it, and makes the plan that way.",
    },
    board: {
      title: "Work a board with your own AI",
      where: "On your computer",
      gain: "Bring a console up on your own computer and put a task on it: your coding agent takes it, reports, asks and hands in the result.",
      needs: [
        "A coding agent that runs commands: Claude Code, Codex",
        "Docker and git",
        "A GitHub account to sign in with",
      ],
      say: "I want to try the SkillCDN console on this computer. Bring it up with Docker and walk me through signing in.",
      next: "Your agent reads the console pack’s guide and stays with you until the console is up on this computer and you are signed in.",
    },
    employee: {
      title: "Hire your first AI employee",
      where: "On a computer that stays on",
      gain: "An AI employee signs in with an account of its own and works by itself: it is given work, reports, and asks only what is yours to decide.",
      needs: [
        "The console of step 2 or step 4",
        "A computer that stays on, with an account on it for the AI employee alone",
        "An account for it to sign in with: one of your GitHub organization, or an address of your Google Workspace",
        "A subscription of its own to its AI product: Claude Code, Codex",
      ],
      say: "I want to hire an AI employee on our console. Walk me through it, from what to prepare.",
      next: "Your agent prepares it with you in order: the employee’s account and invitation, the computer it works on, and its first task.",
    },
    team: {
      title: "Grow into your team’s console",
      where: "In your organization’s cloud",
      gain: "A console at your organization’s own address: people and AI employees work one board, and you talk to them in your messenger.",
      needs: ["An account with a cloud provider", "A domain for the console’s address"],
      say: "Set up a SkillCDN console for my organization. Our website is example.com.",
      next: "Your agent asks a few plain questions, such as how many people and how they sign in, then builds the console.",
    },
  } satisfies Record<string, StartStepWords>,
  /** Beside the second step, where the deployment has builders: the way in without an install. */
  shared: {
    title: "Rather not install anything?",
    body: "Join the builders, and a seat on the shared console is yours.",
    join: "Join the builders",
  },
  /** At the end of the page: where to turn when a step stops. */
  stuck: {
    title: "Stuck? Ask your AI.",
    body: "The pack you connected carries its documents too. Say where you are stuck, and your AI reads them and answers.",
    docs: "Read the docs",
    explore: "Browse skills",
  },
};

export type StartMessages = typeof startEn;
