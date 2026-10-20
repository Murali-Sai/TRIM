# TRIM design system: dark-first data

The global source of truth for how TRIM looks. Chosen on 20 Oct 2026 with the UI/UX Pro Max
skill (`.claude/skills/ui-ux-pro-max`, style "Dark Mode (OLED)" with the "Dashboard Data"
type pairing). SPEC page 1, "Visual design", summarizes it; where this file and the SPEC
disagree, the SPEC wins. Page-specific deviations go in `design-system/pages/<page>.md`.

Tokens live in `web/src/index.css` (CSS variables) and `web/tailwind.config.ts`. Components use
the Tailwind names (`bg-surface`, `text-text-secondary`, `text-protein-text`), never raw hex.

## Principles
1. **Numbers first.** Every figure is set in Fira Code with tabular figures (`num` class), so
   columns and totals line up. Labels are small, uppercase and quiet; the number is the loudest
   thing on the card.
2. **Dark first.** New devices open in dark. Light and "Match device" are in Account, Appearance.
3. **Hairlines, not shadows.** Cards are separated by 1 px borders. Shadows only lift floating
   layers: sheets, toasts and the selection bar.
4. **Calm about targets.** Over target is said plainly in the nutrient's own color. No red, no
   alarm, no streak or badge for eating less (AGENTS.md).
5. **Accessible by default.** WCAG 2.2 AA contrast in both themes, 44 px touch targets on touch
   screens, visible keyboard focus, motion only when the user has not asked for less.

## Color

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `bg` | #0B0B0C | #F6F6F7 | Page background |
| `surface` | #141416 | #FFFFFF | Cards, sheets, bars |
| `surface-2` | #1D1D20 | #EDEDF0 | Inputs at rest, chips, pressed states |
| `border` | #2E2E33 | #D9D9DE | Hairlines |
| `text` | #EDEDEF | #111113 | Body text, numbers |
| `text-secondary` | #A3A3AB | #55555C | Labels, units, help text |
| `accent` | #56B4E9 | #0069A6 | Primary buttons, links, focus ring |
| `accent-contrast` | #0B0B0C | #FFFFFF | Text on accent |
| `error` | #F2B8B5 | #B3261E | Errors (never for being over target) |

Contrast checked: text on surface 15.7:1 (dark) and 18.9:1 (light); secondary text 7.4:1 and
7.4:1; primary button text 8.5:1 and 5.9:1. The light accent is a deeper shade of Okabe-Ito blue (#0072B2), so links stay above 4.5:1 on `surface-2` too; `web/src/test/contrast.test.ts` checks every text token.

**Nutrient colors** (Okabe-Ito, the same in every chart, bar and chip):

| Nutrient | Bars and lines | Text shade, dark | Text shade, light |
|---|---|---|---|
| Calories | #56B4E9 | #56B4E9 | #1570A4 |
| Protein | #D55E00 | #DE6200 | #AF4D00 |
| Fat | #E69F00 | #E69F00 | #8C6100 |
| Carbs | #009E73 | #009E73 | #007857 |

Text shades meet 4.5:1 on `surface` and `surface-2` in their theme. Use `text-<nutrient>-text`
for words and numbers, and `bg-<nutrient>` / `var(--color-<nutrient>)` for bars.

## Type
- **Text:** Fira Sans 400, 500, 600 and 700 (`@fontsource/fira-sans`).
- **Numbers:** Fira Code variable (`@fontsource-variable/fira-code`) via the `num` class, which
  also turns on tabular figures. Use it for amounts, calories, macros, weights, dates in
  tables and times on pills.
- **Scale:** page title 24 px semibold; section labels 12 px uppercase, 0.08 em tracking,
  secondary color; body 16 px (never smaller on phones, so iOS does not zoom fields); help
  text 14 px; chip and caption figures 12 px.
- **Title block:** sizes exactly as SPEC page 1, in Fira Sans.

## Shape and space
- Corners: 8 px on cards, inputs, buttons and chips (`rounded-xl` maps to 8 px); 12 px on
  sheets (`rounded-2xl`); pills stay fully round.
- Borders: 1 px `border`. Selected or drop-target states use a 1 px accent ring.
- Spacing: 4 px grid; cards pad 12 px on phones and 16 px on desktop; gaps of 8 to 16 px.
- Elevation: none on cards; `shadow-lg` only for sheets, toasts and the selection bar.

## Motion
150 to 250 ms, ease-out to enter, only under `motion-safe:`. Sheets slide up (phone) or in from
the right (desktop); toasts fade. Nothing loops or bounces.

## Components
- **Section card:** `surface`, 1 px border, 8 px corners, uppercase label heading.
- **Target strip:** calories on the first line (big figure, "of target", percent, bar), then
  protein, fat and carbs on one row with thin bars. Second page: what is left, fiber, sugar,
  sodium.
- **Time block:** a mono time pill, "+" and Copy, subtotal chips with a colored underline.
- **Entry row:** icon, name and brand (two lines), the SPEC macro line in mono, secondary color.
- **Buttons:** primary is accent fill; secondary is surface with a hairline; both 44 px tall
  on touch screens.

## Do not
- Use emoji as icons, or icons copied from another app.
- Use red or warning colors for being over a target.
- Put nutrient colors on text without the text shade.
- Add shadows to ordinary cards, or hover effects that move layout.
