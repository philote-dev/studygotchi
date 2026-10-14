"use client";

import { useEffect, useState } from "react";
import { STAGE_PARAMS_AT_REST, stageParamsFromSearch, type StageParams } from "@/lib/stage/params";

/**
 * The stage's URL parameters (`?perf=1`, `?rung=`) as the shell sees them.
 * SSR and the first client render use the rest values (so hydration matches);
 * the URL is read once after mount and kept for the life of the shell: header
 * navigation drops the query string but never remounts the shell.
 */
export function useStageParams(): StageParams {
  const [params, setParams] = useState<StageParams>(STAGE_PARAMS_AT_REST);
  useEffect(() => {
    setParams(stageParamsFromSearch(window.location.search));
  }, []);
  return params;
}
