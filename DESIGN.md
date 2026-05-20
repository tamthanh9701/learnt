# Voicelabs Studio — Android 17 Glass Design System

## Philosophy
Soft glass, layered tonal surfaces, and quiet confidence. No harsh borders, no pure black, no flat white. Depth comes from blur, transparency, and a single disciplined accent. The UI feels like it floats in a shallow volume of tinted air.

## Surface Architecture
| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg` | `#f6f7f9` | `#0b0b0e` | Page canvas |
| `tonal-1` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.09)` | Primary surface |
| `tonal-2` | `rgba(255,255,255,0.38)` | `rgba(255,255,255,0.05)` | Secondary / hover |
| `tonal-3` | `rgba(255,255,255,0.22)` | `rgba(255,255,255,0.03)` | Disabled / subtle |
| `fg` | `#1f1f23` | `#f2f2f5` | Primary text |
| `fg-2` | `#4a4a52` | `#b0b0b8` | Secondary text |
| `fg-3` | `#8e8e98` | `#6e6e78` | Tertiary / meta |
| `border` | `rgba(18,18,22,0.06)` | `rgba(255,255,255,0.07)` | Dividers |
| `accent` | `#006d5f` | `#2dd4bf` | Primary action |
| `accent-2` | `#00564a` | `#5eead4` | Hover state |
| `accent-text` | `#ffffff` | `#081c1a` | Text on accent |
| `success` | `#007c3f` | `#52b788` | Positive |
| `warn` | `#c28a00` | `#ffd166` | Caution |
| `danger` | `#dc2626` | `#ff6b6b` | Critical |

## Glass Tokens
| Token | Light | Dark | Blur |
|---|---|---|---|
| `glass` | `rgba(255,255,255,0.32)` | `rgba(255,255,255,0.055)` | `blur(18px) saturate(160%)` |
| `glass-strong` | `rgba(255,255,255,0.52)` | `rgba(255,255,255,0.10)` | `blur(28px) saturate(190%)` |
| `glass-border` | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.10)` | — |
| `glass-highlight` | `rgba(255,255,255,0.95)` | `rgba(255,255,255,0.18)` | — |
| `glass-shadow` | `0 8px 32px rgba(18,18,30,0.06), 0 2px 8px rgba(18,18,30,0.04)` | `0 12px 40px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.25)` | — |
| `glass-inset` | `inset 0 1px 1px rgba(255,255,255,0.9)` | `inset 0 1px 0 rgba(255,255,255,0.08)` | — |

## Typography
- **Display**: Inter 600, `clamp(34px, 3.6vw, 60px)`, tracking `-0.03em`, line 1.1
- **Heading**: Inter 600, `clamp(24px, 2.2vw, 38px)`, tracking `-0.02em`, line 1.18
- **Subhead**: Inter 600, `clamp(18px, 1.4vw, 22px)`, line 1.25
- **Body**: Inter 400, 14px/1.6, color `fg-2`
- **Mono**: JetBrains Mono, 12px, tracking `0.02em`
- **Caption**: 11px, uppercase, tracking `0.1em`, color `fg-3`

## Spacing
Base unit 4px. Scale: xs 4, sm 8, md 16, lg 24, xl 32, 2xl 48.

## Radii
| Size | Token | Usage |
|---|---|---|
| 28px | `glass-strong` | Topbar, sidebar, player |
| 24px | `glass` / `card` | Cards, panels, stat boxes, component boxes |
| 22px | — | Table wrappers, swatch grids |
| 20px | `glass-thin` | Subtle cards, tight groups |
| 16px | — | Tab containers, pill wrappers |
| 14px | `btn` / `input` | Buttons, inputs |
| 12px | `btn-sm` / `tab` | Small buttons, individual tabs |
| 10px | `logo-mark` | Logo container |

## Depth & Elevation
Three surface levels:
1. **Tonal**: opaque-ish semi-transparent layers (`tonal-1`, `tonal-2`). Used for hover states and quiet backgrounds.
2. **Glass**: `backdrop-filter: blur(18px) saturate(160%)`, soft border, used for cards and floating panels.
3. **Glass Strong**: `backdrop-filter: blur(28px) saturate(190%)`, used for topbar, sidebar, and player — elements that must remain legible while scrolling content passes behind.

## Component Specs

### Buttons
- Padding: `10px 18px` (sm: `8px 14px`)
- Radius: `14px` (sm: `12px`)
- Primary: accent fill, `accent-text`, shadow `0 4px 14px color-mix(in oklab, accent 30%, transparent)`
- Secondary: `tonal-2` fill, `fg` text, `border`
- Ghost: transparent, `fg-3` text
- Active: `scale(0.98)`, duration `0.06s`

### Inputs
- Glass background, `blur(8px)`, radius `14px`
- Border: `glass-border`
- Focus: accent at 50% mixed into border + `3px` ring at `accent/22%` + `glass-inset`
- Placeholder: `fg-3`

### Cards
- **Tonal card**: `tonal-1`, `border`, `24px` radius
- **Glass card**: `glass`, `glass-border`, `glass-shadow` + `glass-inset`, `24px` radius
- Hover: `translateY(-2px)`, border-color shift, `0.25s cubic-bezier(.4,0,.2,1)`

### Tables
- Wrapper: `22px` radius, `border`
- Header: `tonal-2`, 11px uppercase labels, letter-spacing `0.07em`
- Row hover: `tonal-2`
- Cell padding: `15px 18px`

### Tabs
- Container: `tonal-2`, `16px` radius, `5px` padding, `border`
- Tab: transparent, `12px` radius, `fg-3`
- Active: `tonal-1`, `fg`, subtle shadow `0 1px 4px rgba(0,0,0,0.04)`

### Badges
- `999px` radius, `tonal-2` bg, `border`, `11.5px` uppercase
- Semantic variants use `success`, `warn`, `danger` for text and tint

### Toggle
- `46px × 26px`, `999px` radius
- Knob: `20px` white circle, shadow `0 2px 6px rgba(0,0,0,0.18)`
- Checked: accent fill
- Transition: `transform 0.25s cubic-bezier(.4,0,.2,1)`

### Player
- `glass-strong`, `24px` radius
- Progress track: `5px` height, `tonal-2` bg
- Progress fill: accent, `999px` radius

## Motion
| Pattern | Value | Duration |
|---|---|---|
| Hover lift | `translateY(-2px)` | `0.25s cubic-bezier(.4,0,.2,1)` |
| Press | `scale(0.98)` | `0.06s ease` |
| Toggle slide | `translateX(20px)` | `0.25s cubic-bezier(.4,0,.2,1)` |
| Theme switch | bg / border / color / backdrop-filter | `0.3s ease` |
| Waveform | bar height `18% ↔ 100%` | `1.2s ease-in-out infinite` |

## Background Gradient
Fixed radial layers using `color-mix(in oklab, accent 14%, transparent)` positioned at top-left, top-right, and bottom-center. Creates a soft ambient glow behind glass layers. Never competes with foreground content.

## Responsive
| Breakpoint | Behavior |
|---|---|
| `> 1024px` | 264px sidebar fixed, content max 1100px, multi-column grids |
| `≤ 1024px` | Sidebar off-canvas with overlay backdrop, main full-width |
| `≤ 640px` | Stats 2-col, components 1-col, swatches 2-col, tabs scrollable |

## Accessibility Notes
- Topbar and sidebar use `glass-strong` with `blur(28px)` to maintain WCAG contrast against unknown scrollable backgrounds.
- Focus rings use `color-mix` to remain visible in both light and dark.
- Toggle and buttons have `min-height` / `padding` that yields `44px` hit targets or larger.