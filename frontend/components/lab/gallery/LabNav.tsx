"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { areaForLocation, LAB_AREAS } from "./lab-pages";
import "./lab-nav.css";

/**
 * Compact strip across the top of every lab page: home, one pill per area, the
 * current one lit. Plain anchors on purpose: every lab seeds its state from the
 * URL once (`useState(initial.x)`), so a full load is the only way a new query
 * string takes effect. Hidden when the page carries `?chrome=0` so capture
 * harnesses stay clean; `lab-nav.css` pushes the fixed lab roots down by the
 * strip's height whenever it is present.
 */
export function LabNav({ theme }: { theme?: "dark" | "light" }) {
  return (
    <Suspense fallback={null}>
      <LabNavInner theme={theme} />
    </Suspense>
  );
}

function LabNavInner({ theme }: { theme?: "dark" | "light" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (params.get("chrome") === "0") return null;
  const current = areaForLocation(pathname, params);
  const home = pathname === "/lab";
  return (
    <nav className="lab-nav" data-theme={theme} aria-label="Dev lab areas">
      <a className="lab-nav__home" href="/lab" aria-current={home ? "page" : undefined}>
        Lab
      </a>
      <span className="lab-nav__sep" aria-hidden="true" />
      {LAB_AREAS.map((area) => (
        <a key={area.id} className="lab-nav__pill" href={area.nav} aria-current={current === area.id ? "page" : undefined}>
          {area.label}
        </a>
      ))}
      <span className="lab-nav__note">preview gate · flags off · not in the product</span>
    </nav>
  );
}
