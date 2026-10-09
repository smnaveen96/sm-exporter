"use strict";
// A single swipe-gesture axis (horizontal two-finger trackpad swipe), used for both the folder-picker's
// back/forward navigation and the quick-look preview's file-to-file stepping. Pulled out into its own
// small, DOM-free module so the classification logic (fast flick vs. slow hold vs. springs-back) can be
// driven with synthetic wheel-event sequences and checked by assertion, instead of only being checkable
// by hand on a real trackpad — which is slow, not repeatable, and makes "did this specific change help"
// hard to tell apart from "I just got lucky this time."
//
// Wheel events are the only signal a two-finger trackpad swipe gives us; there's no lift-off event like
// touch's touchend, so "did the finger let go" is always inferred from a quiet period with no new events.
// What needs telling apart:
//   1. A fast flick should commit almost immediately after the last event (not wait out a long timer).
//   2. A slow, deliberate hold should wait a good while before committing, so reversing mid-hold still
//      works — but must not be misread as a flick from one noisy early event, or as a flick that then
//      "goes stale" because the trailing wheel events of a real flick taper off into small ones as the
//      hardware's momentum reporting decays (hence the arrow sitting there after a fast swipe).
// Earlier versions tried (a) classifying by how long the gesture took to first reach the threshold, then
// (b) the peak of each event's own instantaneous speed — (a) misjudged a slow-start-then-fast-end swipe,
// and (b) broke on the most common real flick shape of all: a fast flick is so quick that it can arrive as
// just one or two coalesced wheel events, and the very first sample of a gesture was being skipped (there
// is no previous timestamp yet to measure an interval against), silently discarding the one sample a short
// flick actually has. The deeper problem is that the gesture was still being reclassified after it had
// already crossed the threshold, so a few tiny trailing wheel events from the trackpad could stretch the
// elapsed time enough to "re-slow" a real fast flick and keep the arrow/feedback stuck on screen until the
// long hold timer finally fired. The actual decision should be made once, at the moment the swipe first
// becomes armed: the average speed from the start of that direction of movement to the threshold crossing is
// the real signal. After that, a later blur of tiny deltas should not be allowed to change a fast flick into
// a slow hold while the finger is already lifted.
class SwipeAxis {
  constructor({
    threshold = 90,
    quietMs = 160,
    quietHoldMs = 220,
    quietFlickMs = 50,
    cooldownMs = 350,
    flickVelocity = 0.7, // px/ms: quick flicks should resolve immediately; slow drags are the only ones that wait briefly
    now = () => Date.now(),
  } = {}) {
    this.threshold = threshold
    this.max = threshold * 1.3 // a little travel left past the threshold so it doesn't feel pinned the instant it would fire
    this.quietMs = quietMs
    this.quietHoldMs = quietHoldMs
    this.quietFlickMs = quietFlickMs
    this.cooldownMs = cooldownMs
    this.flickVelocity = flickVelocity
    this.now = now
    this.reset()
  }
  
  reset() {
    this.accum = 0
    this.startT = 0
    this.lastVelocity = 0 // exposed for callers/tests that want to inspect the most recent classification
    this.armedAt = 0
    this.classification = null // 'flick' or 'hold' once the swipe first becomes armed
    this.cooldownUntil = 0
  }
  
  get armed() { return Math.abs(this.accum) >= this.threshold }
  
  // Feeds one wheel event's deltaX in. Returns the quiet-window length (ms) that should now be (re)armed
  // before this gesture is inferred as released — the caller owns the actual setTimeout/clearTimeout, so
  // this stays pure and testable without waiting on a real clock. We freeze the fast-vs-slow decision when
  // the swipe first becomes armed; after that, tiny trailing deltas from trackpad momentum must not reclassify
  // a fast flick as a slow hold while the finger is already effectively lifted.
  feed(deltaX) {
    const t = this.now()
    
    if (t < this.cooldownUntil) {
      this.cooldownUntil = Math.max(this.cooldownUntil, t + this.quietMs)
      return this.quietMs
    }
    
    if (this.accum === 0 || Math.sign(this.accum) !== Math.sign(this.accum + deltaX)) {
      this.startT = t
      this.classification = null
    } else if (Math.abs(this.accum) < 15) {
      // Ignore time spent resting on the trackpad or moving very slowly before a flick
      this.startT = t
    }

    this.accum = Math.max(-this.max, Math.min(this.max, this.accum + deltaX))
    
    if (!this.armed) {
      this.lastVelocity = Math.abs(this.accum) / Math.max(1, t - this.startT)
      return this.quietMs
    }
    
    if (this.classification === null) {
      const elapsed = Math.max(1, t - this.startT)
      const averageVelocity = Math.abs(this.accum) / elapsed
      this.lastVelocity = averageVelocity
      this.classification = averageVelocity >= this.flickVelocity ? 'flick' : 'hold'
    }
    
    if (this.classification === 'flick') {
      // Commit immediately if a flick has already reached maximum visual travel
      if (Math.abs(this.accum) >= this.max) return 0
      return this.quietFlickMs
    }
    
    return this.quietHoldMs
  }
  
  // Called once the quiet window has actually elapsed with no further feed(). Returns -1 (commit back),
  // 1 (commit forward), or 0 (spring back / do nothing) and resets state for the next gesture. Reversing
  // the drag back toward center before this fires needs no special handling: accum just drops back below
  // the threshold again, so this sees an unarmed drag and returns 0, same as if it never crossed it.
  release() {
    const accum = this.accum
    const cooldownUntil = this.cooldownUntil
    this.reset()
    this.cooldownUntil = cooldownUntil
    const direction = accum <= -this.threshold ? -1 : accum >= this.threshold ? 1 : 0
    if (direction) this.cooldownUntil = this.now() + this.cooldownMs
    return direction
  }
}
if (typeof module !== 'undefined') module.exports = { SwipeAxis }