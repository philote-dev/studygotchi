/**
 * The one list of everything on the dev-lab bench. `/lab` renders it as cards,
 * `LabNav` renders the areas as pills. Pure data, no React.
 *
 * Status pills: `gate` = built, waiting for Philote's sign-off at a preview gate;
 * `dev` = still moving; `ok` = signed off (nothing carries it yet).
 */

export type LabStatus = "gate" | "dev" | "ok";

export const STATUS_LABEL: Record<LabStatus, string> = {
  gate: "Preview gate",
  dev: "Developing",
  ok: "Approved",
};

export interface LabLink {
  label: string;
  href: string;
}

export interface LabCard {
  id: string;
  title: string;
  /** One line: what a reviewer sees when the card opens. */
  what: string;
  status: LabStatus;
  /** The exact deep link, defaults baked in. */
  href: string;
  /** Under /public; 480 px wide JPEGs downscaled from the capture folders. */
  thumb: string;
  /** Strips and sheets are letterboxed instead of cropped. */
  fit?: "cover" | "contain";
  recommended?: boolean;
  links: LabLink[];
}

export interface LabArea {
  id: string;
  label: string;
  blurb: string;
  /** Where the nav pill goes. */
  nav: string;
  cards: LabCard[];
}

const GALAXY = "/lab/cosmos/galaxy";
const GALAXY_STAGE = "/lab/cosmos/galaxy-stage";
const LAYOUT = "/lab/cosmos/layout";
const GRAVITY = "/lab/cosmos/gravity";
const OBJECTS = "/lab/cosmos/objects";
const CLUSTERS = "/lab/cosmos/clusters";

export const LAB_AREAS: readonly LabArea[] = [
  {
    id: "galaxy",
    label: "Galaxy",
    blurb: "The polished galaxy (B, now lib/galaxy) beside the old lab galaxy (A) one toggle per improvement, the shared light model that dithers the profiles, and the product GalaxyLayer on its own stage canvas.",
    nav: `${GALAXY}?seed=whirlpool&theme=dark`,
    cards: [
      {
        id: "galaxy-ab",
        title: "Polish A/B",
        what: "A (lab) beside B (polished) on one clock; eight improvement toggles, hero or 112 px corner read, point and draw budgets.",
        status: "gate",
        href: `${GALAXY}?seed=whirlpool&theme=dark`,
        thumb: "/lab-gallery/galaxy-ab.jpg",
        links: [
          { label: "light", href: `${GALAXY}?seed=whirlpool&theme=light` },
          { label: "B alone, 112 px", href: `${GALAXY}?layout=b&size=corner&seed=whirlpool&theme=dark` },
          { label: "core + dust only", href: `${GALAXY}?layout=b&on=core,dust&seed=whirlpool&theme=dark` },
          { label: "seed andromeda", href: `${GALAXY}?seed=andromeda&theme=dark` },
          { label: "seed pegasus", href: `${GALAXY}?seed=pegasus&theme=dark` },
        ],
      },
      {
        id: "galaxy-light",
        title: "Light model",
        what: "B with the shared light module: Sérsic bulge, Gaussian arms, exponential skirt, dithered through palette steps. Bands vs Bayer 8 vs IGN grain.",
        status: "gate",
        href: `${GALAXY}?layout=b&light=bayer8&seed=whirlpool&theme=dark`,
        thumb: "/lab-gallery/galaxy-light.jpg",
        fit: "contain",
        links: [
          { label: "light", href: `${GALAXY}?layout=b&light=bayer8&seed=whirlpool&theme=light` },
          { label: "IGN grain", href: `${GALAXY}?layout=b&light=ign&seed=whirlpool&theme=dark` },
          { label: "old bands", href: `${GALAXY}?layout=b&light=bands&seed=whirlpool&theme=dark` },
          { label: "112 px corner", href: `${GALAXY}?layout=b&light=bayer8&size=corner&seed=whirlpool&theme=dark` },
          { label: "frozen, no chrome", href: `${GALAXY}?layout=split&light=bayer8&t=20000&chrome=0&seed=whirlpool&theme=dark` },
        ],
      },
      {
        id: "galaxy-stage",
        title: "GalaxyLayer on the stage",
        what: "S3-1: the product's GalaxyLayer alone on a transparent stage canvas (same composer, camera and uniforms as the product) with a fake course list and the ring on the current one. Approved with the galaxy rung (gate 3, 2026-10-13); kept as the tuning bench.",
        status: "ok",
        href: `${GALAXY_STAGE}?seed=whirlpool&theme=dark`,
        thumb: "/lab-gallery/galaxy-stage.jpg",
        links: [
          { label: "light, half fade", href: `${GALAXY_STAGE}?theme=light&fade=0.5` },
          { label: "IGN, 12 courses, 18.06", href: `${GALAXY_STAGE}?light=ign&courses=12&current=18.06` },
          { label: "frozen, no chrome", href: `${GALAXY_STAGE}?t=20000&chrome=0` },
          { label: "opaque backing", href: `${GALAXY_STAGE}?backing=1` },
        ],
      },
      {
        id: "clusters-c",
        title: "Clusters C · 3D blobs, marker core, hover flags",
        what: "S3-3's pick, approved at gate 3 (2026-10-13, \"I love it\"): every course is a 3D star cluster of its concepts (Plummer core, one lobe per topic, slow tumble) with the product's bead glow as its core and the ring on the current one; mixed placement (arms / halo kept as revert options). Hovering a blob raises a flag on a pixel leader that stems anti-radially from the core and rotates in 30° steps away from the bulge, other blobs, other flags and the chrome; in the product the flag is sticky (it stays on the blob most recently hovered).",
        status: "ok",
        href: `${CLUSTERS}?seed=whirlpool&theme=dark`,
        thumb: "/lab-gallery/clusters-c.jpg",
        links: [
          { label: "light", href: `${CLUSTERS}?seed=whirlpool&theme=light` },
          { label: "current flag", href: `${CLUSTERS}?flags=current&seed=whirlpool&theme=dark` },
          { label: "all flags, 12 courses", href: `${CLUSTERS}?flags=all&courses=12&seed=whirlpool&theme=dark` },
          { label: "arms", href: `${CLUSTERS}?placement=arms&seed=whirlpool&theme=dark` },
          { label: "halo", href: `${CLUSTERS}?placement=halo&seed=whirlpool&theme=dark` },
          { label: "condense 0.5", href: `${CLUSTERS}?condense=0.5&seed=whirlpool&theme=dark` },
          { label: "112 px corner", href: `${CLUSTERS}?box=112&disc=1&chrome=0&seed=whirlpool&theme=dark` },
        ],
      },
    ],
  },
  {
    id: "layout",
    label: "Outer zone",
    blurb: "The outermost ladder stop as a navigable map: subjects are arms, courses are beads, archived courses are halo globulars, friends are satellites.",
    nav: `${LAYOUT}?seed=hurt&theme=dark&courses=12`,
    cards: [
      {
        id: "layout-map",
        title: "Outer zone layout",
        what: "Twelve fake courses on a barred spiral with the ring on the current one; drag to orbit, hover a bead, click to select, breadcrumb ladder top-left.",
        status: "gate",
        href: `${LAYOUT}?seed=hurt&theme=dark&courses=12`,
        thumb: "/lab-gallery/layout.jpg",
        links: [
          { label: "light", href: `${LAYOUT}?seed=hurt&theme=light&courses=12` },
          { label: "guides", href: `${LAYOUT}?seed=hurt&theme=dark&courses=12&guides=1` },
          { label: "pre-selected 18.06", href: `${LAYOUT}?seed=hurt&theme=dark&courses=12&select=18.06` },
          { label: "3 courses", href: `${LAYOUT}?seed=hurt&theme=dark&courses=3` },
          { label: "seed pinwheel", href: `${LAYOUT}?seed=pinwheel&theme=dark&courses=12` },
        ],
      },
    ],
  },
  {
    id: "gravity",
    label: "Gravity",
    blurb: "Black hole v2, white hole and wormhole on one lensed star field, each with its beat: mastered, feed burst, birth, traverse.",
    nav: `${GRAVITY}?view=all&seed=gargantua&theme=dark`,
    cards: [
      {
        id: "gravity-all",
        title: "All three",
        what: "The three gravity objects side by side on the same sky, lens slots 0–2, controls for each in the side panel.",
        status: "dev",
        href: `${GRAVITY}?view=all&seed=gargantua&theme=dark`,
        thumb: "/lab-gallery/gravity-all.jpg",
        links: [
          { label: "light", href: `${GRAVITY}?view=all&seed=gargantua&theme=light` },
          { label: "no chrome", href: `${GRAVITY}?view=all&seed=gargantua&theme=dark&chrome=0` },
        ],
      },
      {
        id: "blackhole",
        title: "Black hole v2",
        what: "EHT proportions, far side lensed over the top, Doppler left, 1-cell photon ring, Keplerian grain, three beads. Hover to swell.",
        status: "dev",
        href: `${GRAVITY}?view=blackhole&seed=gargantua&theme=dark`,
        thumb: "/lab-gallery/blackhole.jpg",
        links: [
          { label: "light", href: `${GRAVITY}?view=blackhole&seed=gargantua&theme=light` },
          { label: "32 px read", href: `${GRAVITY}?view=blackhole&size=32&seed=gargantua&theme=dark` },
          { label: "jets", href: `${GRAVITY}?view=blackhole&jets=1&seed=gargantua&theme=dark` },
          { label: "mastered beat", href: `${GRAVITY}?view=blackhole&beat=mastered&seed=gargantua&theme=dark` },
        ],
      },
      {
        id: "whitehole",
        title: "White hole",
        what: "The mirror: banded cool core, fountain outward, inverted lens so stars bunch into a ring just outside, 4 s pulse.",
        status: "dev",
        href: `${GRAVITY}?view=whitehole&seed=gargantua&theme=dark`,
        thumb: "/lab-gallery/whitehole.jpg",
        links: [
          { label: "light", href: `${GRAVITY}?view=whitehole&seed=gargantua&theme=light` },
          { label: "birth beat", href: `${GRAVITY}?view=whitehole&beat=birth&seed=gargantua&theme=dark` },
          { label: "birth frozen 300 ms", href: `${GRAVITY}?view=whitehole&beat=birth&t=300&chrome=0&seed=gargantua&theme=dark` },
        ],
      },
      {
        id: "wormhole",
        title: "Wormhole",
        what: "A round glowing door onto a second seeded sky (render-to-texture), rim lensing, slow swirl. Traverse dollies in, whites out, swaps the skies.",
        status: "dev",
        href: `${GRAVITY}?view=wormhole&seed=gargantua&theme=dark`,
        thumb: "/lab-gallery/wormhole.jpg",
        links: [
          { label: "light", href: `${GRAVITY}?view=wormhole&seed=gargantua&theme=light` },
          { label: "traverse beat", href: `${GRAVITY}?view=wormhole&beat=traverse&seed=gargantua&theme=dark` },
          { label: "traverse frozen 700 ms", href: `${GRAVITY}?view=wormhole&beat=traverse&t=700&chrome=0&seed=gargantua&theme=dark` },
        ],
      },
    ],
  },
  {
    id: "objects",
    label: "Objects",
    blurb: "Fourteen procedural space objects (nebulae, remnants, pulsar, comet, planets, binary, clusters) at 32 / 48 / 96 px and at true relative scale.",
    nav: `${OBJECTS}?seed=orion&theme=dark`,
    cards: [
      {
        id: "objects-grid",
        title: "Objects gallery",
        what: "All fourteen in a grid with their draw budgets; click a tile to focus it with knobs, 96 / 32 px previews and the reference line.",
        status: "dev",
        href: `${OBJECTS}?seed=orion&theme=dark`,
        thumb: "/lab-gallery/objects-grid.jpg",
        links: [
          { label: "light", href: `${OBJECTS}?seed=orion&theme=light` },
          { label: "pulsar focus", href: `${OBJECTS}?focus=pulsar&seed=orion&theme=dark` },
          { label: "globular cluster", href: `${OBJECTS}?focus=cluster&p.kind=globular&seed=orion&theme=dark` },
          { label: "reroll seed", href: `${OBJECTS}?seed=carina&theme=dark` },
        ],
      },
      {
        id: "objects-tiny",
        title: "Tiny row",
        what: "Every object at 32, 48 and 96 px on one sky: the legibility pass for sky-slot sizes behind the pixel pass.",
        status: "dev",
        href: `${OBJECTS}?view=tiny&seed=orion&theme=dark`,
        thumb: "/lab-gallery/objects-tiny.jpg",
        links: [
          { label: "light", href: `${OBJECTS}?view=tiny&seed=orion&theme=light` },
          { label: "no chrome", href: `${OBJECTS}?view=tiny&seed=orion&theme=dark&chrome=0` },
        ],
      },
      {
        id: "objects-scale",
        title: "Relative scale",
        what: "One px per scene unit (1 su = one star glow); bodies above, structures below, with the binary, comet and giant repeated as bridges.",
        status: "dev",
        href: `${OBJECTS}?view=scale&seed=orion&theme=dark`,
        thumb: "/lab-gallery/objects-scale.jpg",
        links: [
          { label: "light", href: `${OBJECTS}?view=scale&seed=orion&theme=light` },
          { label: "no chrome", href: `${OBJECTS}?view=scale&seed=orion&theme=dark&chrome=0` },
        ],
      },
      {
        id: "comet-explain",
        title: "Comet · explain",
        what: "Labelled walkthrough at quarter speed: sun, dotted orbit, nucleus and coma, velocity arrows, ion tail on the anti-sun line, dust ageing white → red.",
        status: "dev",
        href: `${OBJECTS}?focus=comet&explain=1&speed=0.25&seed=orion&theme=dark`,
        thumb: "/lab-gallery/comet-explain.jpg",
        links: [
          { label: "light", href: `${OBJECTS}?focus=comet&explain=1&speed=0.25&seed=orion&theme=light` },
          { label: "plain comet", href: `${OBJECTS}?focus=comet&seed=orion&theme=dark` },
          { label: "perihelion frame", href: `${OBJECTS}?focus=comet&explain=1&p.phase0=0.75&p.dir=1&t=7500&seed=orion&theme=dark` },
        ],
      },
      {
        id: "binary-explain",
        title: "Binary star · explain",
        what: "Donor and accretor around the barycentre, Roche lobe and L1, the stream bending onto the disc's leading edge, one period for both.",
        status: "dev",
        href: `${OBJECTS}?focus=binary&explain=1&speed=0.25&seed=orion&theme=dark`,
        thumb: "/lab-gallery/binary-explain.jpg",
        links: [
          { label: "light", href: `${OBJECTS}?focus=binary&explain=1&speed=0.25&seed=orion&theme=light` },
          { label: "plain binary", href: `${OBJECTS}?focus=binary&seed=orion&theme=dark` },
        ],
      },
      {
        id: "supernova-beat",
        title: "Supernova · beat",
        what: "Focus the remnant and press Go supernova: star, white flash, ring, shell expanding into filaments with the pulsar left at the centre.",
        status: "dev",
        href: `${OBJECTS}?focus=supernova&seed=orion&theme=dark`,
        thumb: "/lab-gallery/supernova-beat.jpg",
        fit: "contain",
        links: [
          { label: "light", href: `${OBJECTS}?focus=supernova&seed=orion&theme=light` },
          { label: "frozen 400 ms in", href: `${OBJECTS}?focus=supernova&t=5000&beat=400&chrome=0&seed=orion&theme=dark` },
          { label: "veil variant", href: `${OBJECTS}?focus=supernova&p.variant=veil&seed=orion&theme=dark` },
        ],
      },
    ],
  },
];

export const LAB_CARDS: readonly LabCard[] = LAB_AREAS.flatMap((a) => a.cards);

/** Which area a lab URL belongs to (the nav pill that lights up). */
export function areaForLocation(pathname: string, _params: Pick<URLSearchParams, "get">): string | null {
  if (pathname === GALAXY || pathname === GALAXY_STAGE || pathname === CLUSTERS) return "galaxy";
  if (pathname === LAYOUT) return "layout";
  if (pathname === GRAVITY) return "gravity";
  if (pathname === OBJECTS) return "objects";
  return null;
}

export interface LabDecision {
  id: string;
  title: string;
  detail: string;
  options: readonly string[];
  /** The card that shows it. */
  href: string;
}

/**
 * Decided and removed from this list (the losing side was deleted the same day):
 * - 2026-10-13: Stage v2 over the v1 beat tables; the same day (gates 2-4) Stage v2 itself left the
 *   bench: the product's `lib/stage` + `components/stage` carry the whole ladder (planet pull-back,
 *   constellation twin, galaxy rung with sticky flags, cloud dive and rise), so `/lab/space` and the
 *   "Transitions" area went with it. Review the hops in the product (`/earth`, `/knowledge`,
 *   `?perf=1` for the frame-time overlay) and through `npm run qa:stage`.
 * - 2026-10-13 (S1, approved 2026-10-11): the WebGL stage sky over the Canvas2D `SpaceField` + corner spiral;
 *   the `sky` flag and `?stage=nosky` went with it (S5-3).
 * - 2026-10-13 (S2-2, gate 1): the planet rendered inside the persistent stage canvas ("just go with what you
 *   developed, just don't forget that it's pixelated") over the globe's own `<Canvas>` + `RenderPixelatedPass`;
 *   `CourseGlobeCanvas`, the globe's `PixelComposer` and the `planet` flag went with it. The grain is pinned
 *   (`composer-model.test.ts`) and measured (`npm run qa:stage`).
 * - 2026-10-13 (gate 2): the WebGL constellation twin over the Canvas2D constellation ("phenomenal"); the 2D
 *   drawing path and the `twin` flag went; the twin's captures are the golden tree (`npm run qa:constellation`).
 * - 2026-10-13 (gate 3): the galaxy rung with version C blobs and inka-style flags ("I love it"), the flag made
 *   sticky; the `galaxy` flag went.
 * - 2026-10-13 (gate 4): the hops on the director ("love it, keep your developments") and the cloud dive both ways;
 *   the `hop` / `world` flags, the whole flag system, the CSS route hops and the lab Stage v2 went.
 */
export const LAB_DECISIONS: readonly LabDecision[] = [
  {
    id: "galaxy-merge",
    title: "Galaxy: which polish toggles merge, and the dither mode",
    detail: "Toggles 1–8 in the A/B (core + bar, arms, dust, HII, OBAFGKM, halo, depth, life); light model Bayer grid vs IGN grain.",
    options: ["Bayer grid", "IGN grain"],
    href: `${GALAXY}?seed=whirlpool&theme=dark`,
  },
  {
    id: "outer-rest",
    title: "Outer zone: where the galaxy rests",
    detail: "Rest pose faces “you are here”, or stays seed-neutral and the ring is found by the label.",
    options: ["face you-are-here", "seed-neutral"],
    href: `${LAYOUT}?seed=hurt&theme=dark&courses=12`,
  },
  {
    id: "archived",
    title: "Archived courses",
    detail: "Drift in the halo as globulars, or stay on the arms as dim beads.",
    options: ["halo globulars", "dim beads"],
    href: `${LAYOUT}?seed=hurt&theme=dark&courses=12`,
  },
  {
    id: "friends",
    title: "Friend satellites",
    detail: "Satellite dwarfs always present, or only while the friend is online.",
    options: ["always", "online only"],
    href: `${LAYOUT}?seed=hurt&theme=dark&courses=12&guides=1`,
  },
];

const REPO = "/Users/philote/projects-local/StudyGotchi";
const CANVASES = "/Users/philote/.cursor/projects/Users-philote-projects-local-StudyGotchi/canvases";

export interface WhereElseGroup {
  title: string;
  note?: string;
  items: { name: string; path: string; what?: string }[];
}

export const WHERE_ELSE: readonly WhereElseGroup[] = [
  {
    title: "Canvases",
    note: CANVASES,
    items: [
      { name: "layer-transitions-and-surfaces-plan", path: `${CANVASES}/layer-transitions-and-surfaces-plan.canvas.tsx`, what: "beat tables, timing tokens, stage architecture, surfaces and models recipes" },
      { name: "transitions-focus-review", path: `${CANVASES}/transitions-focus-review.canvas.tsx`, what: "the transition stories under review, preview-gate column" },
      { name: "galaxy-and-black-hole-references", path: `${CANVASES}/galaxy-and-black-hole-references.canvas.tsx`, what: "five-cloud galaxy recipe, kinematics, black hole parts, lens GLSL" },
      { name: "outer-zone-layout", path: `${CANVASES}/outer-zone-layout.canvas.tsx`, what: "the outer zone as a place: arms, beads, halo, slots" },
      { name: "animation-user-stories-kanban", path: `${CANVASES}/animation-user-stories-kanban.canvas.tsx`, what: "every motion story by column: to cover, building, gate, done" },
      { name: "creative-tooling-scout-2026-10", path: `${CANVASES}/creative-tooling-scout-2026-10.canvas.tsx`, what: "which generator or MCP does what, costs" },
      { name: "world-visual-architecture-audit", path: `${CANVASES}/world-visual-architecture-audit.canvas.tsx`, what: "render stack rows, why composition comes before breadth" },
    ],
  },
  {
    title: "Plan and spec",
    items: [
      { name: "2026-10-10-layer-transitions-surfaces-models.md", path: `${REPO}/docs/superpowers/plans/2026-10-10-layer-transitions-surfaces-models.md`, what: "milestones M1–M5, task lanes, rollout and flags" },
      { name: "2026-10-10-layer-transitions-surfaces-models-design.md", path: `${REPO}/docs/superpowers/specs/2026-10-10-layer-transitions-surfaces-models-design.md`, what: "the decisions the plan builds on" },
    ],
  },
  {
    title: "Reference ledgers",
    note: `${REPO}/docs/design/world/refs/space`,
    items: [
      { name: "LEDGER.md", path: `${REPO}/docs/design/world/refs/space/LEDGER.md`, what: "galaxies, nebulae, EHT black holes, outer-zone references 01–29" },
      { name: "LEDGER-gravity.md", path: `${REPO}/docs/design/world/refs/space/LEDGER-gravity.md`, what: "M87 jet and polarisation, Gargantua rendering notes" },
      { name: "LEDGER-objects.md", path: `${REPO}/docs/design/world/refs/space/LEDGER-objects.md`, what: "one row per gallery object: take, leave" },
    ],
  },
  {
    title: "Capture folders",
    items: [
      { name: "space-lab-captures", path: "/tmp/space-lab-captures/", what: "historical: lab galaxy, black hole v1, stage v1 hops (all three eliminated 2026-10-13); ladder/ has the beat frames and sheets" },
      { name: "stage-v2", path: "/tmp/stage-v2/", what: "historical: Stage v2 lab (eliminated 2026-10-13, the product carries it) baseline vs v2 videos, frametimes, sheets/, stills/" },
      { name: "consolidation", path: "/tmp/consolidation/", what: "2026-10-13 gates 2-4: product hop videos + frame CSVs, dive key frames, sticky flag, reduced motion" },
      { name: "cosmos-captures/galaxy", path: "/tmp/cosmos-captures/galaxy/", what: "A/B stills, per-feature frames; light/ has the dither comparisons" },
      { name: "cosmos-captures/layout", path: "/tmp/cosmos-captures/layout/", what: "outer zone stills, guides, orbit video" },
      { name: "cosmos-captures/gravity", path: "/tmp/cosmos-captures/gravity/", what: "each exhibit at rest, beats as frames and webm" },
      { name: "cosmos-captures/objects", path: "/tmp/cosmos-captures/objects/", what: "grid, tiny row, scale, supernova strip; fix2/ and explain/ are the latest" },
    ],
  },
];
