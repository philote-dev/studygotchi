"use client";

import { useEffect, useState } from "react";
import { buildConfettiPieces, confettiBurstMs } from "@/lib/world/land-outcome";
import "./land-confetti.css";

/**
 * The land's pass celebration. Every increment of `burst` throws one screen-filling burst over
 * the land (the owner counts passed results; see `landOutcome`); the pieces are removed once the
 * last one has landed, so a remount never replays an old burst.
 */
export function LandConfetti({ burst }: { burst: number }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (burst <= 0) return;
    setActive(burst);
    const timer = setTimeout(() => setActive((current) => (current === burst ? 0 : current)), confettiBurstMs());
    return () => clearTimeout(timer);
  }, [burst]);

  if (active === 0) return null;
  return <ConfettiBurst key={active} />;
}

function ConfettiBurst() {
  const pieces = buildConfettiPieces();
  return (
    <div className="land-confetti" aria-hidden data-count={pieces.length}>
      {pieces.map((piece) => (
        <i
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.height,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            background: piece.color,
            ["--sway" as string]: `${(piece.id % 2 === 0 ? 1 : -1) * (12 + (piece.id % 7) * 6)}px`,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
