/* spec.jsx — Layout patterns + extended component examples for the design
   system document. Builds on tokens.jsx / logos.jsx / components.jsx. */

// ── Spec doc primitives ────────────────────────────────────────────────────
const Spec = {
  // Section heading row
  H: ({ id, eyebrow, title, sub }) => (
    <header id={id} style={{
      display: 'grid', gridTemplateColumns: '1fr',
      gap: 6, marginBottom: 28, paddingTop: 8,
      scrollMarginTop: 24,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.16em',
        textTransform: 'uppercase', color: 'var(--accent-600)' }}>{eyebrow}</div>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)',
        fontSize: 36, fontWeight: 600, letterSpacing: -0.8,
        lineHeight: 1.05, color: 'var(--text)' }}>{title}</h2>
      {sub && <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--text-muted)',
        maxWidth: 660, lineHeight: 1.5 }}>{sub}</p>}
    </header>
  ),

  // Subsection heading
  H3: ({ children, mt = 32 }) => (
    <h3 style={{ margin: `${mt}px 0 14px`, fontSize: 13,
      fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text-faint)' }}>{children}</h3>
  ),

  // Block wrapper
  Block: ({ children, style }) => (
    <section style={{ marginBottom: 56, ...style }}>{children}</section>
  ),

  // Demo container + code-style caption
  Demo: ({ children, label, code, bg, style }) => (
    <figure style={{ margin: 0, marginBottom: 14 }}>
      <div style={{
        background: bg || 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 12,
        padding: 24,
        ...style,
      }}>{children}</div>
      {(label || code) && (
        <figcaption style={{ display: 'flex', justifyContent: 'space-between',
          gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
          {label && <span>{label}</span>}
          {code && <code style={{ fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)' }}>{code}</code>}
        </figcaption>
      )}
    </figure>
  ),

  // Token table
  Table: ({ rows, cols = ['Token', 'Value', 'Use'] }) => (
    <div style={{ border: '0.5px solid var(--line)', borderRadius: 10,
      overflow: 'hidden', background: 'var(--surface)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(' + cols.length + ', 1fr)',
        gap: 0, padding: '10px 16px',
        borderBottom: '0.5px solid var(--line)',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-faint)',
      }}>
        {cols.map((c, i) => <div key={i}>{c}</div>)}
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: 'repeat(' + cols.length + ', 1fr)',
          gap: 0, padding: '10px 16px', alignItems: 'center',
          borderTop: i === 0 ? 'none' : '0.5px solid var(--line)',
          fontSize: 13, color: 'var(--text)',
        }}>
          {row.map((cell, j) => (
            <div key={j} style={{
              fontFamily: j === 1 ? 'var(--font-mono)' : 'var(--font-body)',
              color: j === 1 ? 'var(--text-muted)' : j === 2 ? 'var(--text-muted)' : 'var(--text)',
              fontSize: j === 1 ? 12 : 13,
            }}>{cell}</div>
          ))}
        </div>
      ))}
    </div>
  ),
};

// ── Demo: Color palette swatches ───────────────────────────────────────────
function PaletteScale({ tokens }) {
  const a = tokens.accent;
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
      {steps.map((s) => (
        <div key={s} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            height: 96, background: a[s], borderRadius: 8,
            border: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'flex-end', padding: 8,
          }}>
            {s === 500 && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#fff',
                background: 'rgba(0,0,0,.18)', padding: '2px 6px', borderRadius: 4 }}>
                base
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
            {s}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)' }}>{a[s].toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

function NeutralsRow({ tokens }) {
  const items = [
    ['Page', tokens.n.bg, '--bg'],
    ['Surface', tokens.n.surface, '--surface'],
    ['Recessed', tokens.n.surface2, '--surface-2'],
    ['Line', tokens.mode === 'dark' ? '#2A2832' : '#E8E5DD', '--line'],
    ['Text', tokens.n.text, '--text'],
    ['Muted', tokens.n.textMuted, '--text-muted'],
    ['Faint', tokens.n.textFaint, '--text-faint'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
      {items.map(([label, c, tok]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 72, background: c, borderRadius: 8,
            border: '0.5px solid var(--line)' }} />
          <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)' }}>{tok}</div>
        </div>
      ))}
    </div>
  );
}

function SemanticRow({ tokens }) {
  const items = [
    { label: 'Confirmed', hex: '#16A34A', use: 'Booked dates, settled invoices' },
    { label: 'Hold',      hex: '#D97706', use: '1st/2nd holds, pending action' },
    { label: 'At risk',   hex: '#DC2626', use: 'Drive conflicts, expired holds' },
    { label: 'Routed',    hex: tokens.accent[500], use: 'Active routings, primary brand surface' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {items.map((it) => (
        <div key={it.label} style={{
          padding: 14, background: 'var(--surface)',
          border: '0.5px solid var(--line)', borderRadius: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: it.hex }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{it.use}</div>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-faint)' }}>{it.hex}</code>
        </div>
      ))}
    </div>
  );
}

// ── Type scale demo ────────────────────────────────────────────────────────
function TypeScaleDemo({ tokens }) {
  const scale = [
    { name: 'Display',    size: 48, line: 56, weight: 600, ff: 'display', tracking: -1.0, sample: 'Tour Q3 · Tame Impala', token: '--text-display' },
    { name: 'H1',         size: 32, line: 38, weight: 600, ff: 'display', tracking: -0.6, sample: 'Routing pipeline', token: '--text-h1' },
    { name: 'H2',         size: 22, line: 28, weight: 600, ff: 'display', tracking: -0.3, sample: 'Settlements & holds', token: '--text-h2' },
    { name: 'H3',         size: 17, line: 24, weight: 600, ff: 'body',    tracking: -0.1, sample: 'Active routings', token: '--text-h3' },
    { name: 'Body L',     size: 16, line: 24, weight: 400, ff: 'body',    tracking:  0,   sample: 'Confirmed at 9:14 AM by Maya. Settlement attached.', token: '--text-body-l' },
    { name: 'Body',       size: 14, line: 20, weight: 400, ff: 'body',    tracking:  0,   sample: 'Madison Square Garden · 19,500 cap · Apr 14', token: '--text-body' },
    { name: 'Caption',    size: 12, line: 16, weight: 500, ff: 'body',    tracking:  0.1, sample: 'EST · Doors 7:30 PM', token: '--text-caption' },
    { name: 'Eyebrow',    size: 11, line: 14, weight: 600, ff: 'body',    tracking:  1.6, sample: 'ACTIVE ROUTINGS', token: '--text-eyebrow' },
    { name: 'Mono',       size: 12, line: 16, weight: 500, ff: 'mono',    tracking:  0,   sample: '$184,250.00 · INV-0931', token: '--text-mono' },
  ];
  return (
    <div style={{
      border: '0.5px solid var(--line)', borderRadius: 12,
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      {scale.map((s, i) => (
        <div key={s.name} style={{
          display: 'grid', gridTemplateColumns: '120px 1fr 220px',
          gap: 24, padding: '18px 22px', alignItems: 'baseline',
          borderTop: i === 0 ? 'none' : '0.5px solid var(--line)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
            <code style={{ fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--text-faint)' }}>{s.token}</code>
          </div>
          <div style={{
            fontFamily: tokens.type[s.ff],
            fontSize: s.size, fontWeight: s.weight,
            lineHeight: `${s.line}px`,
            letterSpacing: s.tracking + 'px',
            color: 'var(--text)',
          }}>{s.sample}</div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {s.size}px / {s.line}px · {s.weight} · {s.tracking}em
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Spacing scale demo ─────────────────────────────────────────────────────
function SpacingDemo() {
  const steps = [
    [0, '--space-0', 0],
    [1, '--space-1', 2],
    [2, '--space-2', 4],
    [3, '--space-3', 6],
    [4, '--space-4', 8],
    [5, '--space-5', 12],
    [6, '--space-6', 16],
    [7, '--space-7', 24],
    [8, '--space-8', 32],
    [9, '--space-9', 48],
    [10,'--space-10', 64],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map(([n, tok, px]) => (
        <div key={n} style={{ display: 'grid', gridTemplateColumns: '70px 110px 1fr',
          gap: 16, alignItems: 'center', padding: '8px 16px',
          background: 'var(--surface)', borderRadius: 8, border: '0.5px solid var(--line)' }}>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--text)' }}>{n}</code>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--text-muted)' }}>{tok}</code>
          <div style={{ height: 14, width: px, background: 'var(--accent-500)',
            borderRadius: 2, minWidth: px === 0 ? 2 : px, opacity: px === 0 ? 0.3 : 1 }} />
        </div>
      ))}
    </div>
  );
}

// ── Radius demo ────────────────────────────────────────────────────────────
function RadiusDemo() {
  const items = [
    [4,  '--radius-xs',  'Tags, inline chips'],
    [6,  '--radius-s',   'Inputs, status dots'],
    [8,  '--radius-m',   'Buttons, cards'],
    [10, '--radius-l',   'Section cards'],
    [14, '--radius-xl',  'Hero cards, sheets'],
    [20, '--radius-xxl', 'App icons'],
    [999,'--radius-pill','Pills, capsules'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
      {items.map(([r, tok, use]) => (
        <div key={tok} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ aspectRatio: '1', background: 'var(--accent-100)',
            borderRadius: r, border: '0.5px solid var(--accent-300)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-700)', fontWeight: 600 }}>{r === 999 ? '∞' : r}</div>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-muted)' }}>{tok}</code>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{use}</div>
        </div>
      ))}
    </div>
  );
}

// ── Elevation demo ─────────────────────────────────────────────────────────
function ElevationDemo() {
  const levels = [
    [0, '--shadow-0', 'none',                                              'Inline'],
    [1, '--shadow-1', '0 1px 2px rgba(20,18,14,.05)',                      'Inputs'],
    [2, '--shadow-2', '0 1px 2px rgba(20,18,14,.04), 0 4px 10px rgba(20,18,14,.05)', 'Cards'],
    [3, '--shadow-3', '0 1px 2px rgba(20,18,14,.04), 0 8px 24px rgba(20,18,14,.08)', 'Floating panels'],
    [4, '--shadow-4', '0 24px 48px rgba(20,18,14,.16)',                    'Modals'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, padding: '20px 0' }}>
      {levels.map(([n, tok, val, use]) => (
        <div key={n} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={{
            width: 88, height: 88, borderRadius: 12,
            background: 'var(--surface)', boxShadow: val,
            border: '0.5px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--text-faint)',
          }}>{n}</div>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-muted)' }}>{tok}</code>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{use}</div>
        </div>
      ))}
    </div>
  );
}

// ── Layout pattern: App shell wireframe ────────────────────────────────────
function AppShellPattern({ tokens }) {
  return (
    <div style={{
      height: 360,
      border: '0.5px solid var(--line)', borderRadius: 12,
      overflow: 'hidden', background: 'var(--surface-2)',
      display: 'grid', gridTemplateColumns: '180px 1fr', gridTemplateRows: '44px 1fr',
      gap: 1, position: 'relative',
    }}>
      {/* sidebar */}
      <div style={{ gridRow: '1 / span 2', background: 'var(--surface)',
        padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Wordmark logoVariant={3} size={16} color={tokens.n.text} accent={tokens.accent[500]} tokens={tokens} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {['Today', 'Routing', 'Pipeline', 'Artists', 'Venues'].map((n, i) => (
            <div key={n} style={{
              height: 22, padding: '0 8px', borderRadius: 6,
              display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: i === 0 ? 600 : 500,
              background: i === 0 ? 'var(--accent-100)' : 'transparent',
              color: i === 0 ? 'var(--accent-700)' : 'var(--text-muted)',
            }}>{n}</div>
          ))}
        </div>
        <div style={{ marginTop: 'auto', height: 28, borderRadius: 6,
          background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
      </div>
      {/* topbar */}
      <div style={{ background: 'var(--surface)',
        borderBottom: '0.5px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        <div style={{ height: 22, width: 200, borderRadius: 6,
          background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
        <div style={{ flex: 1 }} />
        <div style={{ height: 22, width: 22, borderRadius: 4, background: 'var(--surface-2)' }} />
        <div style={{ height: 22, width: 22, borderRadius: 4, background: 'var(--surface-2)' }} />
        <div style={{ height: 22, width: 60, borderRadius: 6, background: 'var(--accent-500)' }} />
      </div>
      {/* canvas */}
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 18, width: '40%', borderRadius: 4, background: 'var(--surface)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ height: 64, background: 'var(--surface)',
                border: '0.5px solid var(--line)', borderRadius: 8 }} />
            ))}
          </div>
          <div style={{ flex: 1, background: 'var(--surface)',
            border: '0.5px solid var(--line)', borderRadius: 8 }} />
        </div>
        <div style={{ background: 'var(--surface)',
          border: '0.5px solid var(--line)', borderRadius: 8 }} />
      </div>

      {/* annotations */}
      {[
        { t: 12, l: 180 + 12, label: 'Top bar · 44px', side: 'right' },
        { t: 12, l: 12, label: 'Sidebar · 220px', side: 'right' },
        { t: 60, l: 200, label: 'Page · 24px gutter', side: 'right' },
      ].map((a, i) => null)}
    </div>
  );
}

// ── Layout patterns: gallery ───────────────────────────────────────────────
function LayoutGallery({ tokens }) {
  const Pattern = ({ title, sub, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      </div>
      <div style={{ height: 220,
        border: '0.5px solid var(--line)', borderRadius: 10,
        background: 'var(--surface-2)', overflow: 'hidden',
        position: 'relative',
      }}>
        {children}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {/* Dashboard */}
      <Pattern title="Dashboard" sub="Headline + KPI band + 2-column body. Use for Today / Overviews.">
        <div style={{ padding: 14, height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ height: 16, width: '45%', background: 'var(--surface)', borderRadius: 4 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ height: 42, background: 'var(--surface)',
                borderRadius: 6, border: '0.5px solid var(--line)' }} />
            ))}
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 6 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 6, border: '0.5px solid var(--line)' }} />
            <div style={{ background: 'var(--surface)', borderRadius: 6, border: '0.5px solid var(--line)' }} />
          </div>
        </div>
      </Pattern>

      {/* List + detail */}
      <Pattern title="List · Detail" sub="Two-pane with inline filters. Use for Pipeline, Settlements.">
        <div style={{ padding: 14, height: '100%', boxSizing: 'border-box',
          display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[0,1,2,3,4,5,6].map(i => (
              <div key={i} style={{ height: 22, background: i === 1 ? tokens.accent[100] : 'var(--surface)',
                borderRadius: 4, border: '0.5px solid var(--line)' }} />
            ))}
          </div>
          <div style={{ background: 'var(--surface)', borderRadius: 6,
            border: '0.5px solid var(--line)', display: 'flex',
            flexDirection: 'column', gap: 6, padding: 10 }}>
            <div style={{ height: 16, width: '55%', background: 'var(--surface-2)', borderRadius: 4 }} />
            <div style={{ height: 8, width: '30%', background: 'var(--surface-2)', borderRadius: 4 }} />
            <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 4 }} />
          </div>
        </div>
      </Pattern>

      {/* Kanban */}
      <Pattern title="Kanban" sub="Vertical columns of cards with status headers. Use for Pipeline.">
        <div style={{ padding: 14, height: '100%', boxSizing: 'border-box',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {['Pitch', 'Hold', 'Routed', 'Confirmed'].map((c, i) => (
            <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ height: 14, background: 'var(--surface)', borderRadius: 3,
                border: '0.5px solid var(--line)' }} />
              <div style={{ height: 32, background: 'var(--surface)', borderRadius: 4,
                border: '0.5px solid var(--line)' }} />
              <div style={{ height: 32, background: 'var(--surface)', borderRadius: 4,
                border: '0.5px solid var(--line)' }} />
              {i < 2 && <div style={{ height: 32, background: 'var(--surface)', borderRadius: 4,
                border: '0.5px solid var(--line)' }} />}
            </div>
          ))}
        </div>
      </Pattern>

      {/* Calendar / timeline */}
      <Pattern title="Timeline" sub="Horizontal week ruler with stacked bars. Use for Routing.">
        <div style={{ padding: 14, height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0,1,2,3,4,5].map(i => (
              <div key={i} style={{ flex: 1, height: 10, background: 'var(--surface)',
                borderRadius: 2, border: '0.5px solid var(--line)' }} />
            ))}
          </div>
          {[
            { l: 0, w: 35, c: tokens.accent[500] },
            { l: 22, w: 28, c: tokens.accent[300] },
            { l: 52, w: 24, c: '#16A34A' },
            { l: 10, w: 50, c: tokens.accent[500] },
            { l: 60, w: 20, c: '#DC2626' },
          ].map((b, i) => (
            <div key={i} style={{ position: 'relative', height: 14,
              background: 'var(--surface)', borderRadius: 3, border: '0.5px solid var(--line)' }}>
              <div style={{ position: 'absolute', top: 2, bottom: 2,
                left: `${b.l}%`, width: `${b.w}%`, background: b.c, borderRadius: 2 }} />
            </div>
          ))}
        </div>
      </Pattern>

      {/* Settings form */}
      <Pattern title="Settings · Form" sub="Long form on a narrow column with section dividers.">
        <div style={{ padding: 14, height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 14, width: '60%', background: 'var(--surface)', borderRadius: 3 }} />
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '0.6fr 1fr', gap: 8,
              padding: '4px 0', borderTop: i === 0 ? 'none' : '0.5px solid var(--line)' }}>
              <div style={{ height: 8, background: 'var(--surface)', borderRadius: 3, alignSelf: 'center' }} />
              <div style={{ height: 18, background: 'var(--surface)', borderRadius: 4, border: '0.5px solid var(--line)' }} />
            </div>
          ))}
        </div>
      </Pattern>

      {/* Modal */}
      <Pattern title="Modal · Sheet" sub="Centered overlay for focused tasks. Body scrolls under header & footer.">
        <div style={{ height: '100%', position: 'relative',
          background: 'repeating-linear-gradient(45deg, transparent 0 8px, rgba(0,0,0,.03) 8px 9px)' }}>
          <div style={{
            position: 'absolute', top: 30, left: '50%', transform: 'translateX(-50%)',
            width: '78%', height: 160, background: 'var(--surface)', borderRadius: 12,
            border: '0.5px solid var(--line)', boxShadow: '0 12px 32px rgba(20,18,14,.18)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--line)',
              fontSize: 12, fontWeight: 600 }}>Confirm hold</div>
            <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 8, width: '70%', background: 'var(--surface-2)', borderRadius: 3 }} />
              <div style={{ height: 8, width: '55%', background: 'var(--surface-2)', borderRadius: 3 }} />
              <div style={{ height: 8, width: '40%', background: 'var(--surface-2)', borderRadius: 3 }} />
            </div>
            <div style={{ padding: 10, borderTop: '0.5px solid var(--line)',
              display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <div style={{ width: 56, height: 22, borderRadius: 6,
                background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
              <div style={{ width: 70, height: 22, borderRadius: 6, background: tokens.accent[500] }} />
            </div>
          </div>
        </div>
      </Pattern>
    </div>
  );
}

Object.assign(window, {
  Spec, PaletteScale, NeutralsRow, SemanticRow,
  TypeScaleDemo, SpacingDemo, RadiusDemo, ElevationDemo,
  LayoutGallery, AppShellPattern,
});
