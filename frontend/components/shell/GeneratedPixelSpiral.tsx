"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { skyClockMs, SPIRAL_SPIN_PERIOD_MS, spiralSpinAngle } from "@/lib/space-field";
import {
  SPIRAL_GALAXY_DEFAULTS,
  SPIRAL_PALETTE,
  paintSpiralGalaxyRgba,
  projectDiskPoint,
  rotateDiskAngle,
  seedSpiralPixels,
  type SpiralGalaxyOptions,
  type SpiralPixel,
} from "@/lib/spiral-galaxy";
import { useReducedMotion } from "./useSpaceAttribute";
import "./generated-pixel-spiral.css";

export interface GeneratedPixelSpiralProps extends Omit<SpiralGalaxyOptions, "diskSpin"> {
  /** Rendered width/height in CSS pixels. */
  size?: number;
  /** Final opacity. Below ~0.5 the arms vanish against either sky. */
  opacity?: number;
  /**
   * Disk-axis spin. `true` uses one revolution per `SPIRAL_SPIN_PERIOD_MS`
   * (48 s); a number sets the period in milliseconds; `false` renders static.
   * Honours `prefers-reduced-motion: reduce` automatically.
   */
  spin?: boolean | number;
  /**
   * Accessible name. Omit for purely decorative use (default): the canvas is
   * then hidden from assistive tech with `aria-hidden`.
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_PERIOD_MS = SPIRAL_SPIN_PERIOD_MS;

const SPARKLE = new Set<string>([
  SPIRAL_PALETTE.star,
  SPIRAL_PALETTE.starBlue,
  SPIRAL_PALETTE.starWarm,
  SPIRAL_PALETTE.cyan,
  SPIRAL_PALETTE.pink,
  SPIRAL_PALETTE.coreWhite,
]);

function galaxyOptions(props: {
  grid?: number;
  seed?: number;
  arms?: number;
  tilt?: number;
  squash?: number;
  twist?: number;
  starCount?: number;
}): Required<Omit<SpiralGalaxyOptions, "diskSpin">> & { diskSpin: number } {
  return {
    ...SPIRAL_GALAXY_DEFAULTS,
    ...(props.grid !== undefined && { grid: props.grid }),
    ...(props.seed !== undefined && { seed: props.seed }),
    ...(props.arms !== undefined && { arms: props.arms }),
    ...(props.tilt !== undefined && { tilt: props.tilt }),
    ...(props.squash !== undefined && { squash: props.squash }),
    ...(props.twist !== undefined && { twist: props.twist }),
    ...(props.starCount !== undefined && { starCount: props.starCount }),
    diskSpin: 0,
  };
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  options: Required<SpiralGalaxyOptions>,
  diskSpin: number,
  view: number,
  sparkle: SpiralPixel[],
  field: HTMLCanvasElement,
) {
  const g = options.grid;
  const fieldCtx = field.getContext("2d");
  if (!fieldCtx) return;
  const rgba = paintSpiralGalaxyRgba({ ...options, diskSpin });
  // TypeScript 5.9 preserves the source buffer as ArrayBufferLike, while the
  // DOM ImageData constructor requires an ArrayBuffer-backed view.
  const pixels = new Uint8ClampedArray(rgba);
  fieldCtx.putImageData(new ImageData(pixels, g, g), 0, 0);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view, view);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(field, 0, 0, view, view);

  for (const pixel of sparkle) {
    const phi = rotateDiskAngle(pixel.phi, pixel.rho, diskSpin);
    const { nx, ny } = projectDiskPoint(pixel.rho, phi, options);
    const x = Math.round((nx * 0.5 + 0.5) * view);
    const y = Math.round((ny * 0.5 + 0.5) * view);
    if (x < 0 || y < 0 || x >= view || y >= view) continue;
    ctx.fillStyle = pixel.color;
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * Original procedurally generated pixel-art spiral galaxy. The field is
 * resampled each frame so pixels orbit the disk axis; the tilted ellipse
 * stays seated instead of tumbling as a CSS stamp.
 */
export function GeneratedPixelSpiral({
  size = 112,
  opacity = 0.68,
  spin = true,
  label,
  className,
  style,
  grid,
  seed,
  arms,
  tilt,
  squash,
  twist,
  starCount,
}: GeneratedPixelSpiralProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const period = typeof spin === "number" ? spin : DEFAULT_PERIOD_MS;
  const spinning = spin !== false && period > 0 && !reduced;

  const vars = {
    "--sg-spiral-size": `${size}px`,
    "--sg-spiral-opacity": String(opacity),
    ...style,
  } as CSSProperties;

  const classes = ["sg-pixel-spiral", spinning && "sg-pixel-spiral--live", className]
    .filter(Boolean)
    .join(" ");

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const options = galaxyOptions({ grid, seed, arms, tilt, squash, twist, starCount });
    const view = Math.max(1, Math.round(size));
    canvas.width = view;
    canvas.height = view;

    const field = document.createElement("canvas");
    field.width = options.grid;
    field.height = options.grid;

    const sparkle = seedSpiralPixels(options).filter((p) => SPARKLE.has(p.color));
    const draw = (diskSpin: number) => paintFrame(ctx, options, diskSpin, view, sparkle, field);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const allowSpin = spinning && !media.matches;

    const spinAt = (nowMs = skyClockMs()) =>
      spiralSpinAngle((nowMs * SPIRAL_SPIN_PERIOD_MS) / period, !allowSpin);
    draw(spinAt());
    if (!allowSpin) return;

    let raf = 0;
    const loop = () => {
      draw(spinAt());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size, spinning, period, grid, seed, arms, tilt, squash, twist, starCount]);

  return (
    <canvas
      ref={canvasRef}
      className={classes}
      style={vars}
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export default GeneratedPixelSpiral;
