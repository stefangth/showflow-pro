/* tokens.jsx — design tokens resolved from tweak state */

const ACCENTS = {
  violet: {
    name: 'Violet',
    50:  '#F4F1FF',
    100: '#E5DEFF',
    200: '#CABBFF',
    300: '#A88EFF',
    400: '#8A6DF6',
    500: '#6E5CF6',
    600: '#5848D8',
    700: '#4738B0',
    800: '#322685',
    900: '#1E175A',
    ink: '#1E175A',
  },
  cyan: {
    name: 'Cyan',
    50:  '#ECFBFE',
    100: '#CFF3FA',
    200: '#9DE3F2',
    300: '#5BCFE6',
    400: '#1CB6D3',
    500: '#0891B2',
    600: '#0B7593',
    700: '#0E5B73',
    800: '#0B4154',
    900: '#062A38',
    ink: '#062A38',
  },
  warm: {
    name: 'Ember',
    50:  '#FDF5EF',
    100: '#FAE6D4',
    200: '#F3C9A4',
    300: '#EAA774',
    400: '#DD8551',
    500: '#C8633A',
    600: '#A84B2C',
    700: '#883A24',
    800: '#5F2A1C',
    900: '#3A1B14',
    ink: '#3A1B14',
  },
};

// Neutrals — slightly warm for premium ops feel
const NEUTRALS_LIGHT = {
  bg:        '#F6F4EF',  // page
  surface:   '#FFFFFF',  // cards
  surface2:  '#FAF8F4',  // recessed
  line:      'rgba(20, 18, 14, 0.08)',
  lineStrong:'rgba(20, 18, 14, 0.14)',
  text:      '#15131C',
  textMuted: '#5B5A57',
  textFaint: '#8B8A85',
  shadow:    '0 1px 2px rgba(20,18,14,.04), 0 8px 24px rgba(20,18,14,.06)',
};

const NEUTRALS_DARK = {
  bg:        '#0D0C10',
  surface:   '#16151B',
  surface2:  '#1C1B22',
  line:      'rgba(255, 255, 255, 0.08)',
  lineStrong:'rgba(255, 255, 255, 0.14)',
  text:      '#F5F4F1',
  textMuted: '#A6A5A1',
  textFaint: '#6F6E6A',
  shadow:    '0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45)',
};

const TYPEFACES = {
  inter: {
    name: 'Inter + Space Grotesk',
    display: '"Space Grotesk", "Inter", system-ui, sans-serif',
    body:    '"Inter", system-ui, sans-serif',
    mono:    '"JetBrains Mono", ui-monospace, monospace',
    googleHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  geist: {
    name: 'Geist',
    display: '"Geist", system-ui, sans-serif',
    body:    '"Geist", system-ui, sans-serif',
    mono:    '"Geist Mono", ui-monospace, monospace',
    googleHref: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap',
  },
  serif: {
    name: 'Fraunces + Inter',
    display: '"Instrument Serif", "Fraunces", serif',
    body:    '"Inter", system-ui, sans-serif',
    mono:    '"JetBrains Mono", ui-monospace, monospace',
    googleHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap',
  },
};

function useTokens(tw) {
  return React.useMemo(() => {
    const accent = ACCENTS[tw.accent] || ACCENTS.violet;
    const neutrals = tw.mode === 'dark' ? NEUTRALS_DARK : NEUTRALS_LIGHT;
    const type = TYPEFACES[tw.typeface] || TYPEFACES.inter;
    const dense = tw.density === 'compact';
    return {
      mode: tw.mode,
      accent,
      n: neutrals,
      type,
      space: {
        xs: dense ? 4 : 6,
        s:  dense ? 8 : 10,
        m:  dense ? 12 : 16,
        l:  dense ? 18 : 24,
        xl: dense ? 24 : 32,
      },
      radius: { s: 6, m: 10, l: 14, xl: 20, pill: 999 },
      rowH: dense ? 28 : 34,
      btnH: dense ? 30 : 36,
      density: tw.density,
    };
  }, [tw.accent, tw.mode, tw.typeface, tw.density]);
}

// Ensure all typeface stylesheets are loaded once. This loads upfront so
// switching typefaces is instant.
function useGoogleFonts() {
  React.useEffect(() => {
    Object.values(TYPEFACES).forEach((t) => {
      if (document.querySelector(`link[data-tf="${t.name}"]`)) return;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = t.googleHref;
      l.setAttribute('data-tf', t.name);
      document.head.appendChild(l);
    });
  }, []);
}

Object.assign(window, { ACCENTS, NEUTRALS_LIGHT, NEUTRALS_DARK, TYPEFACES, useTokens, useGoogleFonts });
