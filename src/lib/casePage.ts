import { createSteppedScroll } from './steppedScroll';
import { createVideoPlayback } from './videoPlayback';
  const REST_LINE = 0.38;
  const MAX_TENSION_PX = 14;
  const story = document.querySelector<HTMLElement>('[data-case-story]');
  const stageElements = Array.from(document.querySelectorAll<HTMLElement>('[data-case-stage]'));
  const triggers = stageElements
    .map((stage) => stage.querySelector<HTMLElement>('[data-case-trigger]'))
    .filter((trigger): trigger is HTMLElement => Boolean(trigger));
  const visualElements = Array.from(document.querySelectorAll<HTMLElement>('[data-case-visual]'));
  let scrollController: ReturnType<typeof createSteppedScroll> | undefined;
  const imageDialog = document.querySelector<HTMLDialogElement>('.case-image-dialog')!;
  const dialogImage = imageDialog.querySelector<HTMLImageElement>('img')!;
  let previewTrigger: HTMLImageElement | null = null;
  let previousOverflow = '';
  const openImage = (image: HTMLImageElement) => {
    if (imageDialog.open) return;
    previewTrigger = image;
    dialogImage.src = image.dataset.imagePreview!;
    dialogImage.alt = image.alt;
    scrollController?.suspend();
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    imageDialog.showModal();
    syncVideos();
  };
  document.querySelectorAll<HTMLImageElement>('[data-image-preview]').forEach(image => {
    image.addEventListener('click', () => openImage(image));
    image.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        openImage(image);
      }
    });
  });
  imageDialog.querySelector('button')!.addEventListener('click', () => imageDialog.close());
  imageDialog.addEventListener('click', event => {
    if (event.target === dialogImage) imageDialog.close();
    if (event.target === imageDialog) {
      const rect = imageDialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) imageDialog.close();
    }
  });
  imageDialog.addEventListener('close', () => {
    document.documentElement.style.overflow = previousOverflow;
    scrollController?.resume();
    syncVideos();
    previewTrigger?.focus({ preventScroll: true });
  });
  document.addEventListener('astro:before-swap', () => {
    if (imageDialog.open) imageDialog.close();
  }, { once: true });


  const syncVideos = createVideoPlayback(
    [...document.querySelectorAll<HTMLVideoElement>('[data-case-video]')],
    video => video.closest<HTMLElement>('[data-case-visual], [data-stage-image]')?.dataset.active !== 'false'
      && !imageDialog.open,
  );
  const mobile = window.matchMedia('(max-width: 900px)');

  const tags = document.querySelector<HTMLElement>('[data-tags]');
  const toggle = tags?.querySelector<HTMLButtonElement>('button');
  toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Скрыть дополнительные направления' : `Показать ещё ${toggle.dataset.extraCount} направления`);
    toggle.textContent = expanded ? 'скрыть' : `+${toggle.dataset.extraCount}`;
    tags?.classList.toggle('is-expanded', expanded);
  });

  if (story && triggers.length === stageElements.length && triggers.length > 0) {
    let activeIndex = 0;
    let tensionValue = 0;
    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));
    const updateStageSpacing = () => {
      const heights = stageElements.map(stage =>
        stage.querySelector<HTMLElement>('.case-stage__content')?.offsetHeight ?? 0);
      const extra = heights[0] * (1 - 0.6667);
      stageElements.forEach((stage, index) => {
        // Match Problem's visible gaps, including space hidden by the preceding scale.
        const gap = activeIndex === 0 ? (index === 1 ? extra : 0)
          : index === activeIndex ? extra
          : index === activeIndex - 1 ? extra - heights[index] * (1 - 0.6667) : 0;
        stage.style.setProperty('--case-stage-extra-gap', `${gap}px`);
      });
    };
    const setActiveIndex = (nextIndex: number) => {
      const boundedIndex = clamp(nextIndex, 0, stageElements.length - 1);
      if (boundedIndex === activeIndex) return;
      activeIndex = boundedIndex;
      updateStageSpacing();

      stageElements.forEach((stage, index) => {
        stage.classList.toggle('is-active', index === activeIndex);
        const media = stage.querySelector<HTMLElement>('[data-stage-image]');
        if (media) media.dataset.active = String(index === activeIndex);
        stage.classList.remove('is-preview');
        stage.style.removeProperty('--case-preview-progress');
      });

      visualElements.forEach((visual, index) => {
        visual.dataset.active = String(index === activeIndex);
        visual.inert = index !== activeIndex;
        visual.setAttribute('aria-hidden', String(index !== activeIndex));
      });
      syncVideos();
    };

    const clearPreview = () => {
      stageElements.forEach((stage) => {
        stage.classList.remove('is-preview');
        stage.style.removeProperty('--case-preview-progress');
      });
    };

    const renderTension = (value: number) => {
      if (!story) return;

      tensionValue = clamp(value, -1, 1);
      // Slow initial motion, with stronger resistance near the detent.
      const progress = Math.pow(Math.abs(tensionValue), 1.35);
      const direction = Math.sign(tensionValue);

      story.classList.toggle('is-tensioning', progress > 0.001);
      story.style.setProperty('--case-active-translate-y', `${-direction * progress * MAX_TENSION_PX}px`);
      story.style.setProperty('--case-active-scale', String(1 - progress * 0.025));
      story.style.setProperty('--case-active-opacity', String(1 - progress * 0.32));

      clearPreview();
      const previewIndex = activeIndex + direction;
      const preview = stageElements[previewIndex];
      if (preview && progress > 0) {
        preview.classList.add('is-preview');
        preview.style.setProperty('--case-preview-progress', String(progress));
      }
    };

    const clearTension = () => {
      if (!story) return;

      tensionValue = 0;
      story.classList.remove('is-tensioning');
      story.style.removeProperty('--case-active-translate-y');
      story.style.removeProperty('--case-active-scale');
      story.style.removeProperty('--case-active-opacity');
      clearPreview();
    };

    const restPosition = (index: number) => {
      if (mobile.matches) {
        // Tall video steps start at the top; smaller text/media pairs center together.
        const top = stageElements[index].dataset.mobileAlign === 'top' ? 24 : Math.max(24, (window.innerHeight - stageElements[index].offsetHeight) / 2);
        return top + triggers[index].offsetTop;
      }
      const content = stageElements[index]?.querySelector<HTMLElement>('.case-stage__content');
      const triggerOffset = triggers[index]?.offsetTop ?? 0;
      return Math.max(24, (window.innerHeight - (content?.offsetHeight ?? 0)) / 2) + triggerOffset;
    };


    const controller = createSteppedScroll({
      container: story,
      triggers,
      restLine: REST_LINE,
      threshold: 90,
      maxEventDelta: 90,
      springStiffness: 220,
      springDamping: 24,
      springTimeScale: 1,
      restPosition,
      scrollRange: (index) => {
        const stage = stageElements[index].getBoundingClientRect();
        const start = window.scrollY + stage.top + triggers[index].offsetTop - restPosition(index);
        const height = mobile.matches ? stage.height
          : stageElements[index].querySelector<HTMLElement>('.case-stage__content')?.offsetHeight ?? stage.height;
        return { start, end: Math.max(start, window.scrollY + stage.top + height - window.innerHeight + 24) };
      },
      touch: {
        threshold: 80,
        axisThreshold: 8,
      },
      onStep: setActiveIndex,
      onTension: renderTension,
      onClearTension: clearTension,
      onMeasure: () => {
        const visual = story.querySelector<HTMLElement>('.case-story__visual');
        const visualHeight = visual?.offsetHeight ?? 577;
        const firstContent = stageElements[0].querySelector<HTMLElement>('.case-stage__content');
        story.style.setProperty('--case-first-text-offset', `${Math.max(0, (visualHeight - (firstContent?.offsetHeight ?? 0)) / 2)}px`);
        const lastContent = stageElements.at(-1)?.querySelector<HTMLElement>('.case-stage__content');
        story.style.setProperty('--case-last-visual-space', `${(visualHeight + (lastContent?.offsetHeight ?? 0)) / 2}px`);

        updateStageSpacing();

      },
    });
    scrollController = controller;
    // Tear down before an Astro client-side navigation; harmless without a router.
    document.addEventListener('astro:before-swap', () => controller.destroy(), { once: true });
  }
