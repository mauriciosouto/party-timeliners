"use client";

type Player = {
  playerId: string;
  nickname: string;
  avatar?: string | null;
  score?: number;
  turnOrder?: number | null;
};

type PlayersModalProps = {
  players: Player[];
  currentTurnPlayerId: string | null;
  myPlayerId: string | null;
  scores: Record<string, number>;
  onClose: () => void;
};

export function PlayersModal({
  players,
  currentTurnPlayerId,
  myPlayerId,
  scores,
  onClose,
}: PlayersModalProps) {
  const sorted = [...players].sort(
    (a, b) => (a.turnOrder ?? 999) - (b.turnOrder ?? 999),
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Players"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-4 rounded-t-2xl bg-white p-4 shadow-xl sm:max-h-[80vh] sm:rounded-2xl sm:overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Players</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ul className="space-y-2">
          {sorted.map((p) => {
            const isCurrentTurn = currentTurnPlayerId === p.playerId;
            const score = scores[p.playerId] ?? 0;
            return (
              <li
                key={p.playerId}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
                  isCurrentTurn ? "bg-violet-50 ring-1 ring-violet-200" : "bg-zinc-50"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {p.avatar ? (
                    <img
                      src={p.avatar}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                      width={40}
                      height={40}
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600">
                      {(p.nickname || "?")[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="truncate font-medium text-zinc-900">
                    {p.nickname}
                    {p.playerId === myPlayerId && " (you)"}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-medium text-zinc-600">
                  {score} pts
                </span>
                {isCurrentTurn && (
                  <span className="shrink-0 rounded-full bg-violet-200/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800">
                    Turn
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
