import { loginPath } from "@skillcdn/core";
import { CodeBlock } from "../components/code-block.js";
import { Tabs } from "../components/tabs.js";
import {
  Badge,
  Button,
  Callout,
  Container,
  EmptyState,
  Skeleton,
  Spinner,
} from "../components/ui.js";
import { Link } from "../navigation.js";
import { PATHS } from "../router.js";
import styles from "./states.module.css";

// Development only: every state of every page, one click away, and every building block on one
// page. The addresses exist in dev/fixtures.ts. This page is not translated and never ships.

const PAGES: readonly (readonly [string, string])[] = [
  ["/", "Landing"],
  ["/explore", "Explorer front page, with featured repositories in three states"],
  ["/terms", "A page of the deployment's own, written through the admin API"],
  ["/privacy", "A page of the deployment's own that has not been written"],
  [
    "/gh/acme/skills",
    "A repository with a manifest (its own name, description and rules), skills, documents, a skipped skill and warnings",
  ],
  ["/gh/acme/skills?q=review", "Search results"],
  ["/gh/acme/skills?q=nothing-matches-this", "Search without results"],
  ["/gh/acme/skills?skill=skills/release-notes/SKILL.md", "A skill with metadata and files"],
  ["/gh/acme/skills?skill=skills/Loud_Name/SKILL.md", "A skill with warnings for its author"],
  [
    "/gh/acme/skills?skill=team-a/review/SKILL.md",
    "A skill with inherited repository and team rules",
  ],
  ["/gh/acme/skills?skill=no-such-skill", "A skill that does not exist"],
  ["/gh/acme/skills?file=docs/markdown-showcase.md", "Rendered Markdown: every element"],
  ["/gh/acme/skills?file=skills/release-notes/SKILL.md", "A manifest: front-matter, then Markdown"],
  ["/gh/acme/skills?file=docs/long.md", "A long file, read in pages"],
  ["/gh/acme/skills?path=docs", "A directory, listed"],
  ["/gh/acme/skills?file=skills/release-notes/scripts/collect.sh", "A file that is not Markdown"],
  ["/gh/acme/skills?file=docs/huge.md", "A file that is too large"],
  ["/gh/acme/skills?file=assets/logo.png", "A file that is not text"],
  ["/gh/acme/skills?file=docs/missing.md", "A file that does not exist"],
  ["/gh/acme/skills@v2/skills/release-notes", "A tag and a sub-path"],
  ["/gh/acme/skills@4f2a9c1e7b3d5a6f8091a2b3c4d5e6f708192a3b", "A pinned commit"],
  ["/gh/acme/handbook", "Documents only, no skills"],
  ["/gh/demo/empty", "Nothing to serve"],
  ["/gh/demo/indexing", "Indexing, for as long as you look"],
  ["/gh/demo/slow", "Indexing for five seconds, then ready"],
  ["/gh/demo/failed", "Indexing failed"],
  ["/gh/acme/skills?path=team-a&q=review", "Search one group without changing the connection"],
  ["/gh/demo/long?path=skills/generated", "230 skills with paginated browsing"],
  [
    "/gh/demo/context?skill=review/SKILL.md",
    "Long inherited rules and required context with continuation",
  ],
  ["/gh/demo/long", "Long names, long texts, 230 skills, a partial index"],
  ["/gh/demo/missing", "A repository that does not exist"],
  ["/gh/acme/skills@missing-ref", "A ref that does not exist"],
  ["/gh/demo/rate-limited", "The git host is rate limiting"],
  ["/gh/demo/unavailable", "The git host cannot be reached"],
  ["/gh/demo/not-allowed", "A repository this deployment does not serve"],
  ["/gh/demo/broken-server", "An internal server error"],
  ["/gh/acme/skills.git", "Not a valid address"],
  [
    "/gh/acme",
    "The page of an account: indexed skills first, then its other repositories in pages",
  ],
  ["/gh/acme/project-2", "A listed repository, opened: indexed, and nothing to serve"],
  ["/gh/demo", "The page of a person whose repositories are in every state"],
  ["/gh/octo-dev", "The page of an account with nothing public; yours once you are signed in"],
  ["/gh/no-such-account", "An account that does not exist"],
  [
    "/gh/acme/private-skills",
    "A private repository: not found until you sign in, then with the sign-in steps in its guide",
  ],
  ["/login", "The sign-in page (signed out); signed in, it goes on to your account"],
  [
    "/login?return_to=/gh/acme/private-skills",
    "The same, on the way to a private repository: where the header's button leads from there",
  ],
  ["/login?error=denied", "A sign-in that was cancelled (signed out only)"],
  ["/login?error=expired", "A sign-in that took too long (signed out only)"],
  ["/account", "Your account: the overview once signed in, else on to the sign-in page"],
  ["/account/repositories", "Your private repositories, by where the GitHub app is installed"],
  ["/account/apps", "The apps you allowed; removing one lasts until the server restarts"],
  [
    "/account/tokens",
    "Your tokens: making one shows its secret once; what you make and remove lasts until the server restarts",
  ],
  [
    "/account/tokens?repository=/gh/acme/private-skills",
    "The same, arrived at from a private repository's page",
  ],
  [
    "/oauth/consent?request=web",
    "An app asks to read a private repository; signed out, the page offers to sign in first",
  ],
  ["/oauth/consent?request=local", "A command-line app asks, and is sent back to this computer"],
  ["/oauth/consent?request=app", "An installed app asks, and is sent back by a link of its own"],
  ["/oauth/consent?request=not-visible", "An app asks for a repository you cannot open"],
  ["/oauth/consent?request=host-down", "An app asks while the git host cannot be asked"],
  ["/oauth/consent?request=gone", "A request that has expired"],
  ["/oauth/consent", "The consent page opened without a request"],
  ["/oauth/consent?error=invalid_redirect_uri", "A request the authorization endpoint refused"],
  ["/oauth/consent?error=invalid_target", "A request that broke a rule, said to whoever built it"],
  ["/no/such/page", "Page not found"],
  ["/dev/og", "The picture behind the social-preview images (1200 x 630)"],
];

const FIXTURE_SIGN_IN_NOTE = "the header then has the account menu; sign out from it";

export function StatesPage(_props: { readonly origin: string }) {
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>States and building blocks</h1>
      <p className={styles.lead}>
        Development only. Every link opens a page in one particular state, served from fixtures. Add{" "}
        <code>?lang=ko</code> to any of them.
      </p>

      <h2 className={styles.heading}>Signing in</h2>
      {/* A real navigation, as leaving for the git host is: the fixture server signs its one
          person in at once. The page people sign in on is among the pages below. */}
      <ul className={styles.links}>
        <li>
          <a href={loginPath(PATHS.states)}>Sign in as the fixture person</a>
          <code>{FIXTURE_SIGN_IN_NOTE}</code>
        </li>
      </ul>

      <h2 className={styles.heading}>Pages</h2>
      <ul className={styles.links}>
        {PAGES.map(([href, label]) => (
          <li key={href}>
            <Link href={href}>{label}</Link>
            <code>{href}</code>
          </li>
        ))}
      </ul>

      <h2 className={styles.heading}>Buttons</h2>
      <div className={styles.row}>
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button size="sm">Small</Button>
      </div>

      <h2 className={styles.heading}>Badges</h2>
      <div className={styles.row}>
        <Badge>neutral</Badge>
        <Badge tone="point">point</Badge>
        <Badge tone="success">success</Badge>
        <Badge tone="warning">warning</Badge>
        <Badge tone="danger">danger</Badge>
      </div>

      <h2 className={styles.heading}>Callouts</h2>
      <div className={styles.stack}>
        <Callout title="Information" action={<Spinner label="Loading" />}>
          Something is happening and the page will update by itself.
        </Callout>
        <Callout tone="warning" title="Warning">
          Something is incomplete, and the reader should know.
        </Callout>
        <Callout tone="danger" title="Error" action={<Button size="sm">Try again</Button>}>
          Something failed. When trying again can help, there is a button.
        </Callout>
      </div>

      <h2 className={styles.heading}>Loading and empty</h2>
      <div className={styles.stack}>
        <Skeleton lines={4} label="Loading" />
        <EmptyState title="Nothing here">
          An explanation of why, and what to do about it.
        </EmptyState>
      </div>

      <h2 className={styles.heading}>Code and tabs</h2>
      <div className={styles.stack}>
        <CodeBlock
          label="With a label"
          code={"claude mcp add --transport http skills https://example.test/gh/acme/skills"}
          copy
        />
        <Tabs
          label="Example tabs"
          tabs={[
            { id: "one", label: "First (3)", content: <p>The first panel.</p> },
            { id: "two", label: "Second (12)", content: <p>The second panel.</p> },
          ]}
        />
      </div>
    </Container>
  );
}
