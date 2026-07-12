# 08 Design System

The Tallyko Design System defines the visual language, color palettes, spacing, and typography across the POS application. It ensures a premium, cohesive, and beautiful user experience across Android, iOS, and Web.

## Color Palette

We utilize a modern, vibrant color palette with both Light and Dark mode support.

### Light Theme
- **Primary:** `#6C5CE7` (Vibrant purple) - Used for primary actions, active tabs, and highlights.
- **Secondary:** `#FF7675` (Soft red/pink) - Used for secondary actions, badges, and inactive states.
- **Accent:** `#00CEC9` (Cyan) - Used for subtle accents.
- **Surface:** `#FFFFFF` - Used for cards, modals, and input backgrounds.
- **Surface Variant:** `#F8F9FA` - Used for elevated or separated sections.
- **Background:** `#F0F3F8` - Main app background.
- **Text:** `#2D3436` - Primary text.
- **Text Secondary:** `#636E72` - Subtitles, placeholders.

### Dark Theme
- **Primary:** `#A29BFE` (Soft purple)
- **Secondary:** `#FF9FF3` (Soft pink)
- **Accent:** `#81ECEC` (Light cyan)
- **Surface:** `#2D3436`
- **Surface Variant:** `#353B48`
- **Background:** `#1E272E`
- **Text:** `#F5F6FA`
- **Text Secondary:** `#B2BEC3`

## Typography

- **Headings (H1/H2):** Bold (800 weight), sizes 24px - 28px. Used for screen titles.
- **Subheadings:** Semi-bold (600 weight), sizes 18px - 20px. Used for card titles.
- **Body Text:** Regular, sizes 14px - 16px. Used for descriptions, inputs.
- **Caption:** Regular, sizes 12px. Used for badges, status indicators.

## Spacing System

Our spacing system is based on a 4pt/8pt grid:
- `xs`: 4px
- `sm`: 8px
- `md`: 16px (Default padding)
- `lg`: 24px (Section spacing)
- `xl`: 32px

## Component Guidelines

### Cards
- Border Radius: `16px` or `24px` for modals.
- Shadows: Soft, diffused shadows (`elevation: 2-5`) to create depth without being harsh.
- Borders: Subtle borders (`1px`) using the secondary color with low opacity.

### Buttons
- Primary buttons should use the primary brand color with a bold white text.
- Border radius: `12px` or `pill (999px)`.
- Use ActivityIndicator when loading.

### Navigation
- Bottom tabs should use `@expo/vector-icons` (Ionicons) with active states highlighted in the Primary color.
