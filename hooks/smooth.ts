export const WHEEL_PX = 56

const SNAP_PX = 3
const EASE = 0.4

export const clampPx = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max))

export function stepToward(current: number, target: number): number {
  const gap = target - current
  if (Math.abs(gap) <= SNAP_PX) return target

  return current + Math.round(gap * EASE)
}
