export function createVideoPlayback(
  videos: HTMLVideoElement[],
  canPlay: (video: HTMLVideoElement) => boolean = () => true,
) {
  if (!videos.length) return () => {};
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nearby = new Set<HTMLVideoElement>();
  const stopped = new Set<HTMLVideoElement>();
  const listeners = new AbortController();
  const { signal } = listeners;

  function shouldPlay(video: HTMLVideoElement) {
    const rect = video.getBoundingClientRect();
    return nearby.has(video) && rect.width > 0 && rect.height > 0 && canPlay(video)
      && !stopped.has(video) && !motion.matches && !document.hidden;
  }

  function updateControls(video: HTMLVideoElement) {
    const button = video.closest('article')?.querySelector<HTMLButtonElement>('.project-card__playback');
    const paused = stopped.has(video) || video.paused;
    if (button) {
      button.hidden = motion.matches || !video.classList.contains('is-playing');
      button.textContent = paused ? '▶' : 'Ⅱ';
      button.setAttribute('aria-label', (paused ? 'Воспроизвести видео: ' : 'Приостановить видео: ') + button.dataset.title);
    } else if (video.hasAttribute('data-case-video')) {
      video.setAttribute('role', motion.matches ? 'img' : 'button');
      if (motion.matches) video.removeAttribute('tabindex'); else video.tabIndex = 0;
      video.setAttribute('aria-label', motion.matches ? video.dataset.title!
        : (paused ? 'Воспроизвести видео: ' : 'Приостановить видео: ') + video.dataset.title);
    }
  }

  function sync() {
    for (const video of videos) {
      const play = shouldPlay(video);
      video.autoplay = play;
      if (play) {
        video.muted = true;
        const sources = [...video.querySelectorAll<HTMLSourceElement>('source[data-src]')];
        if (sources.some(source => !source.hasAttribute('src'))) {
          // No source URLs reach the browser until this video is eligible to play.
          for (const source of sources) source.src = source.dataset.src!;
          const cover = video.parentElement?.querySelector<HTMLImageElement>('picture img');
          if (cover?.currentSrc) video.poster = cover.currentSrc;
          video.load();
        }
        if (video.paused) void video.play().catch(() => {
          video.classList.remove('is-playing');
          updateControls(video);
        });
      } else {
        video.pause();
        if (motion.matches) {
          video.classList.remove('is-playing');
          const sources = [...video.querySelectorAll<HTMLSourceElement>('source[src]')];
          if (sources.length) {
            for (const source of sources) source.removeAttribute('src');
            video.load(); // Reset the decoded frame to the poster and cancel fetching.
          }
        }
      }
      updateControls(video);
    }
  }

  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      const video = target as HTMLVideoElement;
      if (isIntersecting) nearby.add(video); else nearby.delete(video);
    }
    sync();
  }, { rootMargin: '200px 0px', threshold: 0 });

  for (const video of videos) {
    const button = video.closest('article')?.querySelector<HTMLButtonElement>('.project-card__playback');
    const toggle = () => {
      if (motion.matches) return;
      if (stopped.has(video)) stopped.delete(video);
      else if (!video.paused) stopped.add(video);
      sync();
    };
    (button ?? video).addEventListener('click', toggle, { signal });
    if (!button) video.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggle(); }
    }, { signal });
    video.addEventListener('playing', () => {
      if (!shouldPlay(video)) { video.pause(); return; }
      video.classList.add('is-playing');
      updateControls(video);
    }, { signal });
    video.addEventListener('error', () => {
      video.classList.remove('is-playing');
      updateControls(video);
    }, { signal });
    observer.observe(video);
  }
  motion.addEventListener('change', sync, { signal });
  document.addEventListener('visibilitychange', sync, { signal });
  window.addEventListener('resize', sync, { signal });
  document.addEventListener('astro:before-swap', () => {
    observer.disconnect();
    listeners.abort();
    for (const video of videos) { video.autoplay = false; video.pause(); }
  }, { once: true });
  sync();
  return sync;
}
