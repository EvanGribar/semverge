# Homepage review

## Critique

The page's strongest product-specific moment is the illustrated incident record: it connects a service, two failed checks and a release explicitly linked for investigation. The scene is labeled illustrative and the adjacent copy distinguishes the developing workspace from the release engine. The light release section breaks the page's rhythm and gives the available product a clear status.

The hero's converging planes provide a recognizable material motif, and the supporting copy now names Semverge as an open-source release engine immediately below the headline. The illustrative incident record connects a service, failed checks, and an operator-linked release, while making clear that the association does not prove cause. The reconstruction is not a live demo and does not show the application's interactive controls.

## Technical audit and polish

- The document had no horizontal overflow at 1440, 1024, 690, 650, 390, 320, or 195 CSS pixels. All three navigation links remain visible at every width; they wrap onto two lines at 195px.
- Keyboard focus starts on the skip link. Axe reported no WCAG 2.0/2.1 A/AA or best-practice violations at 1440, 390, or 195px. Axe marked color contrast as incomplete, so this is not a contrast certification, screen-reader test, or complete accessibility audit.
- The illustrative scene plays once and holds its completed state. Reduced motion shows the completed poster; with JavaScript disabled, the descriptive raster fallback remains visible. The scene ran without JavaScript errors or failed requests.
- `npm ci`, `npm run build`, and `npm audit --audit-level=high` passed; the lockfile reported zero vulnerabilities. Vite emits 190.45 KB of JavaScript (63.97 KB gzip) and 36.48 KB of CSS (8.57 KB gzip). The two fallback crops total 122.4 KB, and the locally preloaded Manrope font is 164.7 KB. No third-party request was observed.
- The copied Stageshow source includes its MIT license, and the Manrope font includes the SIL Open Font License. The source kit is about 5,400 lines; its built scene bundle is 63.97 KB gzip. Given the specific one-time incident story and static fallback, that runtime cost is proportionate, so the scene remains.
- npm returned 404 for `semverge` on 2 November 2026. The homepage, README, and CLI guides now use the GitHub Action or a built source checkout; the local CLI examples were run without publishing or making provider calls. The target account has no Vercel project named Semverge, so there is no remote preview to review.
- The post-edit Impeccable detector reported three `cramped-padding` warnings and no errors. They target section wrappers whose nested `.section` layout supplies 140px block padding; these are false positives. The detector does not judge image content.

## Unslop check

The two independent critiques asked the page to name the product category sooner, retain navigation on mobile, and clarify CTA destinations. Those are addressed. The page keeps its restrained palette, short navigation, explicit product statuses, and one-time motion. The original mark remains exploratory, not an approved identity; brand approval and real-user evaluation remain open.
