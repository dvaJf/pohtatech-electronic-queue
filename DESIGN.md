# Digital Queue Design System

## Product principles

Russian Post Digital Queue is a mobile-first public-service product: the next useful action must be obvious, status must be plain-language, and decoration never competes with a ticket, route, or appointment. Use one primary action per context, familiar transactional patterns, and progressive disclosure.

## Colors

Use semantic tokens only: `--background #F6F8FB`, `--foreground #102238`, `--surface #FFF`, `--surface-subtle #F1F5F9`, `--surface-elevated #FFF`, `--primary #003B73`, `--primary-hover #00519B`, `--primary-active #002C57`, `--primary-foreground #FFF`, `--primary-soft #EAF2FB`, `--success #187344`, `--success-soft #E9F6EE`, `--warning #9A6500`, `--warning-soft #FFF3D6`, `--danger #B62936`, `--danger-soft #FDECEF`, `--muted #EEF2F6`, `--muted-foreground #536578`, `--border #DBE3EB`, `--border-strong #B8C7D6`, `--focus-ring #0B63CE`.

Blue is the only primary CTA. Green communicates route/success; amber is warning only; red is destructive/error.

## Typography (frozen)

Use one self-hosted Onest variable WOFF2 with Cyrillic/Latin coverage, `font-display: swap`, and weights 400/500/600/700. Mobile display is 26/32; desktop display 32/38; H1 26/32; H2 20/26; card heading 16–18/24; body 14–16; secondary 13; caption 12. Do not use product copy below 12px or use mono/bold as decoration. Mono remains purpose-specific only; the TV board may retain its specialist face. Typography scales through scoped tokens at 100/125/150%; controls, icons and map markers retain fixed geometry.

## Spacing, radius and shadow

Spacing scale: 4, 8, 12, 16, 24, 32, 48. Radius: 4, 8, 12, 16, 20, 999. `--shadow-sm: 0 1px 2px rgb(13 37 61 / 6%)`; `--shadow-md: 0 10px 30px rgb(13 37 61 / 12%)`. A border is optional when surface and spacing already separate groups; shadows are reserved for floating surfaces.

## Icons (frozen)

Use Solar Icons v2 via static tree-shakable `@solar-icons/react` imports: Linear for actions/navigation and restrained LineDuotone only for feature entry points. Standard size is 20px, compact 18px, feature 24px, with a 44px hit area. Header uses Linear sound, GPS, accessibility, chevron and avatar/account iconography. Migrate the client shell/header/home/map together so a screen never mixes Solar and Lucide; keep brand SVG, QR and specialised map markers custom. Compare bundle output while Lucide and Solar coexist, then remove client Lucide imports only after migration.

## Header direction (frozen)

Use light navigation chrome with a navy brand mark. Geo is the sole visible utility control; sound, accessibility, time and account remain a compact secondary cluster. Mobile is always logo + Geo + overflow; desktop is logo, utility actions, secondary time, then avatar/name/dropdown. No row of equal-strength controls.

## Button hierarchy and surfaces

Primary is blue filled; secondary is blue-soft; tertiary is ghost; route is success-soft; destructive is red. Every button has default, hover, pressed, focus-visible, disabled and loading states. Cards use surface and spacing first, a subtle border only where scanning needs it. Inputs are 44px minimum; mobile text input is 16px to prevent iOS zoom.

## Status, forms and states

Status messages are concise and actionable. Use skeletons that preserve layout for loading; use inline error/empty states for persistent problems; reserve toast feedback for transient success or retry messages. Never expose implementation language such as “GPS fix”.

## Map UI and mobile

Mobile map is a compact header, large map canvas, and a non-portal three-state sheet: collapsed, medium, expanded. Selected branch replaces list controls with its detail state. Sheet size is viewport/safe-area aware and map padding derives from measured overlay size; a background location update only moves the user marker. Desktop retains sidebar plus large map.

Open mobile maps in the medium sheet state so search and the branch list are visibly discoverable; the collapsed state is an optional, labelled reduction. Hide unrelated floating assistants and nearby prompts while a map dialog is open.

## Smart Route

Treat Smart Route as a decision pattern, not a promo card: branch and address → travel → queue → total time → one contextual primary action. The three time values sit on one restrained route connector; its start, intermediate and destination nodes provide the relationship without presenting a literal arithmetic equation. Total time is the dominant destination metric. The primary action starts the normal branch/service selection flow; it must not issue a ticket until the service is known. Route and appointment actions are secondary/tertiary and never compete with the primary.

Route motion is a one-shot state explanation: path draw → travel → queue → total, with one short pulse toward the destination. It may replay only when the recommendation changes; `prefers-reduced-motion` renders the final route immediately.

## Accessibility and motion

Keyboard focus uses `--focus-ring`; dialogs trap focus, Escape closes, and focus returns to the trigger. Maintain contrast, semantic labels, logical reading order, 44px target areas and support 100/125/150% text. Motion is 150–250ms opacity/transform only and is disabled for `prefers-reduced-motion`.

## Do / don’t

Do make a ticket action easy to scan, group related data, use direct public-service copy, and test long text/empty/error/loading states. Don’t add glassmorphism, neon, 3D dashboard decoration, generic yellow CTAs, arbitrary colour/radius/shadow values, giant empty blocks, or heavyweight libraries for visual-only changes.
