# Rehearsal: incident context

**Gold:** Stageshow `dark-hero`. The scene retains its dark, cropped desktop window and compact re-composition; the content and palette were replaced with the Semverge workspace's service context, incident timeline and explicit release association. It is an illustration using synthetic data, not a recording of the product.

**Medium:** one still, with separate 760 × 440 and 358 × 340 designs. There are no beats, loop, cursor, or motion to check. The scene uses Stageshow's `Stage` and `Window` components and is exported as PNG so the static site needs no React runtime.

**Captured:** Chromium stills at the wide design and 390px viewport; the compact source is selected by the homepage at 650px and below. `film.mjs --still --gate` reported `rehearsal passed` at both widths after correcting an empty sidebar and an insufficient mobile bleed. The gate does not establish visual quality or product accuracy. Both stills and the actual host page at 1440px and 390px were visually inspected.

**Review:** Compared with the gold, the focal incident and two readable records occupy more of the scene while the sidebar provides the product's actual navigation. The mobile view removes the sidebar rather than shrinking the desktop. The illustration deliberately simplifies the real incident view; the actual application includes additional response controls. The caption and alt text identify the example and explain that association is not causation.

**Reproduction:** Install the Stageshow skill requested for this work (`npx skills add benjitaylor/skills --skill stageshow`; the source HEAD inspected for this run was `802057409787133703c56001080169e347305572`), copy `index.tsx` and `hero.css` into its `examples/semverge-context/` directory, run `npm ci` and `npm run dev` in the skill directory, then use its `scripts/film.mjs` with `?capture=semverge-context&still=1`, `--select .ss-stage --still --gate --pad 0`; add `--width 390` for the compact image. The Stageshow skill and kit are external authoring dependencies, not included in the website's runtime. The included [MIT license](LICENSE) covers the adapted example and kit.

**Not checked:** No animation was created or assessed. The fresh-eye comparison was performed in-thread rather than by a separate reviewer. The scene is not a live application and does not test platform behavior.
