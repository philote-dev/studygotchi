/**
 * How much of the outer world is still being built (steps left). The scene decrements it as the
 * chunked build runs across frames; the camera rig holds `data-edge-ready` false until it reaches
 * zero, so a capture never sees a half-built horizon. Zero whenever the outer world is off.
 */
export const outerBuildStatus = { pending: 0 }
