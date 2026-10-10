import kirbyReference from '../../../../docs/design/world/refs/kirby-w3-pedestal.png?url'
import lighthouseReference from '../../../../docs/design/world/refs/penguin-isle-lighthouse-rock.png?url'
import type { MarkerDefinition } from '../markers'
import type { MarkerRenderState } from '../state'
import { bouquetFor } from '../scene/biomes'
import { Creature } from '../scene/Creature'
import { WorldProps } from '../scene/WorldProps'
import { MarkerViewport } from './MarkerViewport'

export function MarkerContents({ marker, state }: { marker: MarkerDefinition; state: MarkerRenderState }) {
  return (
    <>
      <WorldProps marker={marker} propCount={state.propCount} night={state.night} />
      {state.creature && <Creature />}
    </>
  )
}

export function IceReviewBoard({
  marker,
  state,
  onReady,
}: {
  marker: MarkerDefinition
  state: MarkerRenderState
  onReady: (id: string) => void
}) {
  const ice = marker.id === 'ice-town'
  const { spec } = bouquetFor(marker.id)
  const built = spec.name.length > 0
  return (
    <section className="ice-review" aria-label={`${marker.name} bouquet review`} data-built={built}>
      <div className="review-heading">
        <div>
          <span className="marker-kicker">One plinth · one terrain mass · oversized landscape</span>
          <h2>{built ? spec.name : `${marker.name} (stub)`}</h2>
        </div>
        <p>
          48 px read <b>{built ? spec.silhouette : marker.silhouette}</b>
        </p>
      </div>

      <div className="bouquet-review-grid">
        <div className="bouquet-hero">
          <MarkerViewport marker={marker} night={state.night} size={512} label="512 px construction view" onReady={() => onReady('512')}>
            <MarkerContents marker={marker} state={state} />
          </MarkerViewport>
        </div>
        <div className="bouquet-readouts">
          <div className="tiny-pair">
            <MarkerViewport marker={marker} night={state.night} size={48} label="48 px" onReady={() => onReady('48')}>
              <MarkerContents marker={marker} state={state} />
            </MarkerViewport>
            <MarkerViewport marker={marker} night={state.night} size={96} label="96 px" onReady={() => onReady('96')}>
              <MarkerContents marker={marker} state={state} />
            </MarkerViewport>
          </div>
          <div className="bouquet-notes">
            <p>{built ? spec.exaggeration : 'Category stand-ins only. This family has not been hand-built yet.'}</p>
            <ul>
              {spec.elements.map((element) => {
                const prop = marker.props.find((entry) => entry?.id === element.id)
                return (
                  <li key={element.id}>
                    {element.height} m {prop?.label ?? element.id}
                    {element.id === spec.hero ? ' (hero)' : ''}
                  </li>
                )
              })}
            </ul>
            {built && (
              <dl className="bouquet-meta">
                <div>
                  <dt>Rim</dt>
                  <dd>{spec.rim}</dd>
                </div>
                <div>
                  <dt>Nearest protected silhouette</dt>
                  <dd>{spec.closestProtected}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </div>

      {ice && (
        <div className="reference-strip">
          <figure>
            <img src={kirbyReference} alt="Kirby world three snowy pedestal structural reference" />
            <figcaption>
              <b>Composition reference</b>
              <span>One low base and one dense landscape silhouette. The sign and exact prop arrangement are excluded.</span>
            </figcaption>
          </figure>
          <figure>
            <img src={lighthouseReference} alt="Penguin Isle lighthouse on an ice headland" />
            <figcaption>
              <b>Scale reference</b>
              <span>The lighthouse is intentionally oversized against its rock, with the red cap carrying the warm signal.</span>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  )
}

export function IceSizeViews({
  marker,
  state,
  onReady,
}: {
  marker: MarkerDefinition
  state: MarkerRenderState
  onReady: (id: string) => void
}) {
  return (
    <section className="size-views" aria-label="Fixed bouquet size views">
      {([48, 96, 512] as const).map((size) => (
        <MarkerViewport key={size} marker={marker} night={state.night} size={size} label={`${size} px`} onReady={() => onReady(String(size))}>
          <MarkerContents marker={marker} state={state} />
        </MarkerViewport>
      ))}
    </section>
  )
}
