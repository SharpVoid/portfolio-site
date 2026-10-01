# Шаблон страниц кейсов

Эталон — Doverie, 29 сентября 2026. Рефакторинг меняет организацию файлов,
а не визуальную систему, breakpoint’ы или параметры scroll. Новых зависимостей нет.

## Карта файлов

| Файл | Что переиспользуется |
| --- | --- |
| `src/components/case/CaseLayout.astro` | BaseLayout, `.case-page`, верхняя навигация, slot для содержимого, контактный блок и dialog |
| `CaseHero.astro` | Обложка, h1, описание, теги; на mobile первые два + кнопка с реальным количеством остальных |
| `CaseMedia.astro` | Astro Image с оптимизацией и preview либо video с poster, native controls и общим управлением воспроизведением |
| `CaseSteppedScroll.astro` | Текстовые статьи, stable triggers, mobile media и sticky desktop media из одного массива |
| `CaseContact.astro` | Общие CTA, анимации кнопки, следующий кейс, контакты и существующий Footer |
| `types.ts` | Типы CaseData, CaseStage, CaseMediaData |
| `src/styles/case.css` | Единственная копия CSS кейсов: сетка, типографика, ритм, media, tags, dialog, адаптив и анимации |
| `src/lib/casePage.ts` | Общая презентационная логика: active classes, tension, центры, интервалы, видео, теги и modal |
| `src/lib/scrollScene.ts` | Native scroll → progress → визуальное состояние; не управляет прокруткой |
| `src/data/cases/doverie.ts` | Только контент и особенности медиа Doverie |
| `src/pages/projects/doverie.astro` | Композиция страницы: layout → hero → stepped section |

CSS импортируется только CaseLayout. Он не scoped, потому что обслуживает несколько
Astro-компонентов; селекторы именованы `case-*`. Не копировать его в компоненты.
BaseLayout, Footer, шрифты и глобальные tokens проекта остаются прежними.

## Данные конкретного кейса

- `seoTitle`, `description`: метаданные страницы.
- `title`, `intro`, `tags`, `hero`: заголовок, введение, направления, обложка.
- `stages`: порядок шагов. Каждый содержит стабильный уникальный `id`, `title`,
  `paragraphs` и ровно один `image` или `video`; `alt` обязателен.
- `meta` необязателен: пары term/value. «Моя роль», «Формат» и «Зона ответственности»
  не обязательны для других кейсов.
- `poster`: превью видео. `square: true`: квадратное видео с прежней тонкой рамкой
  как у «О проекте». `objectPosition`: например `54% center` у «Общего счёта».
- `bordered: true`: внутренняя обводка изображения 2px #EAEFF9 без изменения размеров.
- `tabletRadius: 15`, `mobileRadius: 15`: существующие варианты радиуса изображения
  на ≤900px и ≤600px соответственно; без них действуют общие радиусы.
- `mobileAlign: 'top'`: фиксировать длинный шаг на 24px от верха. По умолчанию
  центрируется вся пара media/text, если она помещается. Это больше не зависит
  от индекса ≥3: перестановка шагов не меняет настройку случайно.

Тексты «О проекте», «Проблема», «Моё решение», «Общий счёт», «Рядом» не зашиты
в компоненты. Пять шагов тоже не обязательны. Количество определяется массивом.
Тексты — обычные строки (не HTML), переносы `\n` сохраняются в абзацах.

## Создать следующий кейс

1. Положить изображения в `src/assets/projects/`, видео/poster — в `public/videos/<slug>/`.
2. Создать `src/data/cases/<slug>.ts` с объектом CaseData. Импортировать изображения,
   URL public-ресурсов писать от корня (`/videos/...`), без `/public`.
3. Создать `src/pages/projects/<slug>.astro`, как в примере ниже.
4. Порядок `stages` задаёт последовательность scroll. Порядок компонентов в slot
   задаёт порядок больших секций страницы. `nextHref` у layout задаёт ссылку следующего кейса.
5. Запустить `npm run build`, проверить scroll в обе стороны, мобильное чтение
   длинных шагов, изображения, modal и реальные видео. Ссылка с главной добавляется
   отдельно: шаблон не публикует новую карточку автоматически.

### Минимальный пример

`src/data/cases/example.ts` (изображения-примеры заменить своими):

```ts
import type { CaseData } from '../../components/case/types';
import cover from '../../assets/projects/doverie-hero.png';
import diagram from '../../assets/projects/doverie-flow.png';

export const example: CaseData = {
  seoTitle: 'Новый кейс — портфолио',
  description: 'Описание для поисковых систем',
  title: 'Новый кейс',
  intro: 'Коротко о задаче и продукте.',
  tags: ['Product Design', 'Research', 'Prototype'],
  hero: { image: cover, alt: 'Обложка проекта' },
  stages: [
    { id: 'context', title: 'Контекст', paragraphs: ['Исходная ситуация.'],
      image: diagram, alt: 'Контекст проекта', bordered: true },
    { id: 'prototype', title: 'Прототип', paragraphs: ['Как работает решение.'],
      video: '/videos/doverie/shared-account.mp4',
      poster: '/videos/doverie/shared-account-poster.png',
      alt: 'Демонстрация решения', mobileAlign: 'top' },
  ],
};
```

`src/pages/projects/example.astro`:

```astro
---
import CaseLayout from '../../components/case/CaseLayout.astro';
import CaseHero from '../../components/case/CaseHero.astro';
import CaseSteppedScroll from '../../components/case/CaseSteppedScroll.astro';
import { example } from '../../data/cases/example';
---
<CaseLayout title={example.seoTitle} description={example.description}
  nextHref="/projects/doverie/">
  <CaseHero title={example.title} intro={example.intro}
    tags={example.tags} media={example.hero} />
  <CaseSteppedScroll stages={example.stages} />
</CaseLayout>
```

## Уникальные и дополнительные секции

Исследование, цитаты, таблицы результатов и другие индивидуальные блоки не
делаются обязательными полями универсального компонента. Добавить их обычной
Astro-разметкой или своим компонентом в slot CaseLayout до/после stepped section.
Контент такого компонента также можно передать из файла данных конкретного кейса.
Например: `<ResearchSummary findings={findings} />`. Внешний контейнер использовать
`class="case-shell"`; индивидуальные стили держать scoped внутри этого компонента.
Для отдельного изображения/видео использовать `<CaseMedia media={...} />`:
он автоматически получает preview/управление видео от CaseLayout.

Не требуется CaseSection с десятками вариантов: пока у уникальных секций нет
реально повторяющейся структуры. Hero можно заменить своим блоком в slot.
Scroll section необязательна; **не больше одной на странице** — casePage связывает один набор текстов и медиа.
Не вставлять уникальные DOM-узлы внутрь `.case-story__copy`: индексы текста,
triggers и desktop visuals должны совпадать. Для нового scroll-шага добавить
объект в stages; удаление и перестановка также делаются в этом массиве.

## Что намеренно сохранено

- Breakpoint’ы 1680 / 1100 / 900 / 600px и отдельные стили Footer.
- Sticky-медиа, active/preview-состояния и CSS transitions. С 1 октября 2026 scroll нативный; spring, threshold и блокировки жестов удалены.
- Две media-проекции одного массива для desktop/mobile. Не объединять их молча:
  они обеспечивают разную раскладку и управление активным видео.
- Начальный отступ через высоту первого текста и scale 0.6667. Отступы больше не зависят от активного шага; подробности в scroll-mechanics.md.
- Первое desktop-видео и текст центрируются, верхний padding измеряется.
- Один общий клиентский модуль на страницу. Проект сейчас использует обычные
  переходы, без ClientRouter; при добавлении ClientRouter нужна отдельная проверка
  повторной инициализации на astro:page-load, а не копия скрипта в каждом кейсе.

## Проверка и восстановление

`npm run build`, `node scripts/check-native-scroll.mjs` и
`node scripts/check-image-dialog.mjs` проверяют сборку, native scroll и просмотр медиа.
Scroll-проверка охватывает FocusML, Doverie и Arena.
Параметры runtime Playwright описаны в scroll-mechanics.md.

`node scripts/check-case-template.mjs --capture` сохраняет эталон ДО изменения;
`node scripts/check-case-template.mjs` сравнивает ПОСЛЕ изменения 24 состояния:
hero и пять шагов, ширины 1440, 1920, 800, 390px, высота 900px.
Сравниваются геометрия/вычисленные стили и PNG; динамическое видео маскируется,
геометрия живых часов исключается. Можно задать `CASE_SNAPSHOT_DIR`;
по умолчанию снимки лежат в системном temp, не в репозитории.
Для долгого хранения baseline выбрать постоянную папку и сохранить её отдельно.

Для переноса системы нужны `components/case/`, `lib/casePage.ts`,
`lib/scrollScene.ts`, `styles/case.css`, BaseLayout/Footer и шрифты/tokens,
данные кейса и его ресурсы. Scroll core отдельно от Astro переносится как прежде.
