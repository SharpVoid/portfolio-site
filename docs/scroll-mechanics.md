# Native scroll сцен кейсов

С 1 октября 2026 FocusML, Doverie и Arena используют:

native window scroll → sticky desktop media → section progress → visual state.

## Почему заменён прежний контроллер

`steppedScroll.ts` перехватывал wheel/touchmove с passive:false и preventDefault,
нормализовал и ограничивал delta, накапливал ввод, блокировал жест до следующего
шага и двигал window через spring/scrollTo. Внутренний activeIndex мог владеть
состоянием независимо от scrollY. Resize, reverse input и остаточный momentum
требовали дополнительных веток синхронизации. Этот контроллер удалён.

## Файлы и геометрия

- `src/lib/scrollScene.ts`: только читает scrollY и размеры; один rAF на обновление.
- `src/lib/casePage.ts`: задаёт диапазоны чтения и существующие active/preview
  classes, CSS variables, inert/aria-hidden и воспроизведение видео.
- `src/components/case/CaseSteppedScroll.astro`: прежние статьи, маркеры, desktop
  и mobile media; stage.id также служит якорем deep link.
- `src/styles/case.css`: прежняя сетка, scale/opacity, CSS transitions и sticky.

Высота сцены определяется существующим текстом и отступами, без искусственного
фиксированного 400vh. Sticky-колонка остаётся в границах .case-story; после неё
страница естественно прокручивается дальше. На <=900px сохраняется прежняя
линейная раскладка: media перед текстом, без desktop sticky.

Для каждого шага вычисляется start: document top статьи минус её положение
в viewport (центр для короткого текста, 24px для высокого). end учитывает полный
диапазон чтения высокого текста/мобильной пары media+text. Граница переключения
лежит между end предыдущего и start следующего шага. Начальная композиция
сохранена; межблочные отступы больше не меняются при смене activeIndex.

Section progress = clamp((scrollY - first.start) / (last.end - first.start), 0, 1).
Он доступен как --case-scroll-progress. Локальное смещение относительно диапазона
чтения управляет прежним pull/preview-эффектом. Ни progress, ни index не зависят
от wheel delta, направления предыдущего жеста или таймера. Один и тот же scrollY
при той же геометрии даёт тот же UI. Быстрый скролл может перескочить шаги.

## Обновление и доступность

Scroll listener passive:true. JS не регистрирует wheel/touch-scroll handlers,
не вызывает scrollTo/scrollBy и не записывает scrollTop. Шрифты, ResizeObserver,
resize, load, pageshow и hashchange инициируют повторное измерение. На каждом
scroll кадре читаются актуальные координаты, включая сдвиги выше сцены.
Перед astro:before-swap listeners/observer/rAF отключаются.

Reduced motion отключает preview-смещение и CSS transitions. Неактивные desktop
media сохраняют inert/aria-hidden. Блокировка overflow разрешена только на время
открытого image dialog; закрытие обновляет геометрию без доведения scroll position.
Keyboard preventDefault остаётся только у действий изображения/видео (Enter/Space).

Выбран JS + rAF: он переиспользует текущие состояния, видео и accessibility
callbacks без новой зависимости от поддержки CSS scroll timelines.

## Проверка

Запустить `astro dev --background --port 4321`, затем:

```sh
npm run build
node scripts/check-native-scroll.mjs
node scripts/check-image-dialog.mjs
```

`check-native-scroll.mjs` проверяет три кейса при 1440, 1920, 901x400, 800 и 390px:
все шаги, одинаковое состояние при возврате к scrollY, неподвижные layout markers,
нативный mouse wheel, быстрый/обратный ввод, trackpad-sized ticks, настоящий CDP
touch, выход из сцены, reload, якоря, resize через breakpoint и reduced motion.
В тесте контролируются отмена wheel/touchmove и программные scroll-записи.

`--capture-before` сохраняет исходные снимки до рефакторинга; обычный запуск
сохраняет after PNG и сравнивает размеры текста с baseline при его наличии.
SITE_URL, SCROLL_SNAPSHOT_DIR, PLAYWRIGHT_MODULE и CHROME_PATH переопределяют
локальный сервер, каталог снимков, установленный Playwright и браузер.
По умолчанию используется установленный Edge, без новых зависимостей.
Старые проверки spring, gesture lock и stepped touch удалены.
