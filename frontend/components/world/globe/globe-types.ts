export type SpaceTheme = "light" | "dark";
export type GlobeBiome = "ice" | "city" | "meadow" | "forest" | "volcanic" | "sand" | "coast";
export type UnitDirection = [number, number, number];

export interface CourseGlobeStats {
  reached: number;
  total: number;
  mastered: number;
  residents: number;
  sources: number;
}

export type GlobeMarkerId =
  | "ice-town"
  | "ink-world"
  | "celestial-garden"
  | "heavy-industry"
  | "future-utopia"
  | "harbor-town"
  | "academy-town"
  | "wildwest"
  | "volcanic"
  | "egyptian-desert"
  | "alpine"
  | "swamp"
  | "jungle"
  | "forest"
  | "city"
  | "whimsical-land"
  | "fractal-recursion";

export interface CourseGlobeCourse {
  id: string;
  code: string | null;
  name: string;
  biome: GlobeBiome;
  markerId?: GlobeMarkerId;
  progress: number | null;
  stats: CourseGlobeStats | null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** What `CourseGlobe` hands the stage host (`CourseGlobeStageHost`): the globe's data, its cold-load arrival and callbacks. */
export interface CourseGlobeHostProps {
  courses: CourseGlobeCourse[];
  activeCourseId: string | null;
  theme: SpaceTheme;
  /** The page's cold-load entrance (the host slides in); false when the planet arrives by the stage camera. */
  arriving: boolean;
  reducedMotion: boolean;
  onActiveCourseChange(courseId: string): void;
  onCourseTownOpen(courseId: string, anchor: ScreenPoint): void;
  onLandmarkAnchor?(anchor: ScreenPoint | null): void;
  onHoverCourse?(courseId: string | null): void;
}
