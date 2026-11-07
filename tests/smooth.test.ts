import { expect, test } from 'claude-code/testing'

import { WHEEL_PX, clampPx, stepToward } from '../hooks/smooth'

test('stepToward chega exatamente ao alvo, sem ultrapassar, em poucos quadros e em qualquer direção', () => {
  for (const [from, to] of [[0, WHEEL_PX], [0, 900], [500, 0], [120, 121], [0, 0], [300, 297]]) {
    let at = from
    let frames = 0

    while (at !== to) {
      const next = stepToward(at, to)

      expect(Math.abs(to - next)).toBeLessThan(Math.abs(to - at))
      expect(Math.sign(to - next) === Math.sign(to - at) || next === to).toBe(true)
      at = next
      frames += 1
      expect(frames).toBeLessThan(30)
    }
  }
})

test('um giro da roda vira vários quadros pequenos, não um salto', () => {
  const steps: number[] = []
  let at = 0

  while (at !== WHEEL_PX) {
    const next = stepToward(at, WHEEL_PX)
    steps.push(next - at)
    at = next
  }

  expect(steps.length).toBeGreaterThanOrEqual(4)
  expect(Math.max(...steps)).toBeLessThan(WHEEL_PX / 2)
})

test('clampPx segura a posição entre 0 e o máximo', () => {
  expect(clampPx(-5, 100)).toBe(0)
  expect(clampPx(250, 100)).toBe(100)
  expect(clampPx(40, 100)).toBe(40)
  expect(clampPx(40, -3)).toBe(0)
})
