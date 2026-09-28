## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)


## Ponytail / Codex constraints

Apply Ponytail primarily to NEW code.

For existing working code:
- Do not refactor, simplify, reorganize, or replace it unless I explicitly ask.
- Do not remove complexity just because a shorter implementation exists.
- Preserve current behavior, timing, interaction feel, and visual output.
- Treat custom scroll, animations, shaders, and interaction logic as intentional unless proven otherwise.

When adding or changing code:
- Prefer the smallest change that solves the task.
- Reuse existing project patterns and utilities before adding new abstractions.
- Avoid new dependencies unless clearly necessary.
- Avoid creating helpers, wrappers, components, state, or architecture for one-off needs.
- Modify the minimum number of files and lines possible.

If existing code could be simplified:
- Do not change it automatically.
- Explain what could be simplified, why, and what behavior could be affected.
- Wait for explicit approval before refactoring.