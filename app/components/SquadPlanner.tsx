"use client";

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Player = { id: string; firstName: string };
type Lineup = Record<string, Player[]>;
type SaveState = "idle" | "loading" | "saving" | "saved" | "offline" | "error";

type Position = {
  id: string;
  short: string;
  label: string;
  x: number;
  y: number;
};

const positions: Position[] = [
  { id: "st", short: "ST", label: "Sturm", x: 50, y: 15 },
  { id: "lf", short: "LF", label: "Linker Flügel", x: 11, y: 34 },
  { id: "rf", short: "RF", label: "Rechter Flügel", x: 89, y: 34 },
  { id: "zm", short: "ZM", label: "Zentrales Mittelfeld", x: 41, y: 43 },
  { id: "zdm", short: "ZDM", label: "Defensives Mittelfeld", x: 59, y: 53 },
  { id: "lv", short: "LV", label: "Linke Verteidigung", x: 22, y: 68 },
  { id: "iv", short: "IV", label: "Innenverteidigung", x: 50, y: 65 },
  { id: "rv", short: "RV", label: "Rechte Verteidigung", x: 78, y: 68 },
  { id: "tw", short: "TW", label: "Torwart", x: 50, y: 88 },
];

const emptyLineup = (): Lineup =>
  Object.fromEntries(positions.map((position) => [position.id, []]));

function createPlayerId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function PlayerAvatar({ firstName, size = 28 }: { firstName: string; size?: number }) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <Image
      className="player-avatar"
      src={`/api/player-image?name=${encodeURIComponent(firstName)}`}
      alt={`${firstName}`}
      width={size}
      height={size}
      unoptimized
      onError={() => setVisible(false)}
    />
  );
}

function SortablePlayer({
  player,
  index,
  total,
  onDelete,
  onMove,
}: {
  player: Player;
  index: number;
  total: number;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: player.id });

  return (
    <li
      ref={setNodeRef}
      className={`player-row${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        className="drag-handle"
        type="button"
        aria-label={`${player.firstName} verschieben`}
        {...attributes}
        {...listeners}
      >
        <span />
        <span />
        <span />
      </button>
      <span className="player-rank">{String(index + 1).padStart(2, "0")}</span>
      <PlayerAvatar firstName={player.firstName} size={38} />
      <strong>{player.firstName}</strong>
      <div className="row-actions">
        <button
          type="button"
          aria-label={`${player.firstName} nach oben`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`${player.firstName} nach unten`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          className="delete-player"
          type="button"
          aria-label={`${player.firstName} entfernen`}
          onClick={onDelete}
        >
          ×
        </button>
      </div>
    </li>
  );
}

export default function SquadPlanner({
  embedded = false,
  lineupId = "default",
  eventTitle,
}: {
  embedded?: boolean;
  lineupId?: string;
  eventTitle?: string;
}) {
  const [lineup, setLineup] = useState<Lineup>(emptyLineup);
  const [activePosition, setActivePosition] = useState<Position | null>(null);
  const [newName, setNewName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/lineup?lineupId=${encodeURIComponent(lineupId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Aufstellung konnte nicht geladen werden.");
        if (!cancelled) {
          setLineup({ ...emptyLineup(), ...data.lineup });
          setSaveState(data.connected ? "saved" : "offline");
        }
      })
      .catch(() => {
        if (!cancelled) setSaveState("offline");
      });
    return () => {
      cancelled = true;
    };
  }, [lineupId]);

  useEffect(() => {
    if (activePosition && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
      window.setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [activePosition]);

  const activePlayers = activePosition ? lineup[activePosition.id] ?? [] : [];
  const occupiedPositions = useMemo(
    () => positions.filter((position) => (lineup[position.id] ?? []).length > 0).length,
    [lineup],
  );
  const playerCount = useMemo(
    () => Object.values(lineup).reduce((sum, players) => sum + players.length, 0),
    [lineup],
  );

  function openPosition(position: Position) {
    setNewName("");
    setMessage("");
    setActivePosition(position);
  }

  function closeDialog() {
    dialogRef.current?.close();
    setActivePosition(null);
    setMessage("");
  }

  async function persist(positionId: string, players: Player[]) {
    setSaveState("saving");
    try {
      const response = await fetch("/api/lineup", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineupId, positionId, players }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen.");
      setSaveState(data.connected ? "saved" : "offline");
    } catch {
      setSaveState("error");
      setMessage("Die Änderung ist sichtbar, konnte aber noch nicht gespeichert werden.");
    }
  }

  function updatePlayers(positionId: string, players: Player[]) {
    setLineup((current) => ({ ...current, [positionId]: players }));
    void persist(positionId, players);
  }

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePosition) return;
    const firstName = newName.trim().replace(/\s+/g, " ");
    if (!firstName) return;
    if (activePlayers.length >= 3) {
      setMessage("Pro Position sind maximal drei Personen möglich.");
      return;
    }
    if (firstName.length > 30) {
      setMessage("Bitte den Vornamen auf 30 Zeichen begrenzen.");
      return;
    }
    const players = [
      ...activePlayers,
      { id: createPlayerId(), firstName },
    ];
    setNewName("");
    setMessage("");
    updatePlayers(activePosition.id, players);
  }

  function removePlayer(playerId: string) {
    if (!activePosition) return;
    updatePlayers(
      activePosition.id,
      activePlayers.filter((player) => player.id !== playerId),
    );
  }

  function movePlayer(index: number, direction: -1 | 1) {
    if (!activePosition) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= activePlayers.length) return;
    updatePlayers(activePosition.id, arrayMove(activePlayers, index, nextIndex));
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!activePosition || !event.over || event.active.id === event.over.id) return;
    const oldIndex = activePlayers.findIndex((player) => player.id === event.active.id);
    const newIndex = activePlayers.findIndex((player) => player.id === event.over?.id);
    if (oldIndex >= 0 && newIndex >= 0) {
      updatePlayers(activePosition.id, arrayMove(activePlayers, oldIndex, newIndex));
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.assign("/login");
  }

  return (
    <div className={embedded ? "lineup-module" : "app-shell"}>
      {!embedded && <header className="site-header">
        <div className="brand-lockup">
          <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={92} height={92} priority unoptimized />
          <div>
            <p className="eyebrow">TSG TÜBINGEN · FUSSBALL</p>
            <h1>Kaderplaner</h1>
          </div>
        </div>
        <Image
          className="claim-image"
          src="/brand/allez-tsg.png"
          alt="Allez TSG"
          width={330}
          height={74}
          priority
          unoptimized
        />
        <button className="logout-button" type="button" onClick={logout}>Abmelden</button>
      </header>}

      <section className="planner-intro" aria-labelledby="planner-heading">
        <div>
          <p className="section-index">{eventTitle ? "TERMIN-AUFSTELLUNG" : "01 / AUFSTELLUNG"}</p>
          <h2 id="planner-heading">{eventTitle || "Die Mannschaft. 2026/27"}</h2>
          <p>Position anklicken, bis zu drei Vornamen eintragen und die Reihenfolge per Drag-and-drop festlegen.</p>
        </div>
        <div className="stats" aria-label="Status der Aufstellung">
          <div><strong>{occupiedPositions}</strong><span>von 9 Positionen</span></div>
          <div><strong>{playerCount}</strong><span>Spieler:innen</span></div>
          <div className={`sync-state sync-${saveState}`}>
            <i />
            <span>
              {saveState === "loading" && "Wird geladen"}
              {saveState === "saving" && "Speichert"}
              {saveState === "saved" && "Gespeichert"}
              {saveState === "offline" && "Demo-Modus"}
              {saveState === "error" && "Nicht gespeichert"}
              {saveState === "idle" && "Bereit"}
            </span>
          </div>
        </div>
      </section>

      <section className="pitch-wrap" aria-label="Fußball-Neunerfeld">
        <div className="pitch-label top">ANGRIFF</div>
        <div className="pitch-label middle">MITTELFELD</div>
        <div className="pitch-label bottom">ABWEHR</div>
        <div className="pitch-lines" aria-hidden="true">
          <div className="touchline" />
          <div className="halfway" />
          <div className="center-circle" />
          <div className="center-dot" />
          <div className="box box-top" />
          <div className="goal-box goal-box-top" />
          <div className="box box-bottom" />
          <div className="goal-box goal-box-bottom" />
        </div>

        {positions.map((position) => {
          const players = lineup[position.id] ?? [];
          return (
            <button
              className={`position-node${players.length ? " has-players" : ""}`}
              key={position.id}
              data-position={position.id}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              type="button"
              onClick={() => openPosition(position)}
              aria-label={`${position.label} bearbeiten${players.length ? `: ${players.map((p) => p.firstName).join(", ")}` : ""}`}
            >
              <span className="position-badge">{position.short}</span>
              <span className="position-names">
                {players.length === 0 ? <em>+ Name</em> : players.map((player) => (
                  <span className="position-player" key={player.id}>
                    <PlayerAvatar firstName={player.firstName} />
                    <strong>{player.firstName}</strong>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </section>

      <footer>
        <span>TSG TÜBINGEN</span>
        <span className="footer-line" />
        <span>(1)-3-4-1</span>
      </footer>

      <dialog
        ref={dialogRef}
        className="position-dialog"
        onClose={() => setActivePosition(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        {activePosition && (
          <div className="dialog-panel">
            <div className="dialog-topline" />
            <button className="close-dialog" type="button" onClick={closeDialog} aria-label="Fenster schließen">×</button>
            <p className="section-index">POSITION {activePosition.short}</p>
            <h3>{activePosition.label}</h3>
            <p className="dialog-help">Die Reihenfolge kann am Griff per Drag-and-drop angepasst werden.</p>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={activePlayers.map((player) => player.id)} strategy={verticalListSortingStrategy}>
                <ol className="player-list" aria-label={`Besetzung ${activePosition.label}`}>
                  {activePlayers.map((player, index) => (
                    <SortablePlayer
                      key={player.id}
                      player={player}
                      index={index}
                      total={activePlayers.length}
                      onDelete={() => removePlayer(player.id)}
                      onMove={(direction) => movePlayer(index, direction)}
                    />
                  ))}
                </ol>
              </SortableContext>
                </DndContext>

                {activePlayers.length < 3 ? (
              <form className="add-player-form" onSubmit={addPlayer}>
                <label htmlFor="first-name">Vorname</label>
                <div>
                  <input
                    ref={inputRef}
                    id="first-name"
                    name="firstName"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="z. B. Toni"
                    autoComplete="off"
                    maxLength={30}
                  />
                  <button type="submit" disabled={!newName.trim()}>Hinzufügen</button>
                </div>
              </form>
                ) : (
              <p className="limit-note">3 / 3 Plätze belegt</p>
                )}
                {message && <p className="form-message" role="status">{message}</p>}
          </div>
        )}
      </dialog>
    </div>
  );
}
