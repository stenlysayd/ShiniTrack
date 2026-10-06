import { getPref } from './state.js';

export const motion = {
  // false if pref ui.animations == '0' OR OS prefers-reduced-motion OR no gsap
  enabled() {
    if (typeof window === 'undefined' || !window.gsap) return false;
    const pref = getPref('ui.animations', '1');
    if (pref === '0' || pref === false || String(pref) === '0') return false;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    return true;
  },

  // fade + y 12 -> 0 (tabs) or x 24 -> 0 (push), 0.28s, ease 'power3.out'
  pageEnter(el, type = 'tab') {
    if (!el) return;
    const isPush = type === 'push' || type === true;
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(el);
        gsap.set(el, { opacity: 1, x: 0, y: 0, clearProps: 'transform' });
      } else {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
      return;
    }
    gsap.killTweensOf(el);
    const fromVars = isPush
      ? { opacity: 0, x: 24, y: 0 }
      : { opacity: 0, y: 12, x: 0 };
    return gsap.fromTo(el, fromVars, { opacity: 1, x: 0, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'transform' });
  },

  // only first 24 items, y 14 -> 0, opacity 0 -> 1, stagger 0.03
  stagger(els, { max = 24 } = {}) {
    if (!els) return;
    const items = (typeof els === 'string' ? Array.from(document.querySelectorAll(els)) : Array.from(els)).slice(0, max);
    if (!items.length) return;
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(items);
        gsap.set(items, { opacity: 1, y: 0, clearProps: 'transform' });
      } else {
        items.forEach((item) => {
          item.style.opacity = '1';
          item.style.transform = 'none';
        });
      }
      return;
    }
    gsap.killTweensOf(items);
    return gsap.fromTo(items, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.03, ease: 'power3.out', clearProps: 'transform' });
  },

  // y 100% -> 0, 0.32s 'power3.out'; backdrop opacity
  sheetOpen(el, backdropEl) {
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        if (backdropEl) { gsap.killTweensOf(backdropEl); gsap.set(backdropEl, { opacity: 1 }); }
        if (el) { gsap.killTweensOf(el); gsap.set(el, { y: '0%', opacity: 1 }); }
      } else {
        if (backdropEl) backdropEl.style.opacity = '1';
        if (el) { el.style.transform = 'translateY(0%)'; el.style.opacity = '1'; }
      }
      return;
    }
    if (backdropEl) {
      gsap.killTweensOf(backdropEl);
      gsap.fromTo(backdropEl, { opacity: 0 }, { opacity: 1, duration: 0.32, ease: 'power3.out' });
    }
    if (el) {
      gsap.killTweensOf(el);
      return gsap.fromTo(el, { y: '100%' }, { y: '0%', duration: 0.32, ease: 'power3.out' });
    }
  },

  // slide down and fade backdrop, then invoke done
  sheetClose(el, backdropEl, done) {
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        if (backdropEl) { gsap.killTweensOf(backdropEl); gsap.set(backdropEl, { opacity: 0 }); }
        if (el) { gsap.killTweensOf(el); gsap.set(el, { y: '100%' }); }
      } else {
        if (backdropEl) backdropEl.style.opacity = '0';
        if (el) el.style.transform = 'translateY(100%)';
      }
      if (typeof done === 'function') done();
      return;
    }
    if (backdropEl) {
      gsap.killTweensOf(backdropEl);
      gsap.to(backdropEl, { opacity: 0, duration: 0.25, ease: 'power2.in' });
    }
    if (el) {
      gsap.killTweensOf(el);
      return gsap.to(el, {
        y: '100%',
        duration: 0.25,
        ease: 'power2.in',
        onComplete: () => { if (typeof done === 'function') done(); }
      });
    } else if (typeof done === 'function') {
      done();
    }
  },

  // scale 0.94 -> 1 + opacity
  dialogOpen(el, backdropEl) {
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        if (backdropEl) { gsap.killTweensOf(backdropEl); gsap.set(backdropEl, { opacity: 1 }); }
        if (el) { gsap.killTweensOf(el); gsap.set(el, { scale: 1, opacity: 1 }); }
      } else {
        if (backdropEl) backdropEl.style.opacity = '1';
        if (el) { el.style.transform = 'scale(1)'; el.style.opacity = '1'; }
      }
      return;
    }
    if (backdropEl) {
      gsap.killTweensOf(backdropEl);
      gsap.fromTo(backdropEl, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power3.out' });
    }
    if (el) {
      gsap.killTweensOf(el);
      return gsap.fromTo(el, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'power3.out' });
    }
  },

  // animate x and width, 0.25s
  tabIndicator(indicatorEl, tabEl, instant = false) {
    if (!indicatorEl || !tabEl) return;
    const x = tabEl.offsetLeft;
    const width = tabEl.offsetWidth;
    const gsap = window.gsap;
    if (instant || !motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(indicatorEl);
        gsap.set(indicatorEl, { x, width });
      } else {
        indicatorEl.style.transform = `translateX(${x}px)`;
        indicatorEl.style.width = `${width}px`;
      }
      return;
    }
    gsap.killTweensOf(indicatorEl);
    return gsap.to(indicatorEl, { x, width, duration: 0.25, ease: 'power3.out' });
  },

  // bottom nav active pill: scale 0.8 -> 1 + opacity, 0.25s
  navPill(el) {
    if (!el) return;
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(el);
        gsap.set(el, { scale: 1, opacity: 1, clearProps: 'transform' });
      } else {
        el.style.opacity = '1';
        el.style.transform = 'none';
      }
      return;
    }
    gsap.killTweensOf(el);
    return gsap.fromTo(
      el,
      { scale: 0.8, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.25, ease: 'power3.out', clearProps: 'transform' }
    );
  },

  // reader bars: autoAlpha + y +-10
  hud(el, visible, fromTop = true) {
    if (!el) return;
    const targetY = visible ? 0 : (fromTop ? -10 : 10);
    const targetAlpha = visible ? 1 : 0;
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(el);
        gsap.set(el, { autoAlpha: targetAlpha, y: targetY });
      } else {
        el.style.visibility = visible ? 'visible' : 'hidden';
        el.style.opacity = visible ? '1' : '0';
        el.style.transform = `translateY(${targetY}px)`;
      }
      return;
    }
    gsap.killTweensOf(el);
    return gsap.to(el, {
      autoAlpha: targetAlpha,
      y: targetY,
      duration: 0.2,
      ease: visible ? 'power3.out' : 'power2.in'
    });
  },

  // scale 0.97 on pointerdown, back on up
  press(el, isDown) {
    if (!el) return;
    const gsap = window.gsap;
    if (typeof isDown === 'boolean') {
      if (!motion.enabled()) {
        if (gsap) {
          gsap.killTweensOf(el);
          gsap.set(el, { scale: 1, clearProps: 'transform' });
        } else {
          el.style.transform = 'none';
        }
        return;
      }
      if (!gsap) return;
      gsap.killTweensOf(el);
      if (isDown) {
        return gsap.to(el, { scale: 0.97, duration: 0.1, ease: 'power2.out' });
      } else {
        return gsap.to(el, { scale: 1, duration: 0.15, ease: 'power2.out', clearProps: 'transform' });
      }
    }
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(el);
        gsap.set(el, { scale: 1, clearProps: 'transform' });
      } else {
        el.style.transform = 'none';
      }
    }
    if (el._motionPressBound) return;
    el._motionPressBound = true;

    const onDown = () => {
      motion.press(el, true);
    };

    const onUp = () => {
      motion.press(el, false);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('pointercancel', onUp);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onUp);
      el.removeEventListener('pointercancel', onUp);
      delete el._motionPressBound;
    };
  },

  // slide up + fade
  toast(el) {
    if (!el) return;
    const hasCenter = el.classList?.contains('toast');
    const gsap = window.gsap;
    if (!motion.enabled()) {
      if (gsap) {
        gsap.killTweensOf(el);
        if (hasCenter) gsap.set(el, { opacity: 1, y: 0, xPercent: -50 });
        else gsap.set(el, { opacity: 1, y: 0 });
      } else {
        el.style.opacity = '1';
        el.style.transform = hasCenter ? 'translate(-50%, 0)' : 'translateY(0px)';
      }
      return;
    }
    gsap.killTweensOf(el);
    const fromProps = { opacity: 0, y: 12 };
    const toProps = { opacity: 1, y: 0, duration: 0.25, ease: 'power3.out' };
    if (hasCenter) {
      fromProps.xPercent = -50;
      toProps.xPercent = -50;
    }
    return gsap.fromTo(el, fromProps, toProps);
  },

  // kill running tweens and reset transform/opacity on element
  kill(el) {
    if (!el) return;
    const gsap = window.gsap;
    if (gsap) {
      gsap.killTweensOf(el);
      gsap.set(el, { opacity: 1, x: 0, y: 0, clearProps: 'transform' });
    } else {
      el.style.opacity = '1';
      el.style.transform = 'none';
    }
  }
};

export default motion;
