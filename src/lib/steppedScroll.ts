export interface SteppedScrollOptions {
  container: HTMLElement;
  /** Ordered, stable, untransformed markers: one per section. */
  triggers: readonly HTMLElement[];
  initialIndex?: number;
  onStep: (index: number) => void;
  /** Signed normalized pull in [-1, 1]; presentation belongs to the caller. */
  onTension?: (value: number, index: number) => void;
  onClearTension?: () => void;
  onMeasure?: (index: number) => void;
  /** Desired viewport Y of each marker. */
  restPosition?: (index: number) => number;
  desktopQuery?: string;
  threshold?: number;
  maxEventDelta?: number;
  gestureIdleMs?: number;
  restLine?: number;
  springStiffness?: number;
  springDamping?: number;
  springTimeScale?: number;
}

/** Browser-only, window-scrolling controller. One active controller per page.
 * No case selectors, content, CSS or framework dependencies.
 * Keep callbacks synchronous; call destroy() before replacing the DOM.
 */
export function createSteppedScroll(options: SteppedScrollOptions) {
  const {
    container: story, triggers,
    desktopQuery: DESKTOP_QUERY = '(min-width: 901px)',
    threshold: STEP_THRESHOLD = 120,
    maxEventDelta: MAX_EVENT_DELTA = 60,
    gestureIdleMs: GESTURE_IDLE_MS = 120,
    restLine: REST_LINE = 0.38,
    springStiffness: SPRING_STIFFNESS = 180,
    springDamping: SPRING_DAMPING = 26,
    springTimeScale: SPRING_TIME_SCALE = 1.5,
  } = options;
  if (!triggers.length || triggers.some((trigger) => !story.contains(trigger))) {
    throw new Error('steppedScroll: provide ordered markers inside the container');
  }
  if (![STEP_THRESHOLD, MAX_EVENT_DELTA, GESTURE_IDLE_MS, SPRING_STIFFNESS,
    SPRING_DAMPING, SPRING_TIME_SCALE].every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(REST_LINE) || REST_LINE < 0 || REST_LINE > 1
    || !Number.isInteger(options.initialIndex ?? 0)) {
    throw new Error('steppedScroll: invalid options');
  }
  const desktopQuery = window.matchMedia(DESKTOP_QUERY);
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  let destroyed = false;
  let activeIndex = Math.min(triggers.length - 1, Math.max(0, options.initialIndex ?? 0));
  // Discrete wheel state survives interrupted/unfinished scroll positioning.
  let wheelOwnsState = false;
  let accumulatedDelta = 0;
  let gestureActive = false;
  let committedInGesture = false;
  let lastWheelTime = 0;
  let gestureIdleTimer: number | undefined;
  let fallbackFrame = 0;
  let animationFrame = 0;
  let animationMode: 'scroll' | 'tension' | null = null;
  let animationLastTime = 0;
  let springPosition = 0;
  let springVelocity = 0;
  let springTarget = 0;
  let observer: IntersectionObserver | undefined;
  let previousScrollBehavior: string | null = null;
  let lastObservedY = window.scrollY;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const setActiveIndex = (nextIndex: number) => {
    const boundedIndex = clamp(nextIndex, 0, triggers.length - 1);
    if (boundedIndex === activeIndex) return;
    activeIndex = boundedIndex;
    options.onStep(activeIndex);
  };

  const renderTension = (value: number) => {
    options.onTension?.(clamp(value, -1, 1), activeIndex);
  };

  const clearTension = () => {
    springVelocity = 0;
    options.onClearTension?.();
  };

  const restoreScrollBehavior = () => {
    if (previousScrollBehavior === null) return;
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
    previousScrollBehavior = null;
  };

  const cancelAnimation = () => {
    const wasScrolling = animationMode === 'scroll';
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    animationMode = null;
    springVelocity = 0;
    if (wasScrolling) restoreScrollBehavior();
  };

  const finishAnimation = () => {
    const completedMode = animationMode;

    if (completedMode === 'scroll') {
      window.scrollTo(0, springTarget);
      lastObservedY = window.scrollY;
      restoreScrollBehavior();
    } else {
      clearTension();
    }

    animationFrame = 0;
    animationMode = null;
    springVelocity = 0;

    if (completedMode === 'tension') scheduleFallback();
  };

  const runSpring = (time: number) => {
    if (!animationMode) return;

    const deltaTime = Math.min(
      0.032,
      Math.max(0.001, ((time - animationLastTime) / 1000) * SPRING_TIME_SCALE),
    );
    animationLastTime = time;
    const distance = springTarget - springPosition;
    const acceleration = distance * SPRING_STIFFNESS - springVelocity * SPRING_DAMPING;

    springVelocity += acceleration * deltaTime;
    const nextPosition = springPosition + springVelocity * deltaTime;
    // Never overshoot or move against the user's committed direction.
    springPosition = clamp(
      nextPosition,
      Math.min(springPosition, springTarget),
      Math.max(springPosition, springTarget),
    );

    if (animationMode === 'scroll') {
      window.scrollTo(0, springPosition);
    } else {
      renderTension(springPosition);
    }

    if (Math.abs(distance) < 0.5 && Math.abs(springVelocity) < 0.5) {
      finishAnimation();
      return;
    }

    animationFrame = requestAnimationFrame(runSpring);
  };

  const startSpring = (mode: 'scroll' | 'tension', position: number, target: number) => {
    cancelAnimation();
    animationMode = mode;

    if (mode === 'scroll') {
      previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
    }

    springPosition = position;
    springTarget = target;
    springVelocity = 0;
    animationLastTime = performance.now();
    animationFrame = requestAnimationFrame(runSpring);
  };

  const restPosition = options.restPosition ?? (() => window.innerHeight * REST_LINE);

  const springToActiveStage = (direction: number) => {
    const trigger = triggers[activeIndex];
    if (!trigger) return;

    const triggerDocumentY = window.scrollY + trigger.getBoundingClientRect().top;
    const maximumScroll = document.documentElement.scrollHeight - window.innerHeight;
    const requested = clamp(triggerDocumentY - restPosition(activeIndex), 0, maximumScroll);
    const destination = direction > 0
      ? Math.max(window.scrollY, requested)
      : Math.min(window.scrollY, requested);

    startSpring('scroll', window.scrollY, destination);
  };

  const syncFromPosition = () => {
    fallbackFrame = 0;
    if (!story || !desktopQuery.matches || gestureActive || animationMode || wheelOwnsState || accumulatedDelta !== 0) return;

    let nextIndex = 0;

    triggers.forEach((trigger, index) => {
      if (trigger.getBoundingClientRect().top <= restPosition(index) + 2) nextIndex = index;
    });

    setActiveIndex(nextIndex);
  };

  const scheduleFallback = () => {
    if (
      !desktopQuery.matches ||
      gestureActive ||
      animationMode ||
      fallbackFrame
    ) {
      return;
    }

    fallbackFrame = requestAnimationFrame(syncFromPosition);
  };

  const isStoryInWorkingArea = () => {
    if (!story) return false;
    const bounds = story.getBoundingClientRect();
    const restY = window.innerHeight * REST_LINE;
    return bounds.top <= restY && bounds.bottom >= restY;
  };

  const normalizeWheelDelta = (event: WheelEvent) => {
    const multiplier =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;

    return clamp(event.deltaY * multiplier, -MAX_EVENT_DELTA, MAX_EVENT_DELTA);
  };

  const finishGesture = () => {
    gestureActive = false;
    committedInGesture = false;
    gestureIdleTimer = undefined;
    // Keep unfinished progress: separate light wheel ticks continue the pull.
    // Only an explicit reverse movement or native navigation releases it.
  };

  const armGestureEnd = () => {
    if (gestureIdleTimer) window.clearTimeout(gestureIdleTimer);
    gestureIdleTimer = window.setTimeout(finishGesture, GESTURE_IDLE_MS);
  };

  const beginGesture = () => {
    gestureActive = true;
    committedInGesture = false;
    // Keep settling until another step actually reaches its threshold.
    // A light reverse tick must not strand the active block between positions.
  };

  const commitStep = (direction: number) => {
    committedInGesture = true;
    accumulatedDelta = 0;
    clearTension();
    setActiveIndex(activeIndex + direction);
    springToActiveStage(direction);
  };

  const onWheel = (event: WheelEvent) => {
    if (
      !story ||
      !desktopQuery.matches ||
      reducedMotionQuery.matches ||
      event.ctrlKey ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY)
    ) {
      return;
    }

    const delta = normalizeWheelDelta(event);
    const direction = Math.sign(delta);
    if (!direction) return;

    if (!event.cancelable) return;
    const now = performance.now();
    const continuesGesture = gestureActive && now - lastWheelTime < GESTURE_IDLE_MS;

    // Direction jitter is still the same gesture, including after commitment.
    if (continuesGesture && committedInGesture) {
      event.preventDefault();
      lastWheelTime = now;
      armGestureEnd();
      return;
    }

    if (!animationMode && accumulatedDelta === 0 && !gestureActive) syncFromPosition();

    const isOutwardBoundary =
      (activeIndex === 0 && direction < 0) ||
      (activeIndex === triggers.length - 1 && direction > 0);

    // Finish the last committed step before releasing native page scrolling.
    if (animationMode === 'scroll' && isOutwardBoundary) {
      event.preventDefault();
      return;
    }

    if (!isStoryInWorkingArea() || (isOutwardBoundary && accumulatedDelta === 0)) {
      resetInteraction();
      return;
    }

    event.preventDefault();
    wheelOwnsState = true;
    if (!continuesGesture) beginGesture();
    lastWheelTime = now;
    armGestureEnd();

    // Reverse impulses first unwind existing tension, rather than initiating
    // an opposite step while the finger is still finishing its previous swipe.
    const previousDirection = Math.sign(accumulatedDelta);
    const nextDelta = accumulatedDelta + delta;
    accumulatedDelta = previousDirection && Math.sign(nextDelta) !== previousDirection
      ? 0
      : nextDelta;

    renderTension(accumulatedDelta / STEP_THRESHOLD);

    if (Math.abs(accumulatedDelta) >= STEP_THRESHOLD) {
      commitStep(Math.sign(accumulatedDelta));
    }
  };

  const resetInteraction = () => {
    if (gestureIdleTimer) window.clearTimeout(gestureIdleTimer);
    gestureIdleTimer = undefined;
    gestureActive = false;
    committedInGesture = false;
    wheelOwnsState = false;
    accumulatedDelta = 0;
    cancelAnimation();
    clearTension();
    lastObservedY = window.scrollY;
  };

  const onNativeScroll = () => {
    const moved = Math.abs(window.scrollY - lastObservedY) > 0.5;
    lastObservedY = window.scrollY;
    if (animationMode) return;
    if (moved) {
      resetInteraction();
      scheduleFallback();
    }
  };

  const onNativeNavigation = () => {
    resetInteraction();
    scheduleFallback();
  };

  const setupFallback = () => {
    if (destroyed) return;
    observer?.disconnect();
    resetInteraction();

    if (!story || !desktopQuery.matches) {
      cancelAnimation();
      clearTension();
      return;
    }

    options.onMeasure?.(activeIndex);

    const restY = window.innerHeight * REST_LINE;
    observer = new IntersectionObserver(scheduleFallback, {
      rootMargin: `-${restY}px 0px -${Math.max(0, window.innerHeight - restY - 1)}px 0px`,
      threshold: 0,
    });

    triggers.forEach((trigger) => observer?.observe(trigger));
    syncFromPosition();
  };

  window.addEventListener('wheel', onWheel, { passive: false, signal: listeners.signal });
  window.addEventListener('scroll', onNativeScroll, { passive: true, signal: listeners.signal });
  window.addEventListener('pointerdown', onNativeNavigation, { passive: true, signal: listeners.signal });
  window.addEventListener('touchstart', onNativeNavigation, { passive: true, signal: listeners.signal });
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      onNativeNavigation();
    }
  }, { signal: listeners.signal });
  window.addEventListener('resize', setupFallback, { signal: listeners.signal });
  desktopQuery.addEventListener('change', setupFallback);
  reducedMotionQuery.addEventListener('change', setupFallback);
  document.fonts.ready.then(setupFallback);
  setupFallback();

  return {
    getState: () => ({
      activeIndex, accumulatedDelta, gestureActive, committedInGesture,
      wheelOwnsState, animationMode,
    }),
    refresh: setupFallback,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.abort();
      observer?.disconnect();
      desktopQuery.removeEventListener('change', setupFallback);
      reducedMotionQuery.removeEventListener('change', setupFallback);
      if (fallbackFrame) cancelAnimationFrame(fallbackFrame);
      resetInteraction();
    },
  };
}
