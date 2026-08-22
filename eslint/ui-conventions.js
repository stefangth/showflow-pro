// Wired into eslint.config.js and run at 'error' (Wave 2, ADR 0012).
// Scoped to feature code: src/components/ui is where raw values are allowed to live.
//
// Also exempt: the non-Tailwind renderer boundaries. These modules define raw
// colors for renderers Tailwind does not reach (the hire-order PDF theme via
// react-pdf, the transactional-email theme via React Email, the avatar palette
// baked into inline SVG/style). They are the design-token *source* for those
// renderers, the same role src/components/ui plays for the DOM, so raw hex is
// correct there. pdfTheme.ts / emailTheme.ts / render.tsx are also dual-homed
// mirror sources (see scripts/mirrors.manifest.json).
export const uiConventions = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: [
    'src/components/ui/**',
    'src/**/*.test.{ts,tsx}',
    'src/lib/hireOrders/pdf/**',
    'src/lib/emailTemplates/**',
    'src/lib/avatar.ts',
  ],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
        message: 'Raw hex. Use a token: var(--accent-500), text-foreground, bg-muted. See docs/ui-conventions.md section 2.',
      },
      {
        selector: "Literal[value=/\\btext-\\[[0-9.]+px\\]/]",
        message: 'Bracket type size. The scale is 48/32/22/17/14/13/12/11. 13 is the control size. See section 3.',
      },
      {
        selector: "Literal[value=/\\brounded-\\[[0-9]+px\\]/]",
        message: 'Bracket radius. Use rounded-xs|s|m|l|xl|xxl|pill. See section 2.',
      },
      {
        // Bracket alpha only: bg-foreground/[0.04], text-x/[0.6]. Valid
        // HSL-channel utilities (bg-primary/80, bg-muted/80, active:bg-accent/80)
        // are legitimate and NOT flagged.
        // / is the "/" — esquery treats a literal / as the regex
        // terminator (even inside a character class), so it must be escaped.
        selector: "Literal[value=/\\b(bg|text|border)-[a-z-]+\\u002F\\[[0-9.]+\\]/]",
        message: 'Ad hoc bracket alpha. Use a tint token or a solid stop. See section 2.',
      },
      {
        // Accent numbered stops are plain hex, so an opacity modifier
        // (bg-accent-500/20) silently no-ops. Must be a solid stop or rgba().
        selector: "Literal[value=/\\b(bg|text|border)-accent-[0-9]00\\u002F[0-9]+/]",
        message: 'Opacity on the accent scale silently no-ops (the stops are hex). Use a solid stop, rgba(), or a tint token. See section 2.',
      },
      {
        // Only the Tailwind `uppercase` utility inside a className token, not
        // any literal that merely contains the substring (comments, data values).
        selector: "Literal[value=/(^|[\\s'\"`(])uppercase([\\s'\"`)]|$)/]",
        message: 'Uppercase text is <Eyebrow>. Do not hand-roll the eyebrow. See section 5.',
      },
      {
        selector: "Literal[value=/\\brounded-(sm|md|lg)\\b/]",
        message: 'Retired shadcn radius alias. Use the design-system scale: s (6), m (8), l (10). See section 2.',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/Design System/**'],
            message: 'Design System/ is brand history, not a spec. See ADR 0012 and docs/ui-conventions.md.',
          },
        ],
      },
    ],
  },
};
