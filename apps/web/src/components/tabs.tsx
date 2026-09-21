import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import styles from "./tabs.module.css";

export interface Tab {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

/** Tabs per the ARIA pattern: arrow keys move between tabs, only the active tab is in tab order. */
export function Tabs(props: { readonly label: string; readonly tabs: readonly Tab[] }) {
  const { tabs } = props;
  const baseId = useId();
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (active === undefined) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active.id);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next !== undefined) {
      setActiveId(next.id);
      buttons.current.get(next.id)?.focus();
    }
  };

  return (
    <div>
      <div className={styles.list} role="tablist" aria-label={props.label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) {
                buttons.current.delete(tab.id);
              } else {
                buttons.current.set(tab.id, element);
              }
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === active.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === active.id ? 0 : -1}
            className={tab.id === active.id ? styles.activeTab : styles.tab}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active.id}`}
        aria-labelledby={`${baseId}-tab-${active.id}`}
        className={styles.panel}
      >
        {active.content}
      </div>
    </div>
  );
}
