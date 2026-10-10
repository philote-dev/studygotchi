import type { EdgeTechnique } from './types'

// EDGE_STUB: replace with the real technique (see the swarm brief). Renders nothing yet.
function Scene() {
  return null
}

export const endless: EdgeTechnique = {
  id: 'endless',
  name: 'Endless shelf',
  lineage: '',
  pitch: '',
  Scene,
}
