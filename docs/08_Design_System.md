# 08 · Design System

The visual language of the Tallyko app on web, Android and iOS. The source of truth is code: tokens in `frontend/src/theme/tokens.ts`, components in `frontend/src/components/ui`. Screens use `useTheme().colors` and never hard-code hex colours. How screens are laid out for busy counters is in [20_High_Volume_UX.md](./20_High_Volume_UX.md).

## Colours

Teal brand on slate neutrals, with light and dark themes (chosen under Settings → Account, or follow the system).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `primary` | teal 700 `#0F766E` | teal 500 `#14B8A6` | primary actions, active navigation, focus |
| `background` | slate 50 `#F6F8FA` | slate 950 `#0A101C` | app background |
| `surface` | white | slate 900 `#0F172A` | cards, sheets, inputs |
| `text` / `textMuted` | slate 900 / slate 600 | `#F1F5F9` / `#A3B1C6` | body text / secondary text |
| `sidebar` | slate 900 | `#070C16` | desktop sidebar |
| `success` | green 600 | green 500 | Pay buttons (`Button variant="success"`), paid status |
| `kitchen` | amber 500 | amber 500 | Send to kitchen / KOT (`variant="kitchen"`) |
| `warning` / `danger` / `info` | amber 600 / red 600 / blue 600 | lighter equivalents | statuses, destructive actions, notices |
| `waiting` | violet 600 | violet 500 | waiting / placed orders |
| `veg` / `nonVeg` | green / red | green / red | food markers |

`StatusPill` maps order, kitchen and payment states to these colours (`statusMeta.ts`).

## Typography

Inter (400–800) with tabular numbers for money.

| Style | Size / line height | Weight |
|---|---|---|
| `display` | 30 / 38 | bold |
| `h1` | 24 / 32 | bold |
| `h2` | 19 / 26 | semibold |
| `h3` | 16 / 22 | semibold |
| `body` / `bodyStrong` | 15 / 22 | regular / semibold |
| `small` | 13 / 18 | regular |
| `caption` | 11.5 / 16 | medium |
| `money` / `moneyLarge` | 15 / 22, 28 / 34 | semibold / bold, tabular |

## Spacing and radii

- Space: `xxs` 2, `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20, `xxl` 24, `xxxl` 32, `huge` 48.
- Radius: `sm` 6, `md` 10, `lg` 14, `xl` 18, `xxl` 24, `pill` 999.
- Touch targets are at least 44 dp.

## Components

`Text`, `Button` (variants incl. `success` and `kitchen`), `Input`, `Checkbox`, `Surface`, `Screen`, `DataList` (virtualised, server paging), `FilterBar`, `ActionMenu` (anchored menus instead of centred modals), `SelectionBar` (bulk actions), `StatusPill`, `Overlay` (sheets, confirm/prompt), toasts, `ShortcutHint` with `useHotkeys` on desktop. Icons are Ionicons from `@expo/vector-icons`.
