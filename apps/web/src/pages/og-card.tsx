import {
  Planet,
  type PlanetKind,
  PlanetShapes,
  type PlanetTone,
} from "../components/agents-planet.js";
import { BrandLogo } from "../components/brand.js";
import { cx } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";
import styles from "./og-card.module.css";

/**
 * The three the scene of the first screen hires, with the faces they have there (`LOOKS` in
 * agents-stage.tsx), and which of the things each does in the scene it is doing on the card: all
 * three at work at once, each on its own trade.
 */
const TEAM: readonly {
  readonly kind: PlanetKind;
  readonly tone: PlanetTone;
  readonly doing: number;
}[] = [
  { kind: 0, tone: "violet", doing: 5 },
  { kind: 1, tone: "sunset", doing: 4 },
  { kind: 2, tone: "mint", doing: 6 },
];

// Development-only source for the 1200 x 630 social-preview images in public/og/. It shows what
// the first screen promises: the AI employees of the scene, at work, in the words of the language
// packs. An operator's showcase entry can bring its own picture for link previews.
export function OgCard() {
  const { t } = useI18n();
  const agents = t.landing.agents.scene.agents;
  return (
    <div className={styles.card}>
      <PlanetShapes />
      <div className={styles.team} aria-hidden="true">
        {/* The first hands the work on to the other two, as in the scene. */}
        <svg className={styles.links} viewBox="0 0 560 630" aria-hidden="true">
          <path d="M175 260 420 135" />
          <path d="M175 260 420 413" />
        </svg>
        {TEAM.map((look, index) => {
          const agent = agents[index];
          return agent === undefined ? null : (
            <div
              key={agent.handle}
              className={cx(styles.agent, styles[`agent-${index}`], styles[`halo-${look.tone}`])}
            >
              <span className={styles.planet}>
                <Planet kind={look.kind} tone={look.tone} />
              </span>
              <p className={styles.who}>
                {agent.name}
                <span>{agent.title}</span>
              </p>
              <p className={styles.doing}>
                <i />
                {agent.doing[look.doing]}
              </p>
            </div>
          );
        })}
      </div>
      <BrandLogo className={styles.brand} />
      <p className={styles.title}>
        {t.landing.title}
        <span>{t.landing.titleAccent}</span>
      </p>
      <p className={styles.tagline}>{t.landing.eyebrow}</p>
      <p className={styles.address}>skillcdn.ai</p>
    </div>
  );
}
