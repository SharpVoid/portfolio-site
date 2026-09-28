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
  /** Opt-in touch adapter below desktopQuery; uses the same step state and spring. */
  touch?: {
    threshold?: number;
    axisThreshold?: number;
    /** Document scroll range for reading a tall step before changing steps. */
    scrollRange?: (index: number) => { start: number; end: number };
  };
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
  const touchThreshold = options.touch?.threshold ?? 80;
  const touchAxisThreshold = options.touch?.axisThreshold ?? 8;
  if (![touchThreshold, touchAxisThreshold].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('steppedScroll: invalid touch options');
  }
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners = new AbortController();
  let destroyed = false;
  let suspended = false;
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
  let touchPoint: { x: number; y: number } | null = null;
  let touchMode: 'pending' | 'controlled' | 'native' = 'native';
  let nativeTouch = false;
  const mobileEnabled = () => Boolean(options.touch) && !desktopQuery.matches;
  const enabled = () => !suspended && (desktopQuery.matches || mobileEnabled());

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
    const destination = direction === 0 ? requested : direction > 0
      ? Math.max(window.scrollY, requested)
      : Math.min(window.scrollY, requested);

    startSpring('scroll', window.scrollY, destination);
  };

  const syncFromPosition = () => {
    fallbackFrame = 0;
    if (!story || !enabled() || gestureActive || animationMode || wheelOwnsState || accumulatedDelta !== 0) return;

    let nextIndex = 0;

    triggers.forEach((trigger, index) => {
      if (trigger.getBoundingClientRect().top <= restPosition(index) + 2) nextIndex = index;
    });

    setActiveIndex(nextIndex);
  };

  const scheduleFallback = () => {
    if (
      !enabled() ||
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

  const accumulate = (delta: number, threshold: number) => {
    // Reverse input unwinds tension before it can begin the opposite step.
    const previousDirection = Math.sign(accumulatedDelta);
    const nextDelta = accumulatedDelta + delta;
    accumulatedDelta = previousDirection && Math.sign(nextDelta) !== previousDirection
      ? 0 : nextDelta;
    renderTension(accumulatedDelta / threshold);
    if (Math.abs(accumulatedDelta) >= threshold) commitStep(Math.sign(accumulatedDelta));
  };

  const onWheel = (event: WheelEvent) => {
    if (
      suspended ||
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
    accumulate(delta, STEP_THRESHOLD);
  };

  const touchRange = (index: number) => {
    const start = window.scrollY + triggers[index].getBoundingClientRect().top - restPosition(index);
    return options.touch?.scrollRange?.(index) ?? { start, end: start };
  };
  const instantScroll = (y: number) => {
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    lastObservedY = window.scrollY;
    document.documentElement.style.scrollBehavior = behavior;
  };
  const onTouchStart = (event: TouchEvent) => {
    if (suspended) return;
    if (!mobileEnabled() || reducedMotionQuery.matches) { onNativeNavigation(); return; }
    const target = event.target as Element;
    if (event.touches.length !== 1 || target.closest('a, button, input, textarea, select, [contenteditable="true"], [data-scroll-native]')) {
      touchPoint = null;
      nativeTouch = false;
      onNativeNavigation();
      return;
    }
    if (!animationMode && accumulatedDelta === 0) syncFromPosition();
    const point = event.touches[0];
    touchPoint = { x: point.clientX, y: point.clientY };
    touchMode = 'pending';
    nativeTouch = true;
    beginGesture();
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!touchPoint || !mobileEnabled() || reducedMotionQuery.matches) return;
    if (event.touches.length !== 1) { onTouchEnd(); nativeTouch = false; resetInteraction(); return; }
    const point = event.touches[0];
    const delta = touchPoint.y - point.clientY;
    const horizontal = point.clientX - touchPoint.x;
    if (touchMode === 'pending') {
      if (Math.max(Math.abs(delta), Math.abs(horizontal)) < touchAxisThreshold) return;
      const first = touchRange(0).start;
      const last = touchRange(triggers.length - 1).end;
      const outside = (window.scrollY < first - 2 && window.scrollY + delta < first)
        || (window.scrollY > last + 2 && window.scrollY + delta > last);
      const outward = (activeIndex === 0 && delta < 0 && window.scrollY <= first + 2)
        || (activeIndex === triggers.length - 1 && delta > 0 && window.scrollY >= last - 2);
      touchMode = Math.abs(horizontal) >= Math.abs(delta) || outside || (outward && !animationMode && accumulatedDelta === 0)
        ? 'native' : 'controlled';
      if (touchMode === 'native') {
        if (Math.abs(horizontal) >= Math.abs(delta)) nativeTouch = false;
        resetInteraction();
        return;
      }
      if (event.cancelable && (window.scrollY < first - 2 || window.scrollY > last + 2)) {
        event.preventDefault();
        setActiveIndex(window.scrollY < first ? 0 : triggers.length - 1);
        wheelOwnsState = true;
        committedInGesture = true;
        springToActiveStage(0);
        return;
      }
    }
    if (touchMode !== 'controlled' || !event.cancelable) return;
    event.preventDefault();
    touchPoint = { x: point.clientX, y: point.clientY };
    wheelOwnsState = true;
    if (committedInGesture) return;
    if (animationMode === 'scroll') {
      const outward = (activeIndex === 0 && delta < 0) || (activeIndex === triggers.length - 1 && delta > 0);
      if (!outward) accumulate(delta, touchThreshold);
      return;
    }
    const range = touchRange(activeIndex);
    // Let tall content be read, without allowing one fast swipe to cross it and another step.
    const reading = delta > 0 ? window.scrollY < range.end - 2 : window.scrollY > range.start + 2;
    if (reading) {
      accumulatedDelta = 0;
      clearTension();
      const destination = clamp(window.scrollY + delta, range.start, range.end);
      instantScroll(destination);
      // Reaching the reading edge consumes this gesture; the next swipe changes step.
      if (Math.abs(destination - (delta > 0 ? range.end : range.start)) < 2) committedInGesture = true;
      return;
    }
    const outward = (activeIndex === 0 && delta < 0) || (activeIndex === triggers.length - 1 && delta > 0);
    if (outward) { instantScroll(window.scrollY + delta); return; }
    accumulate(delta, touchThreshold);
  };
  const onTouchEnd = () => {
    touchPoint = null;
    touchMode = 'native';
    if (mobileEnabled()) finishGesture();
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
    if (suspended) return;
    const previousY = lastObservedY;
    const moved = Math.abs(window.scrollY - lastObservedY) > 0.5;
    lastObservedY = window.scrollY;
    if (animationMode) return;
    // Catch native entry/inertia from outside before it can skip the first/last step.
    if (mobileEnabled() && nativeTouch && !reducedMotionQuery.matches && moved) {
      const first = touchRange(0).start;
      const last = touchRange(triggers.length - 1).end;
      const enteringDown = previousY < first && window.scrollY >= first;
      const enteringUp = previousY > last && window.scrollY <= last;
      if (enteringDown || enteringUp) {
        setActiveIndex(enteringDown ? 0 : triggers.length - 1);
        wheelOwnsState = true;
        committedInGesture = true;
        nativeTouch = false;
        touchMode = 'controlled';
        springToActiveStage(0);
        return;
      }
    }
    if (moved) {
      resetInteraction();
      scheduleFallback();
    }
  };

  const onNativeNavigation = () => {
    nativeTouch = false;
    resetInteraction();
    scheduleFallback();
  };

  const setupFallback = () => {
    if (destroyed || suspended) return;
    const preserveStep = wheelOwnsState && (mobileEnabled()
      || (desktopQuery.matches && activeIndex > 0 && isStoryInWorkingArea()));
    touchPoint = null;
    nativeTouch = false;
    observer?.disconnect();
    resetInteraction();

    if (!story || !enabled()) {
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
    if (preserveStep && !reducedMotionQuery.matches) {
      wheelOwnsState = true;
      springToActiveStage(0);
    } else syncFromPosition();
  };

  window.addEventListener('wheel', onWheel, { passive: false, signal: listeners.signal });
  window.addEventListener('scroll', onNativeScroll, { passive: true, signal: listeners.signal });
  window.addEventListener('pointerdown', (event) => {
    // A content click is not a request to interrupt the committed scroll target.
    // Scrollbar dragging and explicit keyboard/native navigation still release it.
    if (desktopQuery.matches && animationMode === 'scroll' && event.button === 0
      && event.clientX < document.documentElement.clientWidth
      && event.clientY < document.documentElement.clientHeight) return;
    if (!(event.pointerType === 'touch' && mobileEnabled())) onNativeNavigation();
  }, { passive: true, signal: listeners.signal });
  window.addEventListener('touchstart', onTouchStart, { passive: true, signal: listeners.signal });
  window.addEventListener('touchmove', onTouchMove, { passive: false, signal: listeners.signal });
  window.addEventListener('touchend', onTouchEnd, { passive: true, signal: listeners.signal });
  window.addEventListener('touchcancel', () => { onTouchEnd(); nativeTouch = false; resetInteraction(); }, { passive: true, signal: listeners.signal });
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
    suspend() {
      suspended = true;
      touchPoint = null;
      nativeTouch = false;
      observer?.disconnect();
      resetInteraction();
    },
    resume() {
      if (destroyed || !suspended) return;
      suspended = false;
      options.onMeasure?.(activeIndex);
      wheelOwnsState = true;
      lastObservedY = window.scrollY;
      triggers.forEach(trigger => observer?.observe(trigger));
      if (desktopQuery.matches && activeIndex > 0 && isStoryInWorkingArea() && !reducedMotionQuery.matches) {
        springToActiveStage(0);
      }
    },
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
