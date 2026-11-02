---
name: semverge platform
description: Graphite and silver instruments for software operations
colors:
  page: "#111112"
  rail: "#09090a"
  surface: "#19191b"
  hover: "#242426"
  text: "#ededee"
  muted: "#b6b6ba"
  dim: "#a1a1a5"
  line: "#2e2e32"
  accent: "#e7e7e9"
  accent-soft: "#262626"
  green: "#87d8b3"
  red: "#f29a9d"
  amber: "#dfbf83"
  field: "#121212"
  field-border: "#414141"
  button: "#1b1b1b"
  button-border: "#3e3e3e"
  button-hover: "#2a2a2a"
  white: "#ffffff"
  nav-selected: "#242424"
  form-panel: "#1a1a1a"
  form-border: "#434343"
typography:
  display:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "clamp(34px, 3.9vw, 58px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "clamp(32px, 3vw, 42px)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  body:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: 'Consolas, "SFMono-Regular", monospace'
    fontSize: "12px"
rounded:
  small: "4px"
  navigation: "0"
  control: "7px"
  container: "8px"
spacing:
  step: "4px"
  compact: "8px"
  control: "12px"
  row: "16px"
  group: "20px"
  panel: "24px"
  section: "28px"
  region: "32px"
  separation: "36px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.page}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.white}"
  button-secondary:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.button-hover}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 12px"
  navigation:
    textColor: "{colors.muted}"
    rounded: "{rounded.navigation}"
    padding: "12px 12px"
  navigation-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.white}"
  status:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  form-panel:
    backgroundColor: "{colors.form-panel}"
    rounded: "{rounded.container}"
    padding: "24px"
  service-ledger:
    rounded: "{rounded.container}"
---

# Design System: semverge platform

## Overview

**Creative North Star: "Operational instruments and change records"**

The platform is calm, exact and accountable. Near-black graphite fields, silver lettering and off-white actions support a dense but readable operating workspace. The direct user-supplied Sero board leads the identity; its monochrome direction supersedes the earlier blue reference. Original convergence ribbons interpret directional light without copying the reference's logo.

This document captures the implemented `platform/web` world, including sign-in, Overview, Releases, Monitoring and Incidents. It does not redefine the optional root website. The implementation was code-first and reviewed in rendered desktop and 393px mobile captures; there is no approved comp. Surface composition remains in `.impeccable/surface-brief.md`. The approved Unslop polish method is attributed to [Damir Sokolovsky (@heydamir)](https://github.com/heydamir/unslop), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its example assets are not distributed. semverge remains MIT licensed.

**Key Characteristics:**
- Monochrome graphite and silver identity
- Three neutral text roles with restrained semantic status color
- Persistent service, environment and release context
- Measured line icons and original vector convergence artwork
- Responsive records with directly visible operational state

## Colors

The primary brand emphasis is off-white on graphite; semantic hues describe operational state.

### Primary

- **Off-white action** (`accent`): primary buttons and the current release phase, with dark text; hover becomes white.

### Neutral

- **Graphite page / near-black rail** (`page`, `rail`): work area and navigation frame.
- **Raised graphite / hover graphite** (`surface`, `hover`): the surface vocabulary and interactive record feedback.
- **Silver primary** (`text`): headings, selected content and record names.
- **Secondary silver** (`muted`): descriptions, labels and contextual metadata.
- **Muted silver** (`dim`): tertiary icons, separators in breadcrumbs and footer details.
- **Graphite line / soft graphite** (`line`, `accent-soft`): boundaries and the quiet neutral vocabulary. Specific fields, controls and form surfaces retain the extracted sibling tokens in frontmatter.

### Semantic status

- **Passing mint** (`green`): passing, resolved and recorded-complete states.
- **Failure rose** (`red`): failing, open and recorded-failure states.
- **Acknowledged amber** (`amber`): acknowledged and in-progress states.
- Unknown and paused states use neutral labels with distinct outlined-circle and pause marks.

**The Status Has a Word Rule.** Every operational state has a visible text label; hue and a small symbol reinforce it.

## Typography

**Display Font / Body Font:** Manrope, bundled locally under the SIL Open Font License, with Segoe UI as fallback. **Code Font:** Consolas with SFMono-Regular and monospace fallbacks. The workspace makes no external font request.

The voice is precise and quiet. Larger sign-in lettering offers the main expressive moment; operating screens use compact headings and metadata.

- **Display:** sign-in thesis; its fluid size resolves to 36px on mobile.
- **Headline:** page heading; resolves to 32px at the mobile breakpoint.
- **Title:** section heading, with smaller 14px subheadings; ordinary small headings keep neutral tracking.
- **Body:** global base, with 12–13px operational descriptions and controls. Page descriptions stop at 70ch; longer empty-state help has generous leading.
- **Label:** metadata floor and table headers. Use at least 11px in this platform world.
- **Code:** versions, endpoints and technical identifiers. Numeric observations use tabular figures.

## Layout

Desktop uses a fixed 224px navigation rail, a 64px context bar and a work area capped at 1700px with 40px padding. At widths up to 1150px the rail becomes 196px and work padding 28px; overview continuation regions stack. At 1600px and above, work padding is 44px vertically and 52px horizontally.

At widths up to 760px, the rail becomes a full-width header with four labeled navigation cells. The context bar becomes 48px, work padding becomes 28px by 20px, and forms and detail regions stack. The service ledger becomes two-column labeled records: service spans the width, while environment, status, release and incidents remain directly visible. Monitor history becomes labeled records at the mobile breakpoint, so observation details remain visible without horizontal scrolling.

Spacing follows the extracted 4px rhythm with small optical adjustments. Record rows commonly use 16px by 20px padding; form panels use 24px, reduced to 20px on mobile. Desktop sign-in uses a 1.12:1 split and a form capped at 350px; mobile stacks the brand story and form.

## Elevation & Depth

The platform has no box-shadow vocabulary. Tonal layering, thin borders and section dividers distinguish work areas. The sign-in artwork supplies directional silver light; operating records remain flat and legible. Do not introduce floating-card depth as a default surface treatment.

## Shapes

Controls use softly curved corners from the control token; navigation is slightly tighter and record containers slightly broader. Borders are generally one pixel. Status dots are small circles, unknown is outlined, and paused has a pause silhouette. These variations carry meaning rather than decoration.

## Components

### Buttons

Compact, clear actions. Primary uses off-white with graphite text; secondary uses dark graphite with a quiet border. Desktop minimum height is 36px, mobile commonly 40px, and sign-in 44px. Button text is 12px, medium weight; sign-in is 13px. Hover changes background and border over 160ms with `cubic-bezier(0.22, 1, 0.36, 1)`. Keyboard focus uses a 2px silver outline offset by 4px; disabled controls show reduced opacity and a waiting cursor.

### Inputs / Fields

Dark fields have a visible neutral stroke, 12px internal padding, persistent labels and a standard 44px minimum height. Scope controls are denser: 36px desktop and 40px mobile. Errors remain text-labeled. Keep the same visible keyboard focus as actions.

### Navigation

Four operational areas share an authored line-icon set. Desktop links are 44px minimum height with a filled selected background and a silver selection rule; mobile links stack icon over label in 60px cells with a bottom selection rule. Unselected hover uses an underline, so it cannot be confused with selection. Active incidents may carry a small count. Future product areas are not represented as working navigation.

### Containers and records

Inline form panels, bordered record lists and the application ledger provide grouping without decorative card grids. Record rows gain a hover surface; names, service/environment context and state remain separate readable roles. Empty states describe the real next action instead of inserting sample records.

### Status and history

Small text-labeled status marks use the semantic palette. Monitor histories show retained response durations; hatched marks indicate intervals exceeding 1.5 times the configured interval without asserting a cause. Chart spacing is not proportional to elapsed time, and underlying observations remain readable as records. Earlier release phases are labeled as inferred from the current phase, not individually recorded events; incident timelines preserve timestamps and explicit evidence language. Imported release state is visually distinct from production execution authority.

### Icons and convergence artwork

Operational icons are authored SVG paths with rounded caps and joins, a 1.5 stroke and an 18px rendered size. Brand marks are separate artwork. Original SVG convergence ribbons on sign-in provide the sculptural silver signature; they are not generated photography or third-party illustration.

### Motion

Record and button feedback shares the short ease-out transition described above. There are no decorative entrances, pulsing states or looping artwork. Reduced-motion preference disables transitions and smooth scrolling.

## Do's and Don'ts

### Do:

- **Do** preserve graphite surfaces, off-white actions and the three neutral text roles.
- **Do** pair every status hue with an explicit word and retain unknown and paused distinctions.
- **Do** keep service, environment and release context readable on mobile.
- **Do** use the authored line icons, original convergence artwork and short reduced-motion-aware feedback.

### Don't:

- **Don't** reintroduce blue as the platform brand accent; the user's direct monochrome reference supersedes it.
- **Don't** add decorative metrics, invented history or navigation for unimplemented product areas.
- **Don't** shrink metadata below the platform's 11px floor or hide service state in an offscreen ledger.
- **Don't** apply this platform specification to the separate optional website without a separate scope decision.

## Identity page

The separate `website/brand.html` marketing identity page translates the user's Sero reference into a three-panel presentation using locally hosted, original generated light and portrait imagery, the existing semverge mark, and live Manrope text. Its visual treatment is a marketing identity exploration, not a pattern for operating screens. Asset provenance is recorded in `docs/brand/README.md`.
