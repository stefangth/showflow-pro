// Merge into eslint.config.js. Run at "warn" for one sprint, then flip to "error".
// Scoped to feature code: src/components/ui is where raw values are allowed to live.

export const uiConventions = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/components/ui/**', 'src/**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'warn',
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
        selector: "Literal[value=/\\b(bg|text|border)-[a-z-]+\\/\\[?[0-9.]+\\]?/]",
        message: 'Ad hoc alpha. Use a tint token. Opacity modifiers silently do nothing on the accent scale. See section 2.',
      },
      {
        selector: "Literal[value=/uppercase/]",
        message: 'Uppercase text is <Eyebrow>. Do not hand-roll the eyebrow. See section 5.',
      },
      {
        selector: "Literal[value=/\\brounded-(sm|md|lg)\\b/]",
        message: 'Retired shadcn radius alias. Use the design-system scale: s (6), m (8), l (10). See section 2.',
      },
    ],
    'no-restricted-imports': [
      'warn',
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
