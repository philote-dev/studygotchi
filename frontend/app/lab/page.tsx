import { LabGallery, type LabGalleryInitial } from "@/components/lab/gallery/LabGallery";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Dev lab index, not product UI: one gallery of every lab scene with its exact
 * deep link, the decisions waiting on Philote, and pointers to the canvases,
 * plan, ledgers and capture folders. Not linked from the product nav and
 * outside the auth matcher.
 *
 *   /lab
 *   /lab?theme=light
 */
export default async function LabIndexPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const initial: LabGalleryInitial = {
    theme: first(params.theme) === "light" ? "light" : "dark",
  };
  return <LabGallery initial={initial} />;
}
