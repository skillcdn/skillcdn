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
  ["/no/such/page", "Page not found"],
  ["/dev/og", "The picture behind the social-preview images (1200 x 630)"],
];

export function StatesPage(_props: { readonly origin: string }) {
  return (
    <Container className={styles.page}>
      <h1 className={styles.title}>States and building blocks</h1>
      <p className={styles.lead}>
        Development only. Every link opens a page in one particular state, served from fixtures. Add{" "}
        <code>?lang=ko</code> to any of them.
      </p>

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
        <Badge tone="accent">accent</Badge>
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
