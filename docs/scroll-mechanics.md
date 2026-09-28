# Scroll mechanics — stepped / snap / tension

Снимок реализации: 28 сентября 2026. Маршрут: /projects/doverie/.
Этот документ описывает **существующее поведение**, а не идеальный scroll API.
После обновления дизайна изменены разметка, стили и медиа страницы.
Desktop-алгоритм и параметры жеста/анимации сохранены. Touch — opt-in адаптер
того же src/lib/steppedScroll.ts, с общими индексом, accumulate, commitStep и spring.
Это не CSS scroll-snap: колесо переключает дискретное состояние, а окно
доводится до позиции шага через requestAnimationFrame.

## Architecture

| Часть | Файл | Ответственность |
| --- | --- | --- |
| Reusable core | src/lib/steppedScroll.ts | Ввод, накопление delta, шаг, блокировка жеста, spring прокрутки, native fallback, resize, cleanup |
| Page-specific logic | src/pages/projects/doverie.astro, клиентский script | Выбор DOM, презентационное состояние, tension, расчёт центров и отступов |
| Styles | doverie.astro, scoped style | Sticky, текст, изображения, адаптив, переходы и reduced motion |
| Animation logic | runSpring в core + CSS страницы | Core двигает window.scrollY; страница рисует tension и переходы |
| Проверка | scripts/check-stepped-scroll.mjs | Браузерные регрессионные проверки |
| Данные / ресурсы | stages и src/assets/projects/doverie-{hero,flow,architecture}.png и public/videos/doverie/ | Контент; не нужны reusable core |
| Окружение | src/layouts/BaseLayout.astro, src/styles/{global,tokens,fonts}.css | Оболочка, шрифты; core от них не зависит |

Модуль не импортирует Astro, библиотеки анимации или CSS. В нём нет case-селекторов.
Он управляет прокруткой **window**, а container ограничивает рабочую область.
Нельзя передать overflow-контейнер и ожидать, что будет прокручиваться он.

Состояние activeIndex принадлежит core. Локальный activeIndex страницы —
синхронная копия для отрисовки, обновляемая onStep. Не меняйте её отдельно.
Количество шагов определяется triggers.length, отдельного параметра count нет.

## Scroll algorithm — desktop wheel

1. На window установлен wheel с passive:false. На мобильном (до 900px
   включительно), при reduced motion, Ctrl+wheel, преимущественно горизонтальном
   вводе и неотменяемом событии обработчик не перехватывает ввод.
2. normalizeWheelDelta переводит deltaMode: pixels ×1, lines ×16,
   pages ×innerHeight. Результат ограничивается диапазоном [-60,60].
   Направление — Math.sign(delta), а не разница scrollY.
3. Рабочая область: контейнер пересекает горизонтальную линию 0.38 высоты окна.
   Вне области управление остаётся браузеру.
4. Жест продолжается, пока промежуток между событиями меньше 120ms.
   После commit остаток **того же жеста** подавляется даже при дрожании знака.
   Каждый подавленный импульс продлевает таймер. Это не фиксированный
   cooldown от момента переключения.
5. До commit signed delta складывается в accumulatedDelta. Если обратный ввод
   пересёк ноль, значение становится ровно 0: остаток не начинает обратный шаг.
6. onTension получает clamp(accumulatedDelta / 120,-1,1).
   Пока модуль владеет вводом, preventDefault не даёт нативно двигать страницу.
   Текст слегка смещается, тускнеет и показывает соседний шаг.
7. При abs(accumulatedDelta) >=120 commitStep обнуляет сумму, очищает tension,
   меняет индекс ровно на +1 или -1, вызывает onStep, запускает spring.
   Изображение и класс текста меняются синхронно, не по завершении spring.
   Избыток delta отбрасывается, цикла переключения нескольких шагов нет.
8. После 120ms тишины finishGesture снимает флаги жеста, но **сохраняет
   недобранную сумму и tension**. Поэтому медленные отдельные щелчки работают.
   Новый полноценный жест может переключить следующий шаг ещё до окончания
   предыдущей анимации. Это существующее поведение, не общий animation lock.
9. Лёгкий обратный импульс НЕ останавливает движение к текущему шагу.
   Прервать его новым назначением можно лишь после набора порога.
10. На первом шаге наружу вверх, на последнем наружу вниз браузер получает
    управление, если нет tension. Во время доведения к крайнему шагу наружный
    ввод блокируется до конца движения. Нет body overflow:hidden.
11. pointerdown, touchstart, навигационные клавиши и реальный native scroll
    сбрасывают interaction. Клавиши: ArrowUp/Down, PageUp/Down, Home, End, Space.
    resize и изменения media query также сбрасывают состояние и пересчитывают
    геометрию. После document.fonts.ready измерения повторяются.

### Mobile / touch (opt-in)

Параметр `touch` включает адаптер ниже desktopQuery; без него прежняя линейная
mobile-версия остаётся native. Wheel на узком экране по-прежнему native.
На Doverie переданы `threshold:80`, `axisThreshold:8`, `scrollRange(index)`.

- touchstart запоминает координаты одного пальца. Touch pointerdown не сбрасывает
  накопленное натяжение; остальные pointerdown сохраняют прежнее поведение.
- После движения на 8px определяется вертикальная/горизонтальная ось.
  Горизонтальный жест, multitouch, reduced motion и интерактивные элементы
  (`a,button,input,textarea,select,[contenteditable=true],[data-scroll-native]`)
  остаются браузеру. На контролируемом вертикальном touchmove вызывается
  preventDefault, listener обязательно passive:false. Тапы не отменяются.
- Delta = previousClientY−currentClientY, в CSS px; скорость и абсолютный
  scrollY не добавляются к порогу. Signed delta проходит через ту же accumulate,
  что wheel: обратный ввод сначала снимает натяжение, затем начинает обратный шаг.
- Один touchstart→touchend — один gesture, без wheel idle-таймера. После commit
  весь остаток этого жеста блокируется. Быстрый свайп тоже меняет максимум один
  индекс. Новый жест во время spring может набрать порог нового шага, как desktop.
- touchend снимает lock, но сохраняет недобранную сумму, как медленные wheel ticks.
  touchcancel/multitouch сбрасывают взаимодействие. Нет body scroll lock.
- Страница задаёт диапазон чтения `[start,end]` каждого блока. Пока длинный блок
  не дочитан, палец двигает окно 1:1 внутри диапазона, не меняя activeIndex.
  Достижение границы чтения завершает этот gesture без смены шага; новый свайп
  набирает порог. Это необходимо: видео673px + текст не помещаются в экран телефона.
- В начале первого шага вверх и в конце последнего вниз новый жест получает
  native scroll, включая инерцию. Вход из hero/CTA фиксирует первый/последний шаг,
  а не сразу переключает следующий. onNativeScroll также ловит пересечение
  границы инерцией внешнего native-жеста и доводит к anchor общей spring-анимацией,
  чтобы остаточная инерция не проскочила весь кейс.
- onStep синхронно меняет `.is-active`, desktop `data-active` и mobile
  `[data-stage-image].dataset.active`. Видео играет только у видимого активного
  шага. Tension одинаково смещает текст и mobile media, но НЕ marker/article.
- При resize/orientation контролируемого mobile-шага индекс сохраняется,
  геометрия пересчитывается и spring доводит до нового anchor. Desktop resize
  также доводит контролируемые шаги >0 до нового центра. Вне контролируемого
  шага используется fallback.

Mobile restPosition: для первых трёх шагов весь article (media+text) центрируется,
если помещается; минимум top24px. Для shared-account и nearby top всегда24px.
Передаваемый restPosition включает trigger.offsetTop, как desktop.
scrollRange.start = documentTop(article)−top;
scrollRange.end = max(start,documentBottom(article)−innerHeight+24).
Отступ между article остаётся121px, gap media→text36px. Размеры медиа не изменены.

### Spring / позиционирование

Для маркера выбранного шага:
requested = clamp(scrollY + marker.top - restPosition(index), 0, maxScroll).
Вниз destination не меньше текущего scrollY; вверх — не больше.
Это предотвращает движение против направления ввода.

В каждом кадре:
acceleration = (target - position) ×180 - velocity ×26.
dt = clamp(elapsedSeconds ×1.5, 0.001, 0.032).
Обновляются velocity и position. Новая позиция ограничена интервалом от
предыдущей до target: overshoot запрещён. Завершение — остаток расстояния
и абсолютная скорость оба меньше 0.5, затем точный scrollTo(target).

Фиксированной duration или easing у spring **нет**. Продолжительность зависит
от расстояния и кадров (обычно порядка 0.6–1s). CSS easing — отдельная вещь.
Временно выставляется html.style.scrollBehavior='auto', иначе глобальное
smooth из CSS конфликтует с покадровым scrollTo. При finish/cancel/destroy
восстанавливается прежнее inline-значение.

Ветка animationMode='tension' осталась из исходника. Сейчас startSpring
вызывается только с 'scroll': отпускание tension по таймеру НЕ используется.
Она сохранена, чтобы не совмещать извлечение с очисткой алгоритма.

### Как определяется активная секция без wheel

IntersectionObserver наблюдает маркеры в полосе высотой 1px на уровне
0.38H; native scroll также планирует один rAF syncFromPosition.
Выбирается последний маркер с top <= restPosition(index)+2px.
IO — вспомогательный сигнал, а не механизм stepped input.

Пока есть gesture, animation, accumulatedDelta или wheelOwnsState,
позиционный fallback не переопределяет индекс. Это не даёт ему вернуть
предыдущий блок во время перехода. Реальная native-прокрутка вне анимации
сбрасывает ownership и разрешает синхронизацию.
Native навигация может перескочить несколько секций — ограничение
«один шаг» относится к перехваченному wheel, не к Home/End/scrollbar.

## Parameters

### Core: значения по умолчанию в createSteppedScroll

| API / значение | На что влияет; изменение |
| --- | --- |
| threshold=120 | Суммарный порог. Больше — сильнее/дольше тянуть; меньше — легче commit |
| maxEventDelta=60 | Ограничение одного импульса после нормализации. Больше — крупные события быстрее набирают порог; меньше — больше событий |
| gestureIdleMs=120 | Граница жеста и lock остаточной инерции. Больше — меньше повторных шагов, дольше ждать; меньше — риск разделить инерцию на новые жесты |
| restLine=0.38 | Линия входа в рабочую область и IO; без callback также позиция остановки. Больше — линия ниже, вход раньше при движении вниз |
| springStiffness=180 | Притяжение к цели. Больше — резче; меньше — медленнее |
| springDamping=26 | Торможение. Больше обычно замедляет доведение; меньше повышает скорость; overshoot всё равно обрезан |
| springTimeScale=1.5 | Скорость интегрирования. Больше — быстрее, меньше — медленнее; dt ограничен |
| desktopQuery='(min-width: 901px)' | Где доступен stepped wheel. Повышение breakpoint расширяет линейную мобильную область; согласуйте CSS |
| touch (по умолчанию отсутствует) | Opt-in stepped touch ниже desktopQuery; на Doverie включён |
| touch.threshold=80 | Порог движения пальца в CSS px; больше — более длинный свайп |
| touch.axisThreshold=8 | Минимум движения для определения оси; больше — позже захват |
| touch.scrollRange(index) | Диапазон чтения длинного шага; без callback только anchor |
| initialIndex=0 | Стартовый индекс (целый, ограничен диапазоном). Fallback при setup может сразу заменить его по позиции окна |
| triggers.length=5 на странице | about, problem, solution, shared-account, nearby; изменение массива меняет границы |
| sensitivity | Отдельного API нет: исходный коэффициент 1; регулировать threshold / maxEventDelta |
| duration / easing / cooldown | Не выдуманы: spring-параметры + gestureIdleMs, CSS отдельно |

Фиксированные численные детали core (не вынесены в API):
line delta multiplier 16; page multiplier innerHeight; dt 0.001–0.032s;
допуск fallback 2px; native movement >0.5px; завершение spring <0.5px
и <0.5 единиц скорости; IO threshold=0, полоса 1px.
Увеличение допусков делает синхронизацию/завершение менее точными,
уменьшение может обнажить округление браузером. Без причины не менять.

### Page-specific: doverie.astro

| Значение / место | Эффект при изменении |
| --- | --- |
| REST_LINE=0.38 | Передаётся в core, используется для первого шага |
| restPosition, шаги >0 | H/2 - content.offsetHeight/2 + trigger.offsetTop: центр текста совпадает с центром окна |
| MAX_TENSION_PX=14 | Максимальное смещение текста. Больше — заметнее натяжение |
| progress=abs(tension)^1.35 | Больше степень — слабее ранняя реакция, сильнее у порога |
| active scale=1-progress×0.025 | Больше коэффициент — сильнее уменьшение |
| active opacity=1-progress×0.32 | Больше коэффициент — сильнее затухание |
| preview opacity=0.28+progress×0.18 | Больше 0.18 — соседний текст заметнее |
| preview scale=0.6667+progress×0.1 | Больше 0.1 — сильнее рост соседнего текста |
| preview translate=activeTranslate×0.6 | Больше коэффициент — больше движение соседнего текста |
| is-tensioning при progress>0.001 | Порог отключения CSS transitions для непосредственного отклика |
| --case-sticky-offset:72px | Верх изображения на первом шаге. Больше — ниже |
| --case-centered-offset | CSS max(16px,(100vh - --case-visual-height)/2); центр не зависит от сохранённого JS-замера |
| --case-stage-spacing:150px | Расстояние между layout-блоками. Больше — длиннее переход |
| --case-stage-extra-gap | updateStageSpacing(): extra=about.offsetHeight×(1-0.6667); после активного шага >0 ставится extra, перед ним — extra−previousHeight×(1-0.6667). Видимые отступы с обеих сторон равны 150px+extra, как у «Проблемы». Пересчёт при смене шага и onMeasure; mobile не применяет margin |
| --case-last-visual-space | (visualHeight+lastContent.offsetHeight)/2; резерв в конце sticky-контейнера |
| last-child min-height | max(50vh,62vh-80px,last-visual-space); меньше резерв — риск упереться в конец sticky |
| --case-inactive-opacity:0.28; scale:0.6667 | Больше — неактивный текст заметнее/крупнее |
| --case-transition-duration:420ms | Длительность текста. Больше — плавнее, но медленнее |
| --case-image-fade-duration:340ms | Crossfade. Больше — дольше смешиваются картинки |
| --case-image-motion-duration:440ms | Движение изображения и переход sticky top |
| --case-ease-out:cubic-bezier(0.22,1,0.36,1) | Текущее замедление CSS. У кривой нет простого «больше/меньше» |
| Неактивная картинка translateY(13px) scale(0.985) | Это фактическая текущая версия; не заменять молча на ранние требования |
| delayed marker top:30px | Со второго шага; restPosition добавляет тот же offset, поэтому он сокращается в расчёте цели, НЕ отдельная задержка на 30px |
| mobile breakpoint <=900px | Нет sticky/wheel; stepped touch, медиа перед текстом; gap121px |
| visual width по колонке; height=min(673px,100svh-32px), от1680px — min(675px,100svh-32px) | Стабильная высота между шагами; важна для расчёта центра |
| problem image | Новая схема doverie-flow.png, natural aspect ratio; старый crop больше не нужен |

## Page integration

В клиентском script импортируется createSteppedScroll из ../../lib/steppedScroll.
Не переносите инициализацию в frontmatter: она требует window и DOM.

Передаются container=[data-case-story] и массив triggers из каждого
[data-case-stage] → [data-case-trigger], в порядке массива stages.
Страница проверяет наличие контейнера, ненулевую длину и совпадение количеств.

Подключение:
~~~ts
const controller = createSteppedScroll({
  container: story,
  triggers,
  restLine: REST_LINE,
  restPosition,
  touch: { threshold: 80, axisThreshold: 8, scrollRange }, // page-specific reading range
  onStep: setActiveIndex,
  onTension: renderTension,
  onClearTension: clearTension,
  onMeasure: () => { /* измерения visual, about, lastContent и CSS variables */ },
});
~~~

setActiveIndex переключает .is-active у текста, data-active у изображения
и data-centered у story. Изображения сопоставлены **по индексу**, а не поиском
по ID; массивы обязаны иметь одинаковый порядок.
renderTension добавляет .is-tensioning, .is-preview и CSS variables.
clearTension их удаляет. Ни текст, ни изображение не создаются заново при шаге.

onMeasure вызывается перед созданием IO на desktop. Он рассчитывает
центр изображения, нижний резерв и дополнительный промежуток после problem.
Это оставлено на странице: вынос формул размеров конкретного дизайна
сделал бы reusable core зависимым от банковского кейса.

API контроллера:
- suspend()/resume(): временная пауза ввода и spring без смены activeIndex.
  Doverie вызывает их при открытии/закрытии нативного image dialog; фон блокируется
  через html overflow:hidden с восстановлением предыдущего значения. Resume
  измеряет геометрию и сохраняет текущий шаг, не перескакивая по fallback.
  На desktop для шагов >0 внутри рабочей области также доводит текст к центру
  медиа общей spring-анимацией; mobile и reduced motion не перепозиционируются.
- getState(): диагностический снимок activeIndex, accumulatedDelta,
  gestureActive, committedInGesture, wheelOwnsState, animationMode.
- refresh(): reset + новые измерения/IO + синхронизация. После динамической
  смены размеров контента вызовите вручную; это не ResizeObserver.
- destroy(): удаляет listeners, IO, rAF, таймер, очищает tension и возвращает
  scrollBehavior. Безопасен повторный вызов; fonts.ready после destroy не
  запускает настройку заново.

onStep не вызывается при неизменившемся индексе, в том числе при старте.
Начальную разметку рисуйте согласованно с initialIndex. onMeasure получает
индекс; onTension получает signed value и индекс. Callbacks синхронные,
не должны бросать исключения или мутировать массив triggers.

Страница вызывает destroy на astro:before-swap. Сейчас BaseLayout без
ClientRouter; для проекта с ClientRouter нужна также повторная инициализация
на astro:page-load (не просто повторное выполнение импортированного script).
В HMR-интеграциях уничтожайте предыдущий controller до создания нового.

## Adding a new section

1. Добавьте объект с уникальным id, title, paragraphs, alt и image либо video+poster в stages.
2. Оба map в существующей разметке автоматически добавят текст, маркер,
   мобильную картинку и desktop visual в одинаковом порядке.
3. Не переносите маркер внутрь масштабируемого .case-stage__content.
4. Перезапустите/обновите страницу; core получает новый массив DOM только
   при инициализации. При динамическом DOM: destroy, заново собрать массивы,
   создать controller. refresh не заменяет triggers.
5. Проверьте новую последнюю секцию и резерв снизу; onMeasure использует at(-1).
6. Проверьте desktop в обе стороны, mobile, reduced motion и длинный текст.
   Логика дополнительного отступа пока привязана к id problem — менять
   её при другом дизайне нужно намеренно.

## Removing a section

1. Удалите объект из stages, а не только текст или только изображение.
2. Удалите неиспользуемый импорт ресурса, если он больше нигде не нужен.
3. Если удаляете problem, проверьте относящиеся к нему CSS gap правила;
   они не ломают core, но становятся лишними.
4. Пересоздайте controller при динамическом удалении; начальный индекс должен
   соответствовать новой разметке. Для нуля секций не инициализируйте core.
5. Проверьте первую и последнюю границу и mobile.
   Тест кейса содержит названия пяти текущих шагов: обновите ожидания осознанно.

## Reusing on another page

Скопируйте минимальную страницу ниже в src/pages/scroll-demo.astro.
Импорт ../lib/steppedScroll подходит этому расположению.
Нет обязательных CSS-классов в core: селекторы и оформление выбирает страница.
Одна инициализация на документ. Две механики одновременно с глобальными
wheel listeners не поддержаны этим минимальным извлечением.

## Reusing in another Astro project

Перенесите src/lib/steppedScroll.ts и этот документ.
Минимальный пример не требует BaseLayout, шрифтов, изображений или UI-framework.
Для полной копии «Доверия» дополнительно нужны сама страница, её три PNG, папка public/videos/doverie/ с MP4 и постерами,
Footer, BaseLayout и импортируемые им стили/шрифты. Сохраните scoped CSS страницы.

Runtime зависимости: стандартные DOM API (IntersectionObserver, matchMedia,
requestAnimationFrame, AbortController, document.fonts). npm зависимости
механики отсутствуют. Astro компилирует TypeScript клиентского script.
Playwright требуется только для необязательного проверочного скрипта.
Не импортируйте и не вызывайте core на сервере.

## Minimal reusable implementation

Полный файл src/pages/scroll-demo.astro. Это минимальная **интеграция того же
core**, не вторая реализация алгоритма. Сначала перенесите steppedScroll.ts.

~~~astro
---
const steps = [
  { title: 'Первый шаг', text: 'Первый текст.' },
  { title: 'Второй шаг', text: 'Второй текст.' },
  { title: 'Третий шаг', text: 'Третий текст.' },
];
---
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>Stepped scroll demo</title>
  </head>
  <body>
    <header>Прокрутите вниз</header>
    <main data-demo>
      {steps.map((step, index) => (
        <section class:list={['step', { active: index === 0 }]}>
          <span class="marker" aria-hidden="true"></span>
          <div class="content">
            <h2>{step.title}</h2>
            <p>{step.text}</p>
          </div>
        </section>
      ))}
    </main>
    <footer>Обычная прокрутка после последнего шага</footer>
  </body>
</html>

<script>
  import { createSteppedScroll } from '../lib/steppedScroll';
  const container = document.querySelector<HTMLElement>('[data-demo]')!;
  const sections = [...container.querySelectorAll<HTMLElement>('.step')];
  const triggers = sections.map(s => s.querySelector<HTMLElement>('.marker')!);
  const controller = createSteppedScroll({
    container,
    triggers,
    onStep(index) {
      sections.forEach((s, i) => s.classList.toggle('active', i === index));
    },
    onTension(value, index) {
      const progress = Math.abs(value) ** 1.35;
      sections[index].style.setProperty('--pull', `${-Math.sign(value) * progress * 14}px`);
    },
    onClearTension() {
      sections.forEach(s => s.style.removeProperty('--pull'));
    },
  });
  document.addEventListener('astro:before-swap', () => controller.destroy(), { once: true });
</script>

<style>
  :global(body) { margin: 0; font: 18px/1.5 system-ui; }
  header, footer { min-height: 60vh; padding: 24px; }
  main { max-width: 800px; margin: auto; padding: 0 24px; }
  .step { position: relative; min-height: 70vh; }
  .marker { position: absolute; top: 0; width: 1px; height: 1px; }
  .content { opacity: .28; transform: translateY(var(--pull, 0px)); }
  .active .content { opacity: 1; }
  h2 { margin-top: 0; }
  @media (max-width: 900px) {
    .step { min-height: 0; margin-bottom: 72px; }
    .content { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .content { transform: none; }
  }
</style>
~~~

## Recovery checklist

«Scroll полностью сломался — что делать»:

1. Убедиться, что файл страницы и src/lib/steppedScroll.ts существуют,
   dev server запущен, console без ошибок.
2. Проверить container и markers: все находятся внутри контейнера,
   по одному на шаг, в том же порядке, что текст/изображения.
3. Проверить, что createSteppedScroll вызван ровно один раз в клиентском script,
   wheel listener passive:false; не загружена старая вторая копия обработчика.
4. Проверить breakpoint, opt-in touch и prefers-reduced-motion: reduced motion
   и mobile без touch-конфигурации используют native scroll.
5. Проверить threshold=120, cap=60. Один большой wheel-импульс намеренно
   не переключает шаг; нужны минимум два capped импульса.
6. Посмотреть controller.getState(): index в диапазоне, delta signed,
   committed сбрасывается после тишины 120ms, animationMode в итоге null.
   Не обнулять accumulatedDelta по idle: сломается медленное колесо.
7. Проверить release у первого/последнего шага. Для ручного сброса refresh().
   Для полного отключения destroy(); затем новая инициализация.
8. Проверить CSS sticky: предки не должны неожиданно менять overflow,
   высота контейнера достаточна, последний шаг имеет нижний резерв.
9. Проверить marker вне transform, natural offsetHeight, отсутствие
   конфликтующего scroll-snap, Lenis, smooth-scroll или второго scrollTo.
10. Сравнить с минимальным примером. Если он работает, проблема в геометрии,
    callbacks или стилях страницы, а не в core.
11. Запустить регрессионный скрипт и сборку; восстанавливать core вместе с
    page callbacks/CSS из одного сохранённого состояния проекта.

## Known pitfalls / сохранённые решения

- Не накапливать абсолютное scrollY вместо wheel delta: начальная сумма 0.
- Не сбрасывать незавершённое натяжение через 120ms: иначе слабое колесо
  «отпрыгивает» и кажется сломанным.
- Не отменять spring от любого нового импульса: раньше это оставляло текст
  на полпути, а центрированное изображение отдельно.
- Не отдавать native wheel наружу во время доведения к крайнему шагу:
  можно оказаться между секциями с неправильным активным изображением.
- Не разрешать IO переопределять индекс, которым владеет wheel.
- Смена знака внутри committed gesture — дрожание/инерция, не новый шаг.
- Не добавлять DOM reflow через изменение высоты активного текста.
  Scale меняет только видимый размер; offsetHeight остаётся стабильным.
- Первый шаг намеренно не центрируется как остальные. Возврат к нему имеет
  другую геометрию. Sticky top меняется CSS-переходом 440ms, не скачком.
- «30px задержка» исторического marker компенсируется restPosition.
  Документируем фактическую формулу, не обещаем дополнительную задержку.
- Старый crop прозрачного края problem удалён вместе с заменой изображения на схему.
- Текущая версия использует spring, scale изображения и 13px translate,
  несмотря на раннюю идею «без spring/zoom». Рефакторинг не меняет UX.
- Клавиатура/scrollbar — native fallback, не stepped жест. Touch native только
  без opt-in, вне секции, на внешней границе, при reduced motion/исключениях.
- Resize сбрасывает tension; контролируемый desktop-шаг >0 сохраняется и
  центрируется заново. Иначе изменение высоты окна разносило центр текста и медиа.
- Обычный primary pointerdown внутри viewport больше не прерывает desktop spring:
  клик по тексту/медиа во время перехода раньше оставлял его на полпути.
  Scrollbar, клавиатура и реальный native scroll по-прежнему могут прервать ввод.
- Вложенные scrollable области, исключения для inputs и несколько контроллеров
  не реализованы. Глобальный wheel может перехватить ввод вложенного виджета.
- Не обещается отсутствие пропусков при нативном Home/End или scrollbar.
- Desktop-медиа ограничены высотой viewport минус32px; длинный текст всё ещё
  требует проверки на коротком экране.
- Динамические вставки и смена шрифтов после fonts.ready требуют refresh.
- fonts.ready повторно вызывает setup и сбрасывает interaction. Ввод ровно
  во время первой загрузки шрифтов может потерять недобранное tension;
  это исходное поведение, не исправленное молча при извлечении. В тестах
  ввод начинается после fonts.ready и завершения начальной настройки.
- Callbacks с исключением могут нарушить переход; держите их синхронными.
- В рамках этого рефакторинга добавлены только validation и cleanup.
  Алгоритм spring и даже неиспользуемая tension-ветка не переписывались.

## Verification

Запуск сервера по инструкции проекта:
~~~sh
npx astro dev --background --port 4322
npm run build
node scripts/check-stepped-scroll.mjs
node scripts/check-stepped-touch.mjs
~~~

Проверочный скрипт использует Playwright. Можно установить его в отдельное
тестовое окружение; PLAYWRIGHT_MODULE — путь к установленному пакету,
CHROME_PATH — путь к Chrome; без них используются playwright и его Chromium.
SCROLL_URL переопределяет URL. Установка тестового инструмента не нужна сайту.

Touch-проверка использует Chromium CDP Input.dispatchTouchEvent с isMobile/hasTouch,
а не dispatchEvent: проверяет native scroll/inertia и отменяемость touchmove.
Покрывает пять шагов в обе стороны, короткие/быстрые/последовательные свайпы,
чтение высоких блоков, границы hero/CTA, touchcancel, orientation, active media,
horizontal overflow, reduced motion и console errors. Физический iOS/Safari
этот тест не заменяет; перед публикацией проверить свайпы и browser chrome там.

Исторический baseline до обновления дизайна (трёхшаговая версия), Chrome 1440×900:
| Состояние | active | scrollY | центр текста | центр изображения |
| --- | --- | --- | --- | --- |
| Вход | about | 549 | 449 | 584 |
| Лёгкий импульс 20 | about | 549 | 447 | 584 |
| Сумма шести медленных 20 | problem | 1000 | 450 | 450 |
| Непрерывная серия 20×60 | result | 1499 | 450 | 450 |
| Обратно | problem | 1000 | 450 | 450 |
| Обратно | about | 507 | 491 | 626 |

Эти координаты относятся к старому дизайну и больше не являются ожиданиями
теста. Текущая проверка проходит пять шагов и проверяет центрирование,
  а не абсолютное scrollY; desktop-параметры не менялись.
Дополнительно скрипт проверяет быстрый жест с первого шага (не пропускает
problem), дрожание знака, лёгкий reverse в середине анимации, выход через обе
границы, resize, ширины800/390, reduced motion и runtime errors.
Это автоматизация Chrome, не гарантия всех физических мышей/трекпадов:
ручная проверка устройства пользователя всё ещё полезна.
Независимое подключение core к разметке без case-классов также проверено:
два импульса переводят индекс 0 → 1; после destroy wheel не отменяется,
scrollBehavior восстановлен; повторные destroy и новая инициализация работают.

## Current implementation snapshot

**Core:** src/lib/steppedScroll.ts
- exports: SteppedScrollOptions, createSteppedScroll.
- state: activeIndex, wheelOwnsState, accumulatedDelta, gestureActive,
  committedInGesture, lastWheelTime, gestureIdleTimer, fallbackFrame,
  animationFrame, animationMode, animationLastTime, springPosition,
  springVelocity, springTarget, observer, previousScrollBehavior,
  lastObservedY, destroyed, listeners.
- functions: clamp, setActiveIndex, renderTension, clearTension,
  restoreScrollBehavior, cancelAnimation, finishAnimation, runSpring,
  startSpring, restPosition, springToActiveStage, syncFromPosition,
  scheduleFallback, isStoryInWorkingArea, normalizeWheelDelta, finishGesture,
  armGestureEnd, beginGesture, commitStep, onWheel, resetInteraction,
  onNativeScroll, onNativeNavigation, setupFallback.
- return: getState, refresh, destroy.
- touch state: touchPoint, touchMode (pending/controlled/native), nativeTouch.
- touch functions: mobileEnabled, enabled, touchRange, instantScroll,
  onTouchStart/Move/End. accumulate общая с wheel; отдельного activeIndex нет.
- constants mapped from options: DESKTOP_QUERY, STEP_THRESHOLD, MAX_EVENT_DELTA,
  GESTURE_IDLE_MS, REST_LINE, SPRING_STIFFNESS, SPRING_DAMPING, SPRING_TIME_SCALE.
  Точные значения и media query — в таблицах выше.
- setup: при create, fonts.ready, resize, desktop/reduced query change;
  window listeners: wheel, scroll, pointerdown, touchstart/move/end/cancel, keydown, resize.

**Page:** src/pages/projects/doverie.astro
- data: stages = about / problem / solution / shared-account / nearby, три map-представления через
  текст+mobile visual в первом map и desktop visuals во втором.
- client functions: clamp, setActiveIndex, clearPreview, renderTension,
  clearTension, restPosition, syncVideos; inline onMeasure.
- media: [data-case-video], videoObserver, visibleVideos; играет только видимое
  активное видео, inactive paused; reduced motion/hidden document отключают autoplay.
  Native controls позволяют ручной просмотр. poster — статичный кадр MP4.
- .case-story__image теперь wrapper с img/video; inactive wrappers inert и aria-hidden.
- [data-tags] / .case-tags__toggle раскрывает четыре дополнительных тега на mobile.
- initialization: клиентский script после BaseLayout; createSteppedScroll
  внутри проверки story/triggers; cleanup на astro:before-swap.
- selectors: [data-case-story], [data-case-stage], [data-case-trigger],
  [data-case-visual], .case-stage__content, .case-story__visual.
- classes: case-page, case-shell, case-hero, case-hero__media, case-hero__copy,
  case-story, case-story__copy, case-stage, case-stage__observer-target,
  is-delayed, case-stage__content, case-stage__body, case-stage__mobile-visual,
  case-story__visual, case-story__image, is-active, is-preview, is-tensioning.
- attributes: data-case-story; data-case-stage=id; data-case-trigger;
  data-case-visual=id; data-active=true/false; data-centered=true/false;
  data-stage-image=id.
  Mobile visual также имеет data-active=true/false; не получает inert/aria-hidden,
  потому что линейный контент остаётся доступным для чтения и native navigation.
- dynamic CSS vars: --case-active-translate-y, --case-active-scale,
  --case-active-opacity, --case-preview-progress,
  --case-last-visual-space, --case-stage-extra-gap.
- static CSS vars: --case-sticky-offset, --case-stage-spacing,
  --case-visual-height, --case-centered-offset,
  --case-inactive-opacity, --case-transition-duration,
  --case-image-fade-duration, --case-image-motion-duration, --case-ease-out.

Сохраняйте модуль, страницу со стилями и документ вместе в системе контроля
версий/резервной копии. Документ не заменяет резервную копию исходного кода.
