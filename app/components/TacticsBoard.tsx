"use client";

import Image from "next/image";
import { KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Player = { id: string; firstName: string };
type Lineup = Record<string, Player[]>;
type Point = { x: number; y: number };
export type TacticLayout = { positions: Record<string, Point>; ball: Point };

type Scenario = "attack" | "defense" | "corner";
type DragTarget = { kind: "position"; id: string } | { kind: "ball" };

const positions = [
  { id: "st", short: "ST", label: "Sturm" },
  { id: "lf", short: "LF", label: "Linker Flügel" },
  { id: "rf", short: "RF", label: "Rechter Flügel" },
  { id: "zm", short: "ZM", label: "Zentrales Mittelfeld" },
  { id: "zdm", short: "ZDM", label: "Defensives Mittelfeld" },
  { id: "lv", short: "LV", label: "Linke Verteidigung" },
  { id: "iv", short: "IV", label: "Innenverteidigung" },
  { id: "rv", short: "RV", label: "Rechte Verteidigung" },
  { id: "tw", short: "TW", label: "Torwart" },
] as const;

const scenarioLabels: Record<Scenario, string> = {
  attack: "Angriff",
  defense: "Verteidigung",
  corner: "Ecke",
};

const basePositions = {
  st: { x: 50, y: 15 }, lf: { x: 11, y: 34 }, rf: { x: 89, y: 34 },
  zm: { x: 41, y: 43 }, zdm: { x: 59, y: 53 },
  lv: { x: 22, y: 68 }, iv: { x: 50, y: 65 }, rv: { x: 78, y: 68 }, tw: { x: 50, y: 88 },
};

const defaultLayouts: Record<Scenario, TacticLayout> = {
  attack: {
    positions: {
      st: { x: 50, y: 12 }, lf: { x: 14, y: 29 }, rf: { x: 86, y: 29 },
      zm: { x: 39, y: 39 }, zdm: { x: 58, y: 49 },
      lv: { x: 18, y: 61 }, iv: { x: 50, y: 65 }, rv: { x: 82, y: 61 }, tw: { x: 50, y: 88 },
    },
    ball: { x: 50, y: 43 },
  },
  defense: {
    positions: {
      st: { x: 50, y: 28 }, lf: { x: 18, y: 44 }, rf: { x: 82, y: 44 },
      zm: { x: 40, y: 53 }, zdm: { x: 59, y: 59 },
      lv: { x: 18, y: 70 }, iv: { x: 50, y: 72 }, rv: { x: 82, y: 70 }, tw: { x: 50, y: 88 },
    },
    ball: { x: 50, y: 35 },
  },
  corner: {
    positions: {
      st: { x: 50, y: 11 }, lf: { x: 65, y: 15 }, rf: { x: 79, y: 20 },
      zm: { x: 43, y: 23 }, zdm: { x: 35, y: 39 },
      lv: { x: 24, y: 51 }, iv: { x: 49, y: 48 }, rv: { x: 72, y: 45 }, tw: { x: 50, y: 88 },
    },
    ball: { x: 92, y: 7 },
  },
};

function cloneLayout(layout: TacticLayout): TacticLayout {
  return {
    positions: Object.fromEntries(Object.entries(layout.positions).map(([id, point]) => [id, { ...point }])),
    ball: { ...layout.ball },
  };
}

function completeLayout(value: TacticLayout | undefined, scenario: Scenario) {
  const fallback = defaultLayouts[scenario];
  return {
    positions: Object.fromEntries(positions.map((position) => [
      position.id,
      value?.positions?.[position.id] ?? fallback.positions[position.id] ?? basePositions[position.id],
    ])),
    ball: value?.ball ?? fallback.ball,
  };
}

function PlayerAvatar({ firstName }: { firstName: string }) {
  return <Image className="player-avatar" src={`/api/player-image?name=${encodeURIComponent(firstName)}`} alt="" width={36} height={36} unoptimized loading="lazy" />;
}

export default function TacticsBoard({
  lineupId,
  eventTitle,
  tactics,
  onSave,
}: {
  lineupId: string;
  eventTitle: string;
  tactics: Record<string, TacticLayout>;
  onSave: (scenario: Scenario, layout: TacticLayout) => Promise<void>;
}) {
  const [scenario, setScenario] = useState<Scenario>("attack");
  const [lineup, setLineup] = useState<Lineup>({});
  const [lineupSource, setLineupSource] = useState(eventTitle);
  const [layout, setLayout] = useState(() => completeLayout(tactics.attack, "attack"));
  const [dragging, setDragging] = useState<DragTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [presenting, setPresenting] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);

  useEffect(() => {
    setLayout(completeLayout(tactics[scenario], scenario));
    layoutRef.current = completeLayout(tactics[scenario], scenario);
  }, [scenario, tactics]);

  useEffect(() => {
    let cancelled = false;
    async function loadLineup() {
      setMessage("");
      try {
        const response = await fetch(`/api/lineup?lineupId=${encodeURIComponent(lineupId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Spieltagskader konnte nicht geladen werden.");
        let nextLineup = data.lineup ?? {};
        let source = eventTitle;
        if (!Object.values(nextLineup as Lineup).some((players) => players.length)) {
          const fallbackResponse = await fetch("/api/lineup?lineupId=default", { cache: "no-store" });
          const fallback = await fallbackResponse.json();
          if (fallbackResponse.ok) {
            nextLineup = fallback.lineup ?? {};
            source = "Allgemeine Aufstellung";
          }
        }
        if (!cancelled) {
          setLineup(nextLineup);
          setLineupSource(source);
        }
      } catch (reason) {
        if (!cancelled) setMessage(reason instanceof Error ? reason.message : "Spieltagskader konnte nicht geladen werden.");
      }
    }
    void loadLineup();
    return () => { cancelled = true; };
  }, [eventTitle, lineupId]);

  useEffect(() => {
    if (!presenting) return;
    const exit = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPresenting(false);
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [presenting]);

  const activePlayers = useMemo(
    () => Object.fromEntries(positions.map((position) => [position.id, lineup[position.id]?.[0]])),
    [lineup],
  );

  function updateLayout(next: TacticLayout) {
    layoutRef.current = next;
    setLayout(next);
  }

  function pointFromPointer(event: PointerEvent) {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(94, Math.max(6, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(94, Math.max(6, ((event.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function moveTarget(target: DragTarget, point: Point) {
    const current = layoutRef.current;
    updateLayout(target.kind === "ball"
      ? { ...current, ball: point }
      : { ...current, positions: { ...current.positions, [target.id]: point } });
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, target: DragTarget) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(target);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const point = pointFromPointer(event);
    if (point) moveTarget(dragging, point);
  }

  async function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(null);
    await persist(layoutRef.current);
  }

  async function persist(next: TacticLayout) {
    setSaving(true);
    setMessage("");
    try {
      await onSave(scenario, next);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Taktik konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  function moveByKeyboard(event: KeyboardEvent<HTMLButtonElement>, target: DragTarget) {
    const delta = event.shiftKey ? 3 : 1;
    const point = target.kind === "ball" ? layoutRef.current.ball : layoutRef.current.positions[target.id];
    if (!point) return;
    const next = { ...point };
    if (event.key === "ArrowLeft") next.x -= delta;
    else if (event.key === "ArrowRight") next.x += delta;
    else if (event.key === "ArrowUp") next.y -= delta;
    else if (event.key === "ArrowDown") next.y += delta;
    else return;
    event.preventDefault();
    moveTarget(target, { x: Math.min(94, Math.max(6, next.x)), y: Math.min(94, Math.max(6, next.y)) });
    void persist(layoutRef.current);
  }

  async function resetScenario() {
    const next = cloneLayout(defaultLayouts[scenario]);
    updateLayout(next);
    await persist(next);
  }

  return <div className={`tactics-workspace${presenting ? " presenting" : ""}`}>
    <div className="tactics-toolbar">
      <div>
        <p className="section-index">TAKTIKTAFEL</p>
        <strong>{lineupSource}</strong>
      </div>
      <div className="tactics-actions">
        <button className="text-button" type="button" onClick={() => void resetScenario()}>Zurücksetzen</button>
        <button className="primary-button" type="button" onClick={() => setPresenting((current) => !current)}>{presenting ? "Präsentation beenden" : "Präsentieren"}</button>
      </div>
    </div>

    <div className="tactics-scenarios" role="tablist" aria-label="Taktik auswählen">
      {(Object.keys(scenarioLabels) as Scenario[]).map((item) => <button key={item} type="button" role="tab" aria-selected={scenario === item} className={scenario === item ? "active" : ""} onClick={() => setScenario(item)}>{scenarioLabels[item]}</button>)}
      <span className={saving ? "saving active" : "saving"} aria-live="polite">{saving ? "Speichert …" : "Gespeichert"}</span>
    </div>

    {message && <p className="coach-notice" role="status">{message}</p>}

    <div className="tactics-pitch pitch-wrap" ref={boardRef} aria-label={`${scenarioLabels[scenario]} – taktische Positionen`}>
      <div className="pitch-label top">ANGRIFF</div>
      <div className="pitch-label middle">MITTELFELD</div>
      <div className="pitch-label bottom">ABWEHR</div>
      <div className="pitch-lines" aria-hidden="true">
        <div className="touchline" /><div className="halfway" /><div className="center-circle" /><div className="center-dot" />
        <div className="box box-top" /><div className="goal-box goal-box-top" />
        <div className="box box-bottom" /><div className="goal-box goal-box-bottom" />
      </div>

      {positions.map((position) => {
        const player = activePlayers[position.id];
        const point = layout.positions[position.id] ?? basePositions[position.id];
        return <button
          className={`position-node has-players tactic-position${dragging?.kind === "position" && dragging.id === position.id ? " dragging" : ""}`}
          key={position.id}
          type="button"
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          aria-label={`${position.label}${player ? `: ${player.firstName}` : ": nicht besetzt"}. Verschieben`}
          onPointerDown={(event) => beginDrag(event, { kind: "position", id: position.id })}
          onPointerMove={moveDrag}
          onPointerUp={(event) => void finishDrag(event)}
          onPointerCancel={(event) => void finishDrag(event)}
          onKeyDown={(event) => moveByKeyboard(event, { kind: "position", id: position.id })}
        >
          <span className="position-badge">{position.short}</span>
          <span className="position-names">
            {player ? <span className="position-player"><PlayerAvatar firstName={player.firstName} /><strong>{player.firstName}</strong></span> : <em>Nicht besetzt</em>}
          </span>
        </button>;
      })}

      <button
        className={`tactics-ball${dragging?.kind === "ball" ? " dragging" : ""}`}
        type="button"
        style={{ left: `${layout.ball.x}%`, top: `${layout.ball.y}%` }}
        aria-label="Ball verschieben"
        onPointerDown={(event) => beginDrag(event, { kind: "ball" })}
        onPointerMove={moveDrag}
        onPointerUp={(event) => void finishDrag(event)}
        onPointerCancel={(event) => void finishDrag(event)}
        onKeyDown={(event) => moveByKeyboard(event, { kind: "ball" })}
      >⚽</button>
    </div>

    <p className="tactics-help">Rote Positionen und Ball mit Maus oder Finger verschieben. Mit den Pfeiltasten ist eine exakte Positionierung möglich.</p>
  </div>;
}
