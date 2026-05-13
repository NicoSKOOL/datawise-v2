import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const defaults = {
  duration: 0.6,
  ease: 'power3.out',
};

// --- Core animations ---

export function fadeUp(selector: string, options?: { delay?: number; stagger?: number }) {
  if (prefersReducedMotion) return;
  gsap.from(selector, {
    y: 60,
    opacity: 0,
    duration: defaults.duration,
    ease: defaults.ease,
    delay: options?.delay ?? 0,
    stagger: options?.stagger ?? 0,
    scrollTrigger: {
      trigger: selector,
      start: 'top 85%',
      once: true,
    },
  });
}

export function staggerIn(selector: string, stagger = 0.1) {
  if (prefersReducedMotion) return;
  gsap.from(selector, {
    y: 40,
    opacity: 0,
    duration: defaults.duration,
    ease: defaults.ease,
    stagger,
    scrollTrigger: {
      trigger: selector,
      start: 'top 85%',
      once: true,
    },
  });
}

/**
 * ScrollTrigger.batch() for efficient staggered reveals.
 * Better than individual ScrollTriggers per element (GSAP performance skill).
 */
export function batchReveal(selector: string, options?: { stagger?: number; y?: number }) {
  if (prefersReducedMotion) return;

  ScrollTrigger.batch(selector, {
    onEnter: (elements) => {
      gsap.from(elements, {
        y: options?.y ?? 40,
        opacity: 0,
        duration: defaults.duration,
        ease: defaults.ease,
        stagger: options?.stagger ?? 0.08,
        overwrite: true,
      });
    },
    start: 'top 85%',
    once: true,
  });
}

export function textReveal(selector: string) {
  if (prefersReducedMotion) return;
  const el = document.querySelector(selector);
  if (!el) return;

  gsap.from(el, {
    y: 40,
    opacity: 0,
    duration: 0.8,
    ease: defaults.ease,
  });
}

export function counterUp(selector: string, endValue: number, duration = 2) {
  if (prefersReducedMotion) {
    const el = document.querySelector(selector);
    if (el) el.textContent = endValue.toLocaleString();
    return;
  }

  const obj = { val: 0 };
  gsap.to(obj, {
    val: endValue,
    duration,
    ease: 'power1.out',
    snap: { val: 1 },
    scrollTrigger: {
      trigger: selector,
      start: 'top 85%',
      once: true,
    },
    onUpdate() {
      const el = document.querySelector(selector);
      if (el) el.textContent = obj.val.toLocaleString();
    },
  });
}

// --- Enhanced animations ---

/**
 * Word-by-word text reveal with stagger.
 * Manual word splitting (SplitText is a GSAP Club plugin).
 */
export function splitTextReveal(selector: string) {
  if (prefersReducedMotion) return;
  const el = document.querySelector(selector);
  if (!el) return;

  const text = el.textContent || '';
  const words = text.split(' ');
  el.innerHTML = words
    .map(word => `<span class="inline-block overflow-hidden"><span class="inline-block">${word}</span></span>`)
    .join(' ');

  const innerSpans = el.querySelectorAll('span > span');
  gsap.from(innerSpans, {
    y: '100%',
    opacity: 0,
    duration: 0.6,
    ease: 'power3.out',
    stagger: 0.04,
    scrollTrigger: {
      trigger: el,
      start: 'top 80%',
      once: true,
    },
  });
}

/**
 * Magnetic button effect using gsap.quickTo() for performance.
 * Per GSAP performance skill: use quickTo for frequently updated properties.
 */
export function magneticButton(selector: string) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((btn) => {
    const el = btn as HTMLElement;

    // quickTo reuses a single tween instead of creating new ones per mousemove
    const xTo = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });

    el.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      xTo(x * 0.15);
      yTo(y * 0.15);
    });

    el.addEventListener('mouseleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}

/**
 * Smooth parallax with scrub interpolation.
 * Per GSAP ScrollTrigger skill: use number scrub for smooth lag.
 */
export function smoothParallax(selector: string, speed = 0.15) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((el) => {
    gsap.to(el, {
      yPercent: speed * 100,
      ease: 'none',
      scrollTrigger: {
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.5, // smooth 0.5s lag per GSAP best practices
      },
    });
  });
}

/**
 * Scroll progress bar (green line at top of page).
 */
export function scrollProgressBar() {
  if (prefersReducedMotion) return;

  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;top:0;left:0;height:3px;width:100%;background:var(--color-primary);z-index:9999;transform-origin:left;transform:scaleX(0);will-change:transform;';
  document.body.appendChild(bar);

  gsap.to(bar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.documentElement,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.3,
    },
  });
}

/**
 * Clip-path image reveal on scroll.
 */
export function imageReveal(selector: string) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((el) => {
    gsap.from(el, {
      clipPath: 'inset(0 100% 0 0)',
      duration: 0.8,
      ease: 'power3.inOut',
      scrollTrigger: {
        trigger: el,
        start: 'top 75%',
        once: true,
      },
    });
  });
}

/**
 * Icon hover animation (inspired by itshover).
 * Adds bounce + rotation micro-interaction on hover.
 */
export function iconHoverEffect(selector: string) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((el) => {
    const icon = el.querySelector('svg') || el;

    el.addEventListener('mouseenter', () => {
      gsap.to(icon, {
        scale: 1.15,
        rotation: 8,
        duration: 0.3,
        ease: 'back.out(2)',
      });
    });

    el.addEventListener('mouseleave', () => {
      gsap.to(icon, {
        scale: 1,
        rotation: 0,
        duration: 0.4,
        ease: 'power2.out',
      });
    });
  });
}

/**
 * Card tilt effect on hover (inspired by itshover perspective effects).
 * Adds a subtle 3D tilt following the mouse position.
 */
export function cardTiltEffect(selector: string) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((card) => {
    const el = card as HTMLElement;
    el.style.transformStyle = 'preserve-3d';
    el.style.willChange = 'transform';

    const rotateXTo = gsap.quickTo(el, 'rotationX', { duration: 0.3, ease: 'power2' });
    const rotateYTo = gsap.quickTo(el, 'rotationY', { duration: 0.3, ease: 'power2' });

    el.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      rotateXTo(-y * 8);  // subtle tilt, max 4 degrees
      rotateYTo(x * 8);
    });

    el.addEventListener('mouseleave', () => {
      rotateXTo(0);
      rotateYTo(0);
    });
  });
}

/**
 * Nav scroll effect: add/remove class on scroll.
 */
export function navScrollEffect(selector: string) {
  if (prefersReducedMotion) return;
  const nav = document.querySelector(selector);
  if (!nav) return;

  ScrollTrigger.create({
    start: 'top -80',
    onUpdate(self) {
      if (self.direction === 1 && self.scroll() > 80) {
        (nav as HTMLElement).classList.add('nav-scrolled');
      } else if (self.scroll() <= 80) {
        (nav as HTMLElement).classList.remove('nav-scrolled');
      }
    },
  });
}

/**
 * Mouse-follow shine + subtle tilt for screenshots.
 * Sets CSS custom properties --mouse-x/--mouse-y for the radial gradient shine,
 * and applies a gentle 3D tilt using quickTo.
 */
export function mouseFollowEffect(selector: string) {
  if (prefersReducedMotion) return;

  document.querySelectorAll(selector).forEach((wrapper) => {
    const el = wrapper as HTMLElement;

    const rotateXTo = gsap.quickTo(el, 'rotationX', { duration: 0.4, ease: 'power2' });
    const rotateYTo = gsap.quickTo(el, 'rotationY', { duration: 0.4, ease: 'power2' });

    el.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const percX = (x / rect.width) * 100;
      const percY = (y / rect.height) * 100;

      // Update CSS vars for the shine gradient
      el.style.setProperty('--mouse-x', `${percX}%`);
      el.style.setProperty('--mouse-y', `${percY}%`);

      // Subtle tilt (max ~4 degrees)
      const tiltX = (y / rect.height - 0.5) * -6;
      const tiltY = (x / rect.width - 0.5) * 6;
      rotateXTo(tiltX);
      rotateYTo(tiltY);
    });

    el.addEventListener('mouseleave', () => {
      rotateXTo(0);
      rotateYTo(0);
    });
  });
}

/**
 * Scroll-linked value interpolation.
 * Wraps ScrollTrigger + gsap.utils.interpolate to morph any value type
 * (numbers, colors, objects, arrays, complex strings) between from and to
 * based on scroll progress.
 */
export function interpolateOnScroll<T>(
  trigger: Element | string,
  from: T,
  to: T,
  onUpdate: (value: T, progress: number) => void,
  options?: { start?: string; end?: string; scrub?: boolean | number }
) {
  if (prefersReducedMotion) {
    onUpdate(to, 1);
    return;
  }

  const interp = gsap.utils.interpolate(from as any, to as any);

  ScrollTrigger.create({
    trigger,
    start: options?.start ?? 'top bottom',
    end: options?.end ?? 'bottom top',
    scrub: options?.scrub ?? 0.5,
    onUpdate(self) {
      onUpdate(interp(self.progress) as T, self.progress);
    },
  });
}

/**
 * MagicBento-style interactive effects for a grid of cards.
 * Applies spotlight, border glow, 3D tilt, magnetism, particle stars, click ripple.
 * Respects prefers-reduced-motion and disables on mobile (<768px).
 */
export function bentoEffects(
  gridSelector: string,
  options?: {
    spotlightRadius?: number;
    particleCount?: number;
    glowColor?: string;
    enableTilt?: boolean;
    enableMagnetism?: boolean;
    enableParticles?: boolean;
    enableRipple?: boolean;
  }
) {
  const grid = document.querySelector(gridSelector) as HTMLElement | null;
  if (!grid) return;

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile || prefersReducedMotion) return;

  const spotlightRadius = options?.spotlightRadius ?? 320;
  const particleCount = options?.particleCount ?? 10;
  const glowColor = options?.glowColor ?? '46, 204, 113';
  const enableTilt = options?.enableTilt ?? true;
  const enableMagnetism = options?.enableMagnetism ?? true;
  const enableParticles = options?.enableParticles ?? true;
  const enableRipple = options?.enableRipple ?? true;

  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.bento-card'));

  // Set CSS vars at the grid level for every card
  grid.style.setProperty('--bento-glow', glowColor);
  grid.style.setProperty('--bento-spotlight-radius', `${spotlightRadius}px`);

  // Global spotlight: single mousemove listener updates CSS vars per card
  const onGridMouseMove = (e: MouseEvent) => {
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  };
  window.addEventListener('mousemove', onGridMouseMove);

  // Per-card effects
  cards.forEach((card) => {
    card.style.transformStyle = 'preserve-3d';
    card.style.willChange = 'transform';

    const rotXTo = gsap.quickTo(card, 'rotationX', { duration: 0.3, ease: 'power2' });
    const rotYTo = gsap.quickTo(card, 'rotationY', { duration: 0.3, ease: 'power2' });
    const xTo = gsap.quickTo(card, 'x', { duration: 0.4, ease: 'power2' });
    const yTo = gsap.quickTo(card, 'y', { duration: 0.4, ease: 'power2' });

    let isHovered = false;
    let particleTimeouts: number[] = [];
    const liveParticles: HTMLElement[] = [];

    const clearParticles = () => {
      particleTimeouts.forEach((id) => window.clearTimeout(id));
      particleTimeouts = [];
      liveParticles.forEach((p) => {
        gsap.to(p, {
          scale: 0,
          opacity: 0,
          duration: 0.3,
          ease: 'back.in(1.7)',
          onComplete: () => p.remove(),
        });
      });
      liveParticles.length = 0;
    };

    const spawnParticles = () => {
      if (!enableParticles) return;
      const { width, height } = card.getBoundingClientRect();
      for (let i = 0; i < particleCount; i++) {
        const id = window.setTimeout(() => {
          if (!isHovered) return;
          const px = Math.random() * width;
          const py = Math.random() * height;
          const el = document.createElement('div');
          el.className = 'bento-particle';
          el.style.cssText = `position:absolute;width:4px;height:4px;border-radius:50%;background:rgba(${glowColor},1);box-shadow:0 0 6px rgba(${glowColor},0.6);pointer-events:none;z-index:30;left:${px}px;top:${py}px;`;
          card.appendChild(el);
          liveParticles.push(el);
          gsap.fromTo(el, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.7)' });
          gsap.to(el, {
            x: (Math.random() - 0.5) * 90,
            y: (Math.random() - 0.5) * 90,
            rotation: Math.random() * 360,
            duration: 2 + Math.random() * 2,
            ease: 'none',
            repeat: -1,
            yoyo: true,
          });
        }, i * 100);
        particleTimeouts.push(id);
      }
    };

    card.addEventListener('mouseenter', () => {
      isHovered = true;
      spawnParticles();
    });

    card.addEventListener('mouseleave', () => {
      isHovered = false;
      clearParticles();
      rotXTo(0);
      rotYTo(0);
      xTo(0);
      yTo(0);
    });

    card.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      if (enableTilt) {
        rotXTo(((y - cy) / cy) * -8);
        rotYTo(((x - cx) / cx) * 8);
      }
      if (enableMagnetism) {
        xTo((x - cx) * 0.04);
        yTo((y - cy) * 0.04);
      }
    });

    if (enableRipple) {
      card.addEventListener('click', (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement('div');
        ripple.style.cssText = `position:absolute;width:10px;height:10px;border-radius:50%;background:rgba(${glowColor},0.5);left:${x}px;top:${y}px;pointer-events:none;z-index:40;transform:translate(-50%,-50%);`;
        card.appendChild(ripple);
        gsap.fromTo(
          ripple,
          { scale: 0, opacity: 1 },
          { scale: 50, opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: () => ripple.remove() }
        );
      });
    }
  });
}

/**
 * Pinned scroll-story. The container remains fixed while the user scrolls,
 * and steps cross-fade. Drives: caption opacity, screenshot clipPath inset,
 * and a progress bar.
 *
 * Container data attributes:
 *   [data-story-scroller]       root
 *   [data-story-steps]            number of steps (default: query .story-step count)
 *   .story-step                 individual caption blocks
 *   .story-image                the AppScreenshot-like image to reveal
 *   .story-progress             thin bar scaled on scroll
 */
export function pinnedStory(containerSelector: string) {
  const container = document.querySelector(containerSelector) as HTMLElement | null;
  if (!container) return;

  const steps = Array.from(container.querySelectorAll<HTMLElement>('.story-step'));
  const image = container.querySelector<HTMLElement>('.story-image');
  const progress = container.querySelector<HTMLElement>('.story-progress');
  if (steps.length === 0) return;

  if (prefersReducedMotion) {
    steps.forEach((s) => (s.style.opacity = '1'));
    if (image) image.style.clipPath = 'inset(0% 0% 0% 0%)';
    if (progress) progress.style.transform = 'scaleY(1)';
    return;
  }

  const segments = steps.length;

  // Initial state: only first step visible
  gsap.set(steps, { autoAlpha: 0 });
  gsap.set(steps[0], { autoAlpha: 1 });
  if (image) gsap.set(image, { clipPath: 'inset(0% 100% 0% 0%)' });
  if (progress) gsap.set(progress, { scaleY: 0, transformOrigin: 'top' });

  ScrollTrigger.create({
    trigger: container,
    start: 'top top',
    end: () => `+=${window.innerHeight * segments}`,
    pin: true,
    scrub: 0.6,
    onUpdate(self) {
      const p = self.progress;

      // Progress bar scale
      if (progress) gsap.set(progress, { scaleY: p });

      // Image reveal: inset right goes 100% -> 0%
      if (image) {
        const insetRight = gsap.utils.interpolate(100, 0, p);
        gsap.set(image, { clipPath: `inset(0% ${insetRight}% 0% 0%)` });
      }

      // Caption crossfade
      const idxFloat = p * (segments - 1);
      steps.forEach((step, i) => {
        const dist = Math.abs(i - idxFloat);
        const alpha = Math.max(0, 1 - dist);
        gsap.set(step, { autoAlpha: alpha });
      });
    },
  });
}

// --- Auto-init on DOMContentLoaded ---

document.addEventListener('DOMContentLoaded', () => {
  // Magnetic buttons
  magneticButton('[data-magnetic]');

  // Icon hover effects on feature icon containers
  iconHoverEffect('[data-icon-hover]');

  // Card tilt effect
  cardTiltEffect('[data-tilt]');

  // Mouse-follow on screenshots
  mouseFollowEffect('[data-mouse-follow]');

  // Bento grid effects (MagicBento-style)
  document.querySelectorAll<HTMLElement>('[data-bento-grid]').forEach((grid) => {
    const id = grid.id || 'bento-grid';
    if (!grid.id) grid.id = id;
    bentoEffects(`#${id}`, {
      glowColor: grid.dataset.glow || '46, 204, 113',
    });
  });

  // Pinned story scrollers
  document.querySelectorAll<HTMLElement>('[data-story-scroller]').forEach((el) => {
    const id = el.id || 'story-scroller';
    if (!el.id) el.id = id;
    pinnedStory(`#${id}`);
  });
});
