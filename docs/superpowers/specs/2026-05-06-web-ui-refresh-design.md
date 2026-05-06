# Agent View Web UI Refresh Design

Date: 2026-05-06

## Goal

Refresh the current mobile-first web UI of Agent View by borrowing the visual language and information hierarchy of `ZgDaniel/cc-web`, while keeping the existing single-page focus model and session management workflow intact.

The target is a small-to-medium redesign:

- move the UI closer to `cc-web`
- avoid a full structural rewrite
- preserve current session/group/inbox behavior
- keep the page optimized for mobile first

## Confirmed Direction

The chosen direction is the conservative hybrid approach:

- keep the current single-page focused session view
- do not rebuild the page into a permanent desktop sidebar workspace
- shift the styling toward a warm light workspace similar to `cc-web`
- simplify the top controls
- make the main session area feel more like a chat workbench

## Non-Goals

- no backend API changes
- no session data model changes
- no transcript pagination or refresh logic rewrite
- no desktop-first admin/dashboard redesign
- no conversion of transcript output into full chat bubbles

## Current UI Problems

The current web page is functional but visually reads more like a utility panel than an interaction workspace.

Main issues:

- top bar is overloaded with three equally weighted buttons
- deep blue glassmorphism pushes the page toward a status dashboard feel
- the primary action hierarchy is unclear
- the session switcher is functionally useful but visually detached from the rest of the page
- transcript, quick actions, and input area do not feel like one continuous work surface

## Reference Extraction From cc-web

The redesign should borrow these parts from `cc-web`:

- warm light background instead of dark glass styling
- lower-contrast, paper-like surfaces
- tighter top header with fewer primary controls
- stronger sense of a continuous message/input workspace
- session navigation that feels like a mobile drawer instead of a generic modal

The redesign should not copy these parts literally:

- no full conversion to a chat-bubble-first conversation model
- no permanent desktop sidebar requirement
- no direct duplication of `cc-web` page architecture

## Information Architecture

### Page Structure

The page will remain a single main screen with three layers:

1. lightweight top header
2. continuous session workspace
3. session drawer for navigation and secondary controls

### Header

The current top bar will be simplified.

New header content:

- left: session menu trigger
- center: current session title
- right: compact status or unread/waiting summary

Removed from the top-level header:

- notification management buttons
- secondary operational controls that compete with the main workflow

Those actions will move into the drawer/settings area.

### Main Workspace

The main card becomes one continuous workbench instead of a stack of visually separate controls.

Sections:

1. session summary strip
   - session title
   - status pill
   - lightweight metadata
2. transcript area
   - existing semantic transcript rendering remains
   - reduced visual weight
3. action and input zone
   - message entry remains primary
   - quick confirm and interrupt remain available but visually secondary

### Session Drawer

The current switcher modal evolves into a drawer-like mobile panel.

It will still contain:

- inbox items
- groups
- sessions
- notification/settings entry points

Behavior remains mostly the same, but the presentation should feel like a navigational sheet tied to the main app rather than a detached overlay utility.

## Visual Design

### Theme

Replace the current dark blue glass style with a warm light theme inspired by `cc-web`.

Color direction:

- warm off-white page background
- sand and beige panel tones
- muted brown-gray text for secondary information
- restrained accent colors for state and action emphasis

### Surface Style

Panels should look soft and practical, not glossy.

Use:

- light surfaces
- thin borders
- subtle shadows
- moderate corner radii

Avoid:

- strong neon gradients
- heavy glow effects
- deep translucent glass feel

### Status Treatment

Status remains important but should no longer dominate the screen.

Suggested treatment:

- `running`: soft green pill
- `waiting`: warm orange pill
- `error`: muted red pill

Status colors should support recognition, not define the page mood.

### Transcript Styling

Transcript keeps terminal semantics and existing line classification.

Changes:

- lighter transcript background
- softer border and less visual heaviness
- preserve semantic distinctions for commands, warnings, prompts, errors, and paths
- keep readability on small screens as the priority

### Input Zone

The input area should feel more like the operational center of the page.

Changes:

- visually unified input container
- stronger send button emphasis
- secondary actions separated from the main send action
- spacing tuned so the bottom section reads like a workbench, not a control dump

## Interaction Changes

### Top Controls

Current controls:

- Session
- Enable Notifications
- Test Notification

New direction:

- keep only the menu trigger in the top bar
- move notification actions into drawer/settings
- reduce header competition with the main session experience

### Action Priority

Primary:

- send message

Secondary:

- quick confirm
- interrupt

This preserves functionality but improves the visual action hierarchy.

### Mobile Priority

The redesign is mobile-first.

Desktop should remain usable and cleaner after the style refresh, but it is not the optimization target. No permanent desktop workspace layout will be introduced in this pass.

## Implementation Scope

Primary file:

- `src/web/ui.html`

Secondary impact:

- minimal or no change expected in `src/web/ui.ts`
- no intentional server API changes in `src/web/server.ts`

Implementation strategy:

- reuse existing inline HTML/CSS/JS structure
- prefer CSS variable and layout refactoring
- make only small DOM structure updates where necessary
- keep current event wiring and refresh behavior

## Risks

### Risk 1: Visual change without hierarchy improvement

If the work only changes colors and borders, the page will still feel like a utility panel.

Mitigation:

- explicitly reshape header, workspace, and action grouping

### Risk 2: Drawer change harming session switching speed

If the switcher becomes too decorative, it may slow down navigation.

Mitigation:

- retain the current group/session logic and direct tap behavior

### Risk 3: Mobile layout regressions

The page currently has narrow-screen safeguards. Structural edits can easily break them.

Mitigation:

- verify narrow widths, wrapped controls, transcript scrolling, and textarea behavior after changes

## Verification Plan

Manual verification should cover:

- header readability on mobile widths
- opening and closing the session drawer
- selecting sessions from groups and inbox
- transcript refresh and scroll-to-top pagination
- send message flow
- quick confirm and interrupt actions
- waiting state visibility
- notification entry discoverability after moving controls

## Success Criteria

The redesign is successful if:

- the page reads as a warm, mobile-first workspace rather than a dark dashboard
- the interface clearly feels closer to `cc-web`
- the current workflow remains intact
- top-level controls are less cluttered
- send/input becomes the primary focal area
- session switching remains fast and understandable
