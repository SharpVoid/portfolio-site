interface ScrollSceneOptions {
  container: HTMLElement;
  triggers: readonly HTMLElement[];
  scrollRange: (index: number) => { start: number; end: number };
  onMeasure: () => void;
  onProgress: (index: number, offset: number, progress: number) => void;
}

/** Native window scroll is the only source of truth. This controller only reads it. */
export function createScrollScene(options: ScrollSceneOptions) {
  const { container, triggers } = options;
  if (!triggers.length || triggers.some(trigger => !container.contains(trigger))) {
    throw new Error('scrollScene: provide ordered markers inside the container');
  }
  const listeners = new AbortController();
  const { signal } = listeners;
  let frame = 0;
  let destroyed = false;
  let needsMeasure = true;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));

  function render() {
    frame = 0;
    if (destroyed) return;
    if (needsMeasure) {
      needsMeasure = false;
      options.onMeasure();
    }
    // Read stable layout markers, never transformed text or accumulated input.
    // Reading every update also covers layout shifts above the scene.
    const ranges = triggers.map((_, index) => options.scrollRange(index));
    const y = window.scrollY;
    const boundaries = ranges.slice(1).map((range, index) =>
      (ranges[index].end + range.start) / 2);
    let index = 0;
    while (index < boundaries.length && y >= boundaries[index]) index++;
    const { start, end } = ranges[index];
    const offset = y < start && index > 0
      ? -clamp((start - y) / Math.max(1, start - boundaries[index - 1]))
      : y > end && index < ranges.length - 1
        ? clamp((y - end) / Math.max(1, boundaries[index] - end)) : 0;
    const progress = clamp((y - ranges[0].start)
      / Math.max(1, ranges.at(-1)!.end - ranges[0].start));
    options.onProgress(index, offset, progress);
  }

  function schedule() {
    if (!destroyed && !frame) frame = requestAnimationFrame(render);
  }
  function refresh() {
    needsMeasure = true;
    schedule();
  }
  const observer = new ResizeObserver(refresh);
  observer.observe(container);
  triggers.forEach(trigger => observer.observe(trigger.parentElement!));
  window.addEventListener('scroll', schedule, { passive: true, signal });
  window.addEventListener('resize', refresh, { passive: true, signal });
  window.addEventListener('pageshow', refresh, { signal });
  window.addEventListener('load', refresh, { signal });
  window.addEventListener('hashchange', refresh, { signal });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', schedule, { signal });
  document.fonts.ready.then(refresh);
  render();

  return {
    refresh,
    destroy() {
      destroyed = true;
      listeners.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
