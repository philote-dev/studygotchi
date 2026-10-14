"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { LabNav } from "./LabNav";
import { LAB_AREAS, LAB_CARDS, LAB_DECISIONS, STATUS_LABEL, WHERE_ELSE, type LabCard, type LabStatus } from "./lab-pages";
import "./lab-gallery.css";

export type GalleryTheme = "dark" | "light";

export interface LabGalleryInitial {
  theme: GalleryTheme;
}

const DECISIONS_KEY = "studygotchi.lab.decisions.v1";

const STATUS_HELP: Record<LabStatus, string> = {
  gate: "built, waiting for your sign-off",
  dev: "still moving, or superseded",
  ok: "signed off",
};

/** The area after which the preview-gate tile is slotted into the card grid (it fills the row beside Gravity). */
const GATE_AFTER = "gravity";

interface DecisionState {
  done: boolean;
  choice: string | null;
}

type DecisionMap = Record<string, DecisionState>;

function readDecisions(): DecisionMap {
  try {
    const raw = window.localStorage.getItem(DECISIONS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DecisionMap) : {};
  } catch {
    return {};
  }
}

export function LabGallery({ initial }: { initial: LabGalleryInitial }) {
  const [theme, setTheme] = useState<GalleryTheme>(initial.theme);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      const url = new URL(window.location.href);
      url.searchParams.set("theme", next);
      window.history.replaceState(null, "", url);
      return next;
    });
  }, []);

  const counts = LAB_CARDS.reduce<Record<LabStatus, number>>(
    (acc, c) => {
      acc[c.status]++;
      return acc;
    },
    { gate: 0, dev: 0, ok: 0 },
  );

  return (
    <div className="lab-gallery" data-theme={theme} data-chrome="1">
      <LabNav theme={theme} />
      <header className="lab-gallery__head">
        <div className="lab-gallery__intro">
          <h1>
            <span className="lab-gallery__kicker">StudyGotchi · dev lab</span> Everything on the bench
          </h1>
          <p>
            {LAB_CARDS.length} cards in {LAB_AREAS.length} areas. Each card opens its lab with the parameters baked in; the small chips swap sky, seed or beat. The strip at the top of
            every lab jumps between areas.
          </p>
        </div>
        <div className="lab-gallery__legend" aria-label="Status pills">
          {(["gate", "dev", "ok"] as const).map((s) => (
            <span key={s} className="lab-gallery__legend-item" title={STATUS_HELP[s]}>
              <span className="lab-pill" data-status={s}>
                {STATUS_LABEL[s]}
              </span>
              <b>{counts[s]}</b>
              <small>{STATUS_HELP[s]}</small>
            </span>
          ))}
        </div>
        <button className="lab-gallery__btn" aria-pressed={theme === "light"} onClick={toggleTheme}>
          {theme === "dark" ? "Dark sky" : "Light sky"}
        </button>
      </header>

      <div className="lab-gallery__cols">
        <main className="lab-gallery__areas">
          {LAB_AREAS.map((area) => (
            <Area key={area.id} id={area.id} />
          ))}
        </main>

        <aside className="lab-gallery__side">
          <DecisionsPanel />
          <WhereElsePanel />
        </aside>
      </div>
    </div>
  );
}

function Area({ id }: { id: string }) {
  const area = LAB_AREAS.find((a) => a.id === id)!;
  const n = area.cards.length;
  return (
    <>
      <section className="lab-area" id={area.id} aria-labelledby={`area-${area.id}`} data-n={n} style={{ "--n": n } as CSSProperties}>
        <header className="lab-area__head">
          <h2 id={`area-${area.id}`}>{area.label}</h2>
          <p title={area.blurb}>{area.blurb}</p>
          <a className="lab-area__open" href={area.nav}>
            open lab ↗
          </a>
        </header>
        <div className="lab-area__grid">
          {area.cards.map((card) => (
            <Card key={card.id} card={card} />
          ))}
        </div>
      </section>
      {area.id === GATE_AFTER ? <GateTile span={Math.max(1, 6 - n)} /> : null}
    </>
  );
}

function GateTile({ span }: { span: number }) {
  return (
    <section className="lab-area lab-gate" aria-labelledby="gate-h" style={{ "--n": span } as CSSProperties}>
      <header className="lab-area__head">
        <h2 id="gate-h">Preview gate</h2>
      </header>
      <div className="lab-gate__body">
        <p>
          <strong>Nothing here is in the product.</strong> Every stage, galaxy, map and object lives under <code>/lab</code>, is not linked from the product nav, and every stage /
          surface flag defaults off.
        </p>
        <p>A capture (sheet or recording) is shown to you and signed off in the plan&apos;s rollout table before any flag flips or a product file changes its default behaviour.</p>
      </div>
    </section>
  );
}

function Card({ card }: { card: LabCard }) {
  return (
    <article className="lab-card" id={`card-${card.id}`} data-status={card.status} data-recommended={card.recommended ? "1" : undefined}>
      <a className="lab-card__thumb" href={card.href} data-fit={card.fit ?? "cover"} aria-label={`Open ${card.title}`}>
        {/* Static capture under /public; next/image would only add a loader hop for a lab page. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.thumb} alt="" width={480} decoding="async" />
        {card.recommended ? <span className="lab-card__flag">recommended</span> : null}
        <span className="lab-pill lab-card__status" data-status={card.status} title={STATUS_HELP[card.status]}>
          {STATUS_LABEL[card.status]}
        </span>
      </a>
      <div className="lab-card__body">
        <header className="lab-card__title">
          <h3 title={card.title}>
            <a href={card.href}>{card.title}</a>
          </h3>
        </header>
        <p className="lab-card__what" title={card.what}>
          {card.what}
        </p>
        <a className="lab-card__href" href={card.href} title="Open the exact deep link">
          {card.href}
        </a>
        {card.links.length ? (
          <div className="lab-card__links">
            {card.links.map((l) => (
              <a key={l.href} href={l.href} title={l.href}>
                {l.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DecisionsPanel() {
  const [state, setState] = useState<DecisionMap>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setState(readDecisions());
    setLoaded(true);
  }, []);

  const update = useCallback((id: string, patch: Partial<DecisionState>) => {
    setState((prev) => {
      const current: DecisionState = prev[id] ?? { done: false, choice: null };
      const next: DecisionMap = { ...prev, [id]: { ...current, ...patch } };
      try {
        window.localStorage.setItem(DECISIONS_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the panel still works for the session */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState({});
    try {
      window.localStorage.removeItem(DECISIONS_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  const decided = LAB_DECISIONS.filter((d) => state[d.id]?.done).length;
  const touched = Object.values(state).some((s) => s.done || s.choice);

  return (
    <section className="lab-panel" aria-labelledby="decisions-h">
      <h2 id="decisions-h">
        Decisions pending
        <small>
          {decided} of {LAB_DECISIONS.length} decided{loaded ? "" : " …"}
        </small>
        <button type="button" className="lab-panel__reset" onClick={reset} disabled={!touched} title="Clear the saved checkboxes and picks">
          reset
        </button>
      </h2>
      <ul className="lab-decisions">
        {LAB_DECISIONS.map((d) => {
          const s = state[d.id] ?? { done: false, choice: null };
          return (
            <li key={d.id} className="lab-decision" data-done={s.done ? "1" : "0"}>
              <label className="lab-decision__row" title={d.detail}>
                <input type="checkbox" checked={s.done} onChange={(e) => update(d.id, { done: e.target.checked })} />
                <span className="lab-decision__title">{d.title}</span>
              </label>
              <div className="lab-decision__options" role="radiogroup" aria-label={`${d.title}: choice`}>
                {d.options.map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={s.choice === o} className="lab-chip" onClick={() => update(d.id, { choice: s.choice === o ? null : o })}>
                    {o}
                  </button>
                ))}
                <a className="lab-decision__see" href={d.href} title={d.detail}>
                  see it ↗
                </a>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="lab-panel__foot">Saved in this browser only (localStorage). Hover a title for the detail.</p>
    </section>
  );
}

function WhereElsePanel() {
  return (
    <section className="lab-panel" aria-labelledby="where-h">
      <h2 id="where-h">Where else</h2>
      {WHERE_ELSE.map((group) => (
        <div key={group.title} className="lab-where">
          <h3>{group.title}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.path} title={item.what}>
                <strong>{item.name}</strong>
                <span className="lab-where__path">{item.path}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
