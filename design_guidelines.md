# Design Guidelines: Insurance Management Login Interface

## Design Approach

**Reference-Based**: This is a Korean insurance management system login interface with a specific design already provided. The design follows the exact specifications from the provided React component, maintaining precise layout and visual hierarchy.

## Core Design Principles

1. **Dual-Panel Layout**: Asymmetric split with decorative left panel and functional right panel
2. **Atmospheric Backgrounds**: Layered blur effects create depth and visual interest
3. **Precision Positioning**: Absolute coordinate-based layout for pixel-perfect reproduction
4. **Korean Language First**: All text, labels, and placeholders in Korean

## Layout System

**Spacing**: Use Tailwind units of 2, 4, 6, and 8 for consistent spacing (p-4, m-6, gap-8, etc.)

**Structure**:
- Full viewport height container (100vh)
- Fixed header at top
- Left panel: ~60% width, decorative with blur effects and vector graphics
- Right panel: ~40% width, login form centered vertically
- Background blur ellipses positioned absolutely for depth effect

## Typography

**Font Stack**: Use Korean-optimized fonts via Google Fonts
- Primary: Noto Sans KR (400, 500, 700 weights)
- Fallback: system-ui, -apple-system

**Hierarchy**:
- Login Title (h2): text-2xl font-bold
- Subtitle: text-sm text-gray-600
- Labels: text-sm font-medium
- Input Placeholders: text-sm text-gray-400
- Button Text: text-base font-semibold

## Component Library

### Header
- Logo area with vector graphics/placeholder divs
- Hidden navigation menu (display: none by default, can be enabled)
- Hidden user profile section (display: none by default)
- Height: ~80px, full width with subtle backdrop

### Background Elements
- Three blur ellipses at different sizes and opacities
- Positioned absolutely to create layered depth
- Gradient blur effects for atmospheric feel
- Duplicate set within left panel for enhanced effect

### Left Decorative Panel
- Vector graphic placeholder (replace with actual insurance-themed illustration)
- Centered blur effect cluster
- Acts as brand/marketing space

### Login Form Section (Right Panel)
- Vertically and horizontally centered within panel
- Max width: 400px
- Components stack with consistent 6-8 unit spacing

**Form Fields**:
- Label above input pattern
- Input containers with border and rounded corners
- First field: Text input with placeholder "성함을 입력해주세요"
- Second field: Password with 13 masked dots (6px circles)
- Field height: 48px
- Border radius: 8px

**Auto-Login Checkbox**:
- Custom checkbox with 20px box
- Check mark indicator
- Text label aligned vertically center
- Full clickable row

**Submit Button**:
- Full width within form container
- Height: 52px
- Rounded corners (8px)
- Text: "로그인" centered
- Inner wrapper for text positioning

## Visual Treatment Notes

- **No color specifications provided** - colors will be defined separately
- **Minimal animations** - focus on static precision
- **Icons/vectors** as placeholder divs - replace with actual assets
- **Responsive behavior**: Maintain proportions, stack panels on mobile (<768px)

## Accessibility Requirements

- All form inputs must have associated labels
- Checkbox must be keyboard accessible
- Submit button must have focus states
- Password field must properly mask input
- Maintain consistent tab order through form

## Critical Implementation Details

1. Maintain absolute positioning approach from original design
2. Preserve exact DOM structure for CSS module compatibility
3. Use placeholder divs for logo vectors until assets provided
4. Password field uses 13 individual dot elements (not input masking)
5. Auto-login checkbox is custom-styled, not native
6. All text content in Korean language
7. Form does not include "forgot password" or "sign up" links in this version

## Images

**No hero images required** - decorative elements are vector graphics and blur effects. Logo area expects vector graphic or SVG logo asset to be inserted into placeholder divs.