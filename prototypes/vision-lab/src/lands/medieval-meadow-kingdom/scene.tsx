import { Draped, Ground, Layers, WaterSheet, WaterWheel, WindmillSails, useTriangleReport } from './parts'
import { LAND_SIZE, type Plan } from './plan'

/** Renders any plan: faceted ground, water, draped ribbons and fields, instanced layers, one mover. */
export function PlanScene({ plan, night }: { plan: Plan; night: boolean }) {
  const ref = useTriangleReport(plan.label)
  return (
    <group ref={ref}>
      <Ground hf={plan.ground.hf} classify={plan.ground.classify} colors={night ? plan.ground.night : plan.ground.day} />
      {plan.water ? <WaterSheet size={LAND_SIZE + 2} y={plan.water.y} color={night ? plan.water.night : plan.water.day} /> : null}
      {plan.draped.map((item) => (
        <Draped key={item.id} positions={item.positions} color={night && item.night ? item.night : item.day} castShadow={item.castShadow} />
      ))}
      <Layers layers={plan.layers} night={night} />
      {plan.movers.map((mover, index) =>
        mover.kind === 'wheel' ? (
          <WaterWheel key={index} position={mover.p} radius={mover.radius} axisYaw={mover.yaw} color={mover.color} />
        ) : (
          <WindmillSails key={index} position={mover.p} radius={mover.radius} yaw={mover.yaw} color={mover.color} />
        ),
      )}
    </group>
  )
}
