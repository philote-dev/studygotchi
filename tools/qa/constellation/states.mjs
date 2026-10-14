/**
 * The parity states. `capture.mjs` runs each on the 2D canvas today and on the
 * WebGL twin later; `compare.mjs` diffs them by this id. Anchors (`hover`,
 * `select`, `route`, `arriving`) are chosen by `window.__constellation.anchors()`
 * (the two heaviest concepts and a 4-5 node path from the first), so they are
 * fixed for a given fixture and recorded in every state JSON and the manifest.
 */

export const VIEWPORT = { width: 1440, height: 900 }
export const DPRS = [1, 2]
export const THEMES = ['dark', 'light']
export const DEFAULT_COURSES = ['8.223']
/** The draw clock every capture is frozen at (ms); dash phases, pops and pulses derive from it. */
export const FROZEN_MS = 100_000
export const ZOOMED_IN_K = 2.0
export const HOVER_K = 1.6
/** Pop phase of the arriving stars in the route state (0 = just born, 1 = settled). */
export const POP_PHASE = 0.4

/**
 * Steps run in order inside the page:
 *   { fit: true }                      instant fit of the whole sky (cluster layer, k <= 0.81)
 *   { camera: { at: <anchor>, k } }    camera centred on an anchor node at zoom k
 *   { hover: <anchor> }                real pointer move onto the node (focus set + tooltip)
 *   { select: <anchor> }               store selection (ring + forced label + concept panel)
 *   { lens: 'all' | 'mine' | 'weak' }  click the toolbar lens
 *   { files: true | false }            click the Files pill (dock over the sky)
 *   { route: true }                    route + arriving override (anchors.route / anchors.arriving)
 */
export const STATES = [
  { id: 'zoomed-out', title: 'Zoomed out: cluster names, nebula dust, backbone edges', steps: [{ fit: true }] },
  { id: 'zoomed-in', title: `Zoomed in on the hover anchor at k = ${ZOOMED_IN_K}: node labels at the 22-char budget`, steps: [{ camera: { at: 'hover', k: ZOOMED_IN_K } }] },
  { id: 'hover', title: `Hover on the anchor at k = ${HOVER_K}: focus set lit, rest at 0.14, tooltip`, steps: [{ camera: { at: 'hover', k: HOVER_K } }, { hover: 'hover' }] },
  { id: 'selected', title: 'Selected node on the fitted sky: ring glyph, forced label, concept panel', steps: [{ fit: true }, { select: 'select' }] },
  { id: 'weak-areas', title: 'Weak Areas lens: dashed [5, 9] traces at rest, weak dock', steps: [{ lens: 'weak' }, { fit: true }] },
  { id: 'files', title: 'Files pill on: the files dock over the fitted sky (canvas unchanged)', steps: [{ files: true }, { fit: true }] },
  { id: 'route', title: `Route arriving: lit path of 4-5 concepts, last two popping at phase ${POP_PHASE}`, steps: [{ route: true }, { fit: true }] },
]

export const STATE_IDS = STATES.map((state) => state.id)

/** File stem for a state at a device pixel ratio: `hover`, `hover@2x`. */
export function stateStem(stateId, dpr) {
  return dpr === 1 ? stateId : `${stateId}@${dpr}x`
}
