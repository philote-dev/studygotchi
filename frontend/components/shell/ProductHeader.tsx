"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useContext } from "react";
import { HopContext, useHopRung } from "@/components/stage/hop/HopProvider";
import { emit } from "@/lib/audio/events";
import { landingHeaderNav } from "@/lib/landing-copy";
import { PRODUCT_NAV } from "@/lib/world/earth-nav";
import { AccountMenu } from "./AccountMenu";

/**
 * The one header. Wordmark left, Courses | Information centre, account right.
 * Routes stay /earth and /knowledge. Landing keeps the wordmark and account
 * only (no product tabs on `/`).
 *
 * In the product shell the two pills are the course-keyed ladder on the stage
 * director (lib/stage/hop.ts): Information climbs one rung (inert at the
 * galaxy), Courses returns to the planet; hovering Information prefetches the
 * next rung. The pills stay exactly two, no sublabels, no indicator.
 */
export function ProductHeader({
  variant = "floating",
}: {
  variant?: "floating" | "static" | "landing";
}) {
  const pathname = usePathname();
  // Null on the landing page (outside the shell), where the pills are not rendered anyway.
  const hop = useContext(HopContext);
  const landing = variant === "landing";
  const items = landing ? landingHeaderNav() : PRODUCT_NAV;

  return (
    <header
      className={`sg-header${variant === "static" || landing ? " is-static" : ""}${landing ? " is-landing" : ""}`}
    >
      <div className="sg-header-lead">
        <Link href="/" className="sg-wordmark" aria-label="StudyGotchi home">
          StudyGotchi
        </Link>
      </div>

      {items.length > 0 ? (hop ? <ProductPills pathname={pathname ?? ""} /> : <LandingNav items={items} pathname={pathname ?? ""} />) : null}

      <div className="sg-header-trail">
        <AccountMenu />
      </div>
    </header>
  );
}

function ProductPills({ pathname }: { pathname: string }) {
  const hop = useContext(HopContext)!;
  const hopRung = useHopRung();
  const atTop = hopRung === "galaxy";
  return (
    <nav className="sg-nav" aria-label="Product">
      {PRODUCT_NAV.map((item) => {
        const active = item.match.test(pathname);
        const information = item.id === "information";
        const inert = information && atTop;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="sg-nav-item"
            aria-current={active ? "page" : undefined}
            aria-disabled={inert ? "true" : undefined}
            title={inert ? "You are at the top" : undefined}
            onPointerEnter={() => {
              emit({ type: "ui", kind: "hover" });
              if (information) hop.prefetchInformation();
            }}
            onFocus={() => {
              if (information) hop.prefetchInformation();
            }}
            onClick={(e) => {
              // The ladder: the pill's meaning depends on the rung, not the route.
              e.preventDefault();
              const ran = information ? hop.information() : hop.courses();
              if (ran) emit({ type: "ui", kind: "tap" });
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Outside the shell (the static site header, the landing): plain links. */
function LandingNav({ items, pathname }: { items: readonly { label: string; href: string; match?: RegExp }[]; pathname: string }) {
  return (
    <nav className="sg-nav" aria-label="Product">
      {items.map((item) => {
        const active = item.match?.test(pathname) ?? false;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="sg-nav-item"
            aria-current={active ? "page" : undefined}
            onPointerEnter={() => emit({ type: "ui", kind: "hover" })}
            onClick={(e) => {
              if (active) {
                e.preventDefault();
                return;
              }
              emit({ type: "ui", kind: "tap" });
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
