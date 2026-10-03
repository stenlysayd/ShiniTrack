# GSAP RULES

## Setup (task 8.1)
1. Download `gsap.min.js` (core only, no plugins needed) and save to `app/ui/vendor/gsap.min.js`. Put the GSAP license note in `app/ui/vendor/LICENSE-gsap.txt`.
2. In `index.html`: `<script src="vendor/gsap.min.js"></script>` BEFORE `js/main.js`. NO CDN. The app CSP is `script-src 'self'` and the app must work offline.
3. Create `app/ui/js/motion.js`. Every animation in the app goes through this file. Views never call `gsap` directly.

## motion.js must export these functions
```js
motion.enabled()                       // false if pref ui.animations == '0' OR OS prefers-reduced-motion
motion.pageEnter(el)                   // fade + y 12 -> 0, 0.28s, ease 'power3.out'
motion.stagger(els, {max: 24})         // only first 24 items, y 14 -> 0, opacity 0 -> 1, stagger 0.03
motion.sheetOpen(el, backdropEl)       // y 100% -> 0, 0.32s 'power3.out'; backdrop opacity
motion.sheetClose(el, backdropEl, done)
motion.dialogOpen(el, backdropEl)      // scale 0.94 -> 1 + opacity
motion.tabIndicator(indicatorEl, tabEl)// animate x and width, 0.25s
motion.hud(el, visible, fromTop)       // reader bars: autoAlpha + y +-10
motion.press(el)                       // scale 0.97 on pointerdown, back on up
motion.toast(el)                       // slide up + fade
```
If `motion.enabled()` is false every function must apply the final state instantly (no tween).

## Rules
1. Animate ONLY `opacity`, `x`, `y`, `scale`, `rotation`. Never `width`, `height`, `top`, `left`, `box-shadow`, `filter`. (Exception: tab indicator may animate `width`.)
2. Durations: 0.15 - 0.35 s. Never longer than 0.4 s. Easing: `power3.out` for enter, `power2.in` for exit.
3. Never animate more than 24 elements at once. Library grid has thousands of items: animate only the first batch, never on scroll append.
4. Before a view is replaced, call `gsap.killTweensOf(...)` on its elements. Use `gsap.context()` per view and call `ctx.revert()` on leave. No tween may outlive its view.
5. Do NOT animate reader page images. Reading must be instant. Only the HUD bars animate.
6. Always set the final state in CSS too, so if JS fails the UI is still visible (no `opacity:0` in CSS by default; set it from JS with `gsap.set` right before `gsap.to`).
7. Use `gsap.matchMedia()` or the `motion.enabled()` check for reduced motion.
8. Do not use ScrollTrigger, Draggable, Flip or any plugin without asking.
9. Page transition: only on route change between top-level tabs and push screens. Push screen: new view x 24 -> 0. Back: no exit animation (instant), to feel fast.
10. Test on a mid-range phone with 5000 entries in the library. If scrolling drops frames, remove the animation, do not add more.

## Task order (Phase 8)
8.1 vendor + motion.js (no usage yet) -> 8.2 page enter -> 8.3 grid/list stagger -> 8.4 sheets and dialogs -> 8.5 tab indicator -> 8.6 reader HUD -> 8.7 reduced-motion and the "Animasi" switch.
