import { describe, expect, it } from "vitest";
import {
  diskOmega,
  diskToScreen,
  paintSpiralGalaxy,
  projectDiskPoint,
  projectSpiralPixel,
  rotateDiskAngle,
  sampleSpiralGalaxy,
  screenToDisk,
  seedSpiralPixels,
  SPIRAL_GALAXY_DEFAULTS,
  SPIRAL_PALETTE,
  spiralGalaxyPaths,
  spiralGalaxyRuns,
  spiralGalaxySvg,
} from "./spiral-galaxy";

const P = SPIRAL_PALETTE;

function count(cells: (string | null)[][]) {
  const tally = new Map<string | null, number>();
  for (const row of cells) for (const c of row) tally.set(c, (tally.get(c) ?? 0) + 1);
  return tally;
}

describe("generated pixel spiral", () => {
  const cells = paintSpiralGalaxy();
  const g = SPIRAL_GALAXY_DEFAULTS.grid;

  it("is deterministic for the same options", () => {
    expect(paintSpiralGalaxy()).toEqual(cells);
    expect(spiralGalaxySvg()).toBe(spiralGalaxySvg());
  });

  it("changes with the seed", () => {
    expect(paintSpiralGalaxy({ seed: 7 })).not.toEqual(cells);
  });

  it("paints only the spiral — no sky disc, corners stay empty", () => {
    const tally = count(cells);
    const painted = g * g - (tally.get(null) ?? 0);
    expect(cells[0][0]).toBeNull();
    expect(cells[0][g - 1]).toBeNull();
    expect(cells[g - 1][0]).toBeNull();
    expect(cells[2][2]).toBeNull();
    expect(tally.get(P.navyDeep) ?? 0).toBe(0);
    expect(tally.get(P.navy) ?? 0).toBe(0);
    expect(painted).toBeGreaterThan(180);
    expect(painted).toBeLessThan((g * g) / 2);
  });

  it("uses the arm and core families, not a navy plate", () => {
    const tally = count(cells);
    expect(tally.get(P.lilac)).toBeGreaterThan(40);
    expect(tally.get(P.gray)).toBeGreaterThan(20);
    expect(tally.get(P.cyan)).toBeGreaterThan(4);
    expect(tally.get(P.gold)).toBeGreaterThan(15);
    expect(tally.get(P.amber)).toBeGreaterThan(8);
    expect(tally.get(P.coreWhite)).toBeGreaterThan(10);
  });

  it("keeps the warm core centred", () => {
    const mid = g / 2;
    expect([P.coreWhite, P.cream, P.gold]).toContain(cells[mid][mid]);
  });

  it("merges rows into runs that tile the painted cells exactly", () => {
    const runs = spiralGalaxyRuns(cells);
    const painted = g * g - (count(cells).get(null) ?? 0);
    expect(runs.reduce((sum, r) => sum + r.w, 0)).toBe(painted);
    for (const r of runs) {
      expect(r.x + r.w).toBeLessThanOrEqual(g);
      for (let i = 0; i < r.w; i++) expect(cells[r.y][r.x + i]).toBe(r.color);
    }
  });

  it("serialises to a small transparent SVG with one path per colour", () => {
    const svg = spiralGalaxySvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${g} ${g}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toMatch(/<rect|<image|href=|data:/);
    expect(svg).not.toMatch(/<rect/);
    expect(svg.length).toBeLessThan(24_000);
    const paths = spiralGalaxyPaths();
    const colors = new Set(paths.map((p) => p.color));
    expect(colors.size).toBe(paths.length);
    expect((svg.match(/<path /g) ?? []).length).toBe(paths.length);
  });

  it("exposes a title and img role when labelled", () => {
    const svg = spiralGalaxySvg({}, "Spiral galaxy <sky>");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>Spiral galaxy sky</title>");
    expect(svg).not.toContain("aria-hidden");
  });
});

describe("disk-axis spiral rotation", () => {
  const untilted = { tilt: 0, squash: 0.6, twist: 3.7, arms: 2, seed: 0x5a1a };

  it("maps disk (0.8, 0) onto the major axis, not a screen circle", () => {
    // discScale is 0.94: nx = u * 0.94, ny = v * 0.94 * squash when tilt = 0.
    const onMajor = projectDiskPoint(0.8, 0, untilted);
    expect(onMajor.nx).toBeCloseTo(0.752, 5);
    expect(onMajor.ny).toBeCloseTo(0, 5);

    const afterQuarter = projectDiskPoint(0.8, Math.PI / 2, untilted);
    expect(afterQuarter.nx).toBeCloseTo(0, 5);
    expect(afterQuarter.ny).toBeCloseTo(0.4512, 5);
  });

  it("advances a pixel in the disk plane (inner and outer share rigid ω)", () => {
    expect(diskOmega(0.2)).toBe(1);
    expect(diskOmega(0.9)).toBe(1);
    expect(rotateDiskAngle(0.3, 0.2, 0.5)).toBeCloseTo(0.8, 10);
    expect(rotateDiskAngle(0.3, 0.9, 0.5)).toBeCloseTo(0.8, 10);
  });

  it("lets optional differential rotation run faster near the core", () => {
    expect(diskOmega(0.2, "differential")).toBeCloseTo(1 / (0.32 + 0.68 * 0.2), 10);
    expect(diskOmega(0.2, "differential")).toBeGreaterThan(diskOmega(0.9, "differential"));
    expect(rotateDiskAngle(0, 0.2, 1, "differential")).toBeGreaterThan(rotateDiskAngle(0, 0.9, 1, "differential"));
  });

  it("round-trips screen ↔ disk inside the disc", () => {
    const disk = screenToDisk(0.4, -0.15, SPIRAL_GALAXY_DEFAULTS);
    expect(disk).not.toBeNull();
    const back = diskToScreen(disk!.u, disk!.v, SPIRAL_GALAXY_DEFAULTS);
    expect(back.nx).toBeCloseTo(0.4, 8);
    expect(back.ny).toBeCloseTo(-0.15, 8);
  });

  it("keeps the tilted elliptical silhouette fixed while the pattern turns", () => {
    const rest = paintSpiralGalaxy({ diskSpin: 0 });
    const turned = paintSpiralGalaxy({ diskSpin: 1.1 });
    expect(turned).not.toEqual(rest);

    const o = SPIRAL_GALAXY_DEFAULTS;
    const g = o.grid;
    const half = g / 2;
    for (let y = 0; y < g; y++) {
      for (let x = 0; x < g; x++) {
        const nx = (x + 0.5 - half) / half;
        const ny = (y + 0.5 - half) / half;
        const { rho } = screenToDisk(nx, ny, o);
        if (rho > 1.02) {
          expect(rest[y][x]).toBeNull();
          expect(turned[y][x]).toBeNull();
        }
      }
    }
    expect(paintSpiralGalaxy({ diskSpin: Math.PI * 2 })).toEqual(rest);
  });

  it("samples the same material after a disk-axis turn", () => {
    const rho = 0.55;
    const phi = 0.4;
    const spin = 0.9;
    const rest = projectDiskPoint(rho, phi, SPIRAL_GALAXY_DEFAULTS);
    const moved = projectDiskPoint(rho, phi + spin, SPIRAL_GALAXY_DEFAULTS);
    expect(sampleSpiralGalaxy(rest.nx, rest.ny, { diskSpin: 0 })).toBe(
      sampleSpiralGalaxy(moved.nx, moved.ny, { diskSpin: spin }),
    );
  });

  it("orbits seeded pixels on the disc and lands them on the grid", () => {
    const pixels = seedSpiralPixels({ diskSpin: 0 });
    expect(pixels.length).toBeGreaterThan(180);
    const mid = pixels.find((p) => p.rho < 0.12);
    expect(mid).toBeDefined();

    const spin = Math.PI / 2;
    const projected = pixels.map((p) => projectSpiralPixel(p, spin, SPIRAL_GALAXY_DEFAULTS));
    for (const hit of projected) {
      expect(hit).not.toBeNull();
      expect(hit!.x).toBeGreaterThanOrEqual(0);
      expect(hit!.x).toBeLessThan(SPIRAL_GALAXY_DEFAULTS.grid);
      expect(hit!.y).toBeGreaterThanOrEqual(0);
      expect(hit!.y).toBeLessThan(SPIRAL_GALAXY_DEFAULTS.grid);
    }

    const rim = pixels.reduce((best, p) => (p.rho > best.rho ? p : best));
    const before = projectSpiralPixel(rim, 0, untilted)!;
    const after = projectSpiralPixel(rim, spin, untilted)!;
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
  });
});
