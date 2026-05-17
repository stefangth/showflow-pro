/* system.jsx — palette + typography + components catalog artboards */

// ─── Reusable bits ─────────────────────────────────────────────────────────
const SectionLabel = ({ children, tokens }) => (
  <div style={{
    fontFamily: tokens.type.body,
    fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
    textTransform: 'uppercase', color: tokens.n.textFaint,
  }}>{children}</div>
);

const Mono = ({ children, tokens, size = 11 }) => (
  <span style={{
    fontFamily: tokens.type.mono, fontSize: size, color: tokens.n.textMuted,
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  }}>{children}</span>
);

// ─── Color palette artboard ────────────────────────────────────────────────
const PaletteArtboard = ({ tokens, width, height }) => {
  const a = tokens.accent;
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  return (
    <div style={{
      width, height, padding: 28, boxSizing: 'border-box',
      background: tokens.n.bg, color: tokens.n.text,
      fontFamily: tokens.type.body,
      display: 'flex', flexDirection: 'column', gap: 22,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <SectionLabel tokens={tokens}>Accent · {a.name}</SectionLabel>
          <div style={{ fontFamily: tokens.type.display, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 4 }}>
            Primary scale
          </div>
        </div>
        <Mono tokens={tokens} size={11}>10 steps · OKLCH-tuned</Mono>
      </div>

      {/* Stairstep scale */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
        {steps.map((s) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 64, background: a[s], borderRadius: 6, border: `0.5px solid ${tokens.n.line}` }} />
            <div style={{ fontSize: 10, color: tokens.n.textMuted, fontVariantNumeric: 'tabular-nums' }}>{s}</div>
            <Mono tokens={tokens} size={9}>{a[s].toUpperCase()}</Mono>
          </div>
        ))}
      </div>

      {/* Neutrals + Semantics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 22, flex: 1 }}>
        <div>
          <SectionLabel tokens={tokens}>Neutrals</SectionLabel>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              ['bg', tokens.n.bg, 'Page'],
              ['surface', tokens.n.surface, 'Surface'],
              ['surface2', tokens.n.surface2, 'Recessed'],
              ['line', tokens.mode === 'dark' ? '#2A2832' : '#E8E5DD', 'Line'],
              ['text', tokens.n.text, 'Text'],
              ['muted', tokens.n.textMuted, 'Muted'],
            ].map(([k, c, label]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ height: 44, background: c, borderRadius: 6, border: `0.5px solid ${tokens.n.line}` }} />
                <div style={{ fontSize: 11, fontWeight: 500 }}>{label}</div>
                <Mono tokens={tokens} size={9}>{c}</Mono>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionLabel tokens={tokens}>Semantic</SectionLabel>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['Confirmed', '#16A34A'],
              ['Hold', '#D97706'],
              ['At risk',  '#DC2626'],
              ['Routed',   a[500]],
            ].map(([label, c]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 8px', background: tokens.n.surface, borderRadius: 6,
                border: `0.5px solid ${tokens.n.line}` }}>
                <div style={{ width: 10, height: 10, borderRadius: 3, background: c }} />
                <div style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{label}</div>
                <Mono tokens={tokens} size={9}>{c}</Mono>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Typography spec artboard ──────────────────────────────────────────────
const TypeArtboard = ({ tokens, width, height }) => {
  const scale = [
    { name: 'Display',  size: 48, weight: 600, ff: 'display', sample: 'Tour Q3 · Tame Impala' },
    { name: 'H1',       size: 32, weight: 600, ff: 'display', sample: 'Routing pipeline' },
    { name: 'H2',       size: 22, weight: 600, ff: 'display', sample: 'Settlements & holds' },
    { name: 'Body L',   size: 16, weight: 400, ff: 'body',    sample: 'Confirmed at 9:14 AM by Maya — settlement attached.' },
    { name: 'Body',     size: 14, weight: 400, ff: 'body',    sample: 'Madison Square Garden · 19,500 cap · Apr 14' },
    { name: 'Caption',  size: 12, weight: 500, ff: 'body',    sample: 'EST · Doors 7:30 PM' },
    { name: 'Mono',     size: 12, weight: 500, ff: 'mono',    sample: '$184,250.00 · INV-0931' },
  ];
  return (
    <div style={{
      width, height, padding: 28, boxSizing: 'border-box',
      background: tokens.n.bg, color: tokens.n.text,
      fontFamily: tokens.type.body,
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <SectionLabel tokens={tokens}>Type system</SectionLabel>
          <div style={{ fontFamily: tokens.type.display, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 4 }}>
            {tokens.type.name}
          </div>
        </div>
        <Mono tokens={tokens} size={11}>{tokens.density === 'compact' ? 'Compact' : 'Comfortable'} · 1.250 ratio</Mono>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {scale.map((s, i) => (
          <div key={s.name} style={{
            display: 'grid', gridTemplateColumns: '70px 1fr 110px',
            gap: 16, alignItems: 'baseline',
            padding: '10px 0',
            borderTop: i === 0 ? 'none' : `0.5px solid ${tokens.n.line}`,
          }}>
            <div style={{ fontSize: 11, color: tokens.n.textFaint, fontWeight: 500 }}>{s.name}</div>
            <div style={{
              fontFamily: tokens.type[s.ff],
              fontSize: s.size,
              fontWeight: s.weight,
              letterSpacing: s.size >= 32 ? -s.size * 0.018 : 0,
              lineHeight: 1.1,
              color: tokens.n.text,
            }}>{s.sample}</div>
            <Mono tokens={tokens} size={10}>{s.size}/{Math.round(s.size * 1.2)} · {s.weight}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { PaletteArtboard, TypeArtboard, SectionLabel, Mono });
