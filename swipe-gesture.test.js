"use strict";
const assert = require('node:assert')
const { SwipeAxis } = require('./swipe-gesture.js')

// A fake clock the tests advance explicitly, so "fast" and "slow" are about simulated milliseconds, not
// how quickly this script actually runs.
function makeClock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

function runWheelSequence(axis, clock, events) {
  let releaseAt = null
  const commits = []
  for (const event of events) {
    clock.advance(event.after)
    if (releaseAt !== null && clock.now() >= releaseAt) {
      const direction = axis.release()
      if (direction) commits.push(direction)
    }
    releaseAt = clock.now() + axis.feed(event.delta)
  }
  if (releaseAt !== null) {
    clock.advance(Math.max(0, releaseAt - clock.now()))
    const direction = axis.release()
    if (direction) commits.push(direction)
  }
  return commits
}

function test(name, fn) {
  try { fn(); console.log(`ok - ${name}`) }
  catch (error) { console.log(`FAIL - ${name}`); console.log('  ' + (error.message || error)); process.exitCode = 1 }
}

// ---- Symptom 1 from the user: "when I swipe quickly, it should go back to the page quickly, but the
// arrow mark stays there for a while first." A real fast flick can arrive as just one or two wheel events
// (the gesture is over before the hardware reports more than a couple of deltas) — this must still read
// as a flick, not fall back to the long hold window.
test('a single large wheel event that already clears the threshold reads as a flick', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const quiet = axis.feed(-110) // one big coalesced event, same instant as the gesture starting
  assert.strictEqual(axis.armed, true)
  assert.strictEqual(quiet, axis.quietFlickMs, `expected the short flick window, got ${quiet}ms`)
})

test('a couple of fast, large events reaching the threshold within ~20ms reads as a flick', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  axis.feed(-50)
  clock.advance(10)
  const quiet = axis.feed(-50) // accum now -100, past the 90 threshold, 10ms after the gesture started
  assert.strictEqual(axis.armed, true)
  assert.strictEqual(quiet, axis.quietFlickMs, `expected the short flick window, got ${quiet}ms`)
  assert.ok(quiet <= 60, `expected a snappy flick release, got ${quiet}ms`)
})

// ---- Symptom 2 from the user: "if I wanted to do it slowly and not lift my finger, it goes back quickly
// instead of waiting." A slow, deliberate drag — even one with an early, slightly-quick sub-interval —
// must not latch onto "fast" from one early sample and ignore how slow the gesture is overall.
test('a slow, deliberate drag spread over ~900ms reads as a hold, not a flick', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  let quiet
  // 18 small events, ~50ms apart, 5px each => 90px over ~900ms: a real unhurried drag to the threshold.
  for (let i = 0; i < 18; i += 1) {
    quiet = axis.feed(-5)
    clock.advance(50)
  }
  assert.strictEqual(axis.armed, true)
  assert.strictEqual(quiet, axis.quietHoldMs, `expected the long hold window, got ${quiet}ms`)
})

test('a slow drag with one early quick sub-interval still reads as a hold once enough slow time has passed', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  axis.feed(-20) // a slightly brisk first nudge
  clock.advance(5)
  let quiet
  // ...followed by a genuinely slow, deliberate crawl the rest of the way to the threshold.
  for (let i = 0; i < 14; i += 1) {
    quiet = axis.feed(-5)
    clock.advance(50)
  }
  assert.strictEqual(axis.armed, true)
  assert.strictEqual(quiet, axis.quietHoldMs, `expected the long hold window once the drag reads as slow overall, got ${quiet}ms`)
})

test('a fast flick with tiny trailing wheel events still reads as a flick, not a delayed hold', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  axis.feed(-60)
  clock.advance(10)
  axis.feed(-30) // passes the threshold quickly
  clock.advance(180)
  const quiet = axis.feed(-2) // the hardware's tiny trailing wheel event as the finger settles
  assert.strictEqual(axis.armed, true)
  assert.strictEqual(quiet, axis.quietFlickMs, `expected the short flick window even after the trailing noise, got ${quiet}ms`)
})

test('one fast flick with multiple momentum packets commits only one page', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWheelSequence(axis, clock, [
    { after: 0, delta: -110 },
    { after: 16, delta: -110 },
    { after: 16, delta: -110 },
    { after: 16, delta: -110 },
    { after: 202, delta: -110 }, // delayed momentum packet after the first quiet callback
  ])
  assert.deepStrictEqual(commits, [-1], `expected one back navigation, got ${commits.length}`)
})

test('a brief wheel-event gap during a deliberate held swipe does not commit', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWheelSequence(axis, clock, [
    { after: 0, delta: -20 },
    { after: 50, delta: -20 },
    { after: 50, delta: -20 },
    { after: 50, delta: -20 },
    { after: 50, delta: -20 }, // reaches the threshold as a deliberate, slow drag
    { after: 100, delta: 50 }, // reverses before the held gesture's release window expires
  ])
  assert.deepStrictEqual(commits, [], 'the swipe should still be reversible during a short event gap')
})

test('a slow swipe remains controllable across 300ms gaps between wheel updates', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now, quietMs: 350, quietHoldMs: 450 })
  const commits = runWheelSequence(axis, clock, [
    { after: 0, delta: -30 },
    { after: 300, delta: -30 },
    { after: 300, delta: -30 }, // crosses threshold slowly, still under finger control
    { after: 300, delta: 100 }, // reverses before the longer hold-release window
  ])
  assert.deepStrictEqual(commits, [], 'slow progress should remain reversible until the longer quiet window expires')
})

test('reversing direction mid-hold cancels the pending decision back to nothing', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  axis.feed(-40)
  clock.advance(80)
  axis.feed(-40)
  clock.advance(80)
  axis.feed(90) // reverse direction before the quiet timer resolves
  assert.strictEqual(axis.armed, false)
  assert.strictEqual(axis.release(), 0)
})

// ---- Baseline behaviors that must keep working alongside the fix above.
test('a drag that never reaches the threshold is unarmed and reports the short uncommitted window', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const quiet = axis.feed(-40)
  assert.strictEqual(axis.armed, false)
  assert.strictEqual(quiet, axis.quietMs)
})

test('release() past the back threshold commits back, and resets state for the next gesture', () => {
  const axis = new SwipeAxis({ now: () => 0 })
  axis.feed(-120)
  assert.strictEqual(axis.release(), -1)
  assert.strictEqual(axis.accum, 0)
})

test('release() past the forward threshold commits forward', () => {
  const axis = new SwipeAxis({ now: () => 0 })
  axis.feed(120)
  assert.strictEqual(axis.release(), 1)
})

test('reversing back under the threshold before release springs back (does nothing)', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  axis.feed(-100) // armed, past threshold
  clock.advance(30)
  axis.feed(60) // reverses most of the way back; net accum now -40, well under threshold
  assert.strictEqual(axis.armed, false)
  assert.strictEqual(axis.release(), 0)
})

test('travel is clamped to threshold * 1.3 so it does not feel pinned at the edge', () => {
  const axis = new SwipeAxis({ now: () => 0, threshold: 90 })
  axis.feed(-500)
  assert.strictEqual(axis.accum, -117)
})

// ---- Symptom from the user: "when I flick quickly, the arrow stays stuck for a couple of seconds, then
// it goes back/forward." A real trackpad keeps sending small, decaying momentum wheel events for 1-2s after
// the fingers lift. The caller re-arms its release timer with whatever feed() returns on every event, so if
// each trailing event pushes the release out by another quiet window, the commit can't fire until the
// momentum stream finally dries up. These tests use a simulated timer that fires release() exactly when the
// returned quiet window expires (unlike runWheelSequence above, which only releases when the next event
// happens to arrive), so a delayed commit shows up as a late commit time.
function runWithTimer(axis, clock, events) {
  let releaseAt = null
  const commits = []
  const fire = () => {
    const direction = axis.release()
    if (direction) commits.push({ direction, at: clock.now() })
    releaseAt = null
  }
  for (const event of events) {
    const target = clock.now() + event.after
    if (releaseAt !== null && releaseAt <= target) { clock.advance(releaseAt - clock.now()); fire() }
    clock.advance(target - clock.now())
    releaseAt = clock.now() + axis.feed(event.delta)
  }
  if (releaseAt !== null) { clock.advance(releaseAt - clock.now()); fire() }
  return commits
}

// A fast flick (armed 8ms in), then ~1.4s of momentum events every 16ms.
function flickWithMomentumTail(tailEvents = 90, tailDelta = -20) {
  const events = [{ after: 0, delta: -60 }, { after: 8, delta: -60 }]
  for (let i = 0; i < tailEvents; i += 1) events.push({ after: 16, delta: tailDelta })
  return events
}

test('a fast flick commits right after it arms, even while momentum events keep streaming in', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWithTimer(axis, clock, flickWithMomentumTail())
  assert.ok(commits.length >= 1, 'expected the flick to commit')
  const armedAt = 8
  assert.ok(commits[0].at <= armedAt + axis.quietFlickMs + 5,
    `flick committed ${commits[0].at}ms in; expected ~${armedAt + axis.quietFlickMs}ms (momentum tail must not delay it)`)
})

test('the momentum tail of a fast flick does not commit a second page', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWithTimer(axis, clock, flickWithMomentumTail())
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1], `expected exactly one back navigation, got ${commits.length}`)
})

test('a fresh swipe after the momentum tail has fully ended still works', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const events = flickWithMomentumTail()
  events.push({ after: 600, delta: 110 }) // fingers back down well after the tail ended: a new forward flick
  events.push({ after: 16, delta: 110 })
  const commits = runWithTimer(axis, clock, events)
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1, 1])
})

// ---- Round 2: real flicks don't always start fast. Fingers land, drift a little, THEN snap. Judging speed
// from the very first event of the gesture (the old way) averages that lazy lead-in in and calls a real flick
// a "hold", which then waits out the whole momentum tail. Speed has to be judged on the recent movement.
test('a flick with a slow lead-in still commits right away (speed is judged on recent movement)', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const events = []
  for (let i = 0; i < 12; i += 1) events.push({ after: i === 0 ? 0 : 16, delta: -2 }) // ~180ms of lazy drift, 24px
  events.push({ after: 8, delta: -25 }, { after: 8, delta: -30 }, { after: 8, delta: -30 }) // then the snap
  for (let i = 0; i < 90; i += 1) events.push({ after: 16, delta: -20 }) // ~1.4s of momentum
  const commits = runWithTimer(axis, clock, events)
  const snapAt = 11 * 16 + 24
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1])
  assert.ok(commits[0].at <= snapAt + axis.quietFlickMs + 5, `committed at ${commits[0].at}ms, expected by ~${snapAt + axis.quietFlickMs}ms`)
})

test('a moderate swipe that starts as a hold commits as soon as lift-off momentum kicks in', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const events = []
  for (let i = 0; i < 13; i += 1) events.push({ after: i === 0 ? 0 : 16, delta: -8 }) // 0.5 px/ms: arms as a hold
  for (let i = 0; i < 90; i += 1) events.push({ after: 16, delta: -20 }) // fingers lift, momentum streams in
  const commits = runWithTimer(axis, clock, events)
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1])
  assert.ok(commits[0].at < 12 * 16 + 300, `committed at ${commits[0].at}ms; should not wait out the ~1.5s momentum tail`)
})

// ---- The "hold" half: finger stays down and keeps dragging slowly => never commits mid-drag; commits only
// after the drag stops (inferred lift), and moving back before that cancels it.
test('a slow continuous drag never commits while it is still moving, only after it stops', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const events = []
  for (let i = 0; i < 60; i += 1) events.push({ after: i === 0 ? 0 : 16, delta: -5 }) // ~0.3 px/ms for ~1s, far past threshold
  const commits = runWithTimer(axis, clock, events)
  const lastEventAt = 59 * 16
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1])
  assert.strictEqual(commits[0].at, lastEventAt + axis.quietHoldMs, `expected commit ${axis.quietHoldMs}ms after the drag stopped`)
})

test('dragging past the threshold slowly and then moving back before letting go cancels it', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const events = []
  for (let i = 0; i < 25; i += 1) events.push({ after: i === 0 ? 0 : 16, delta: -5 }) // armed
  for (let i = 0; i < 20; i += 1) events.push({ after: 16, delta: 5 }) // finger comes back toward center
  const commits = runWithTimer(axis, clock, events)
  assert.deepStrictEqual(commits, [])
})

// ---- Round 3: a flick that's only *moderately* fast. The fingers move ~40px, lift, and it's the momentum
// events afterwards (decaying smoothly, ~16ms apart) that carry it past the threshold. At no point is it
// moving at "flick" speed, so speed alone calls it a hold — which then waits out the entire momentum tail
// (each tail event restarts the hold's quiet window). Smoothly decaying events at frame rate are what
// momentum looks like (a finger-driven drag doesn't decay that evenly), so that is read as "fingers lifted".
function weakFlickWithMomentum(dir = -1) {
  const events = []
  const finger = [1, 2, 4, 6, 8, 10, 10]
  finger.forEach((d, i) => events.push({ after: i === 0 ? 0 : 16, delta: dir * d }))
  let v = 10
  for (let i = 0; i < 100; i += 1) { v *= 0.96; events.push({ after: 16, delta: dir * Math.max(0.5, Math.round(v * 10) / 10) }) }
  return events
}

test('a moderate flick that only crosses the threshold on momentum events commits promptly, not after the tail', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWithTimer(axis, clock, weakFlickWithMomentum(-1))
  assert.deepStrictEqual(commits.map((c) => c.direction), [-1])
  assert.ok(commits[0].at < 450, `committed at ${commits[0].at}ms; should not wait out the ~1.7s momentum tail`)
})

test('the same moderate flick going forward also commits promptly, once', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const commits = runWithTimer(axis, clock, weakFlickWithMomentum(1))
  assert.deepStrictEqual(commits.map((c) => c.direction), [1])
  assert.ok(commits[0].at < 450, `committed at ${commits[0].at}ms`)
})

test('a steady slow drag with jittery deltas is not mistaken for momentum', () => {
  const clock = makeClock()
  const axis = new SwipeAxis({ now: clock.now })
  const jitter = [5, 6, 4, 5, 5, 6, 4, 5, 6, 5, 4, 5, 5, 6, 5, 4, 5, 6, 5, 5]
  const events = []
  for (let r = 0; r < 3; r += 1) jitter.forEach((d, i) => events.push({ after: r === 0 && i === 0 ? 0 : 16, delta: -d }))
  const commits = runWithTimer(axis, clock, events)
  const lastEventAt = 59 * 16
  assert.strictEqual(commits.length, 1)
  assert.strictEqual(commits[0].at, lastEventAt + axis.quietHoldMs, 'must wait for the drag to actually stop')
})