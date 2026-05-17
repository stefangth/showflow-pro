/* components.jsx — UI components catalog: buttons, inputs, badges, cards, nav */

// ─── Primitive UI components (used across artboards) ────────────────────────
const Btn = ({ children, variant = 'primary', size = 'm', icon, tokens, style }) => {
  const h = size === 's' ? 26 : size === 'l' ? 40 : tokens.btnH;
  const px = size === 's' ? 10 : size === 'l' ? 16 : 12;
  const fs = size === 's' ? 12 : size === 'l' ? 14 : 13;
  const a = tokens.accent;
  const variants = {
    primary: {
      background: a[500], color: '#fff', border: `0.5px solid ${a[600]}`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,.18), 0 1px 2px ${a[800]}33`,
    },
    secondary: {
      background: tokens.n.surface, color: tokens.n.text,
      border: `0.5px solid ${tokens.n.lineStrong}`,
      boxShadow: tokens.mode === 'dark' ? 'none' : '0 1px 2px rgba(20,18,14,.04)',
    },
    ghost: {
      background: 'transparent', color: tokens.n.text,
      border: `0.5px solid transparent`,
    },
    danger: {
      background: tokens.mode === 'dark' ? '#2A1A1A' : '#FEF2F2',
      color: '#B91C1C',
      border: `0.5px solid ${tokens.mode === 'dark' ? '#5A2222' : '#FECACA'}`,
    },
  };
  return (
    <button style={{
      height: h, padding: `0 ${px}px`, borderRadius: 8,
      fontFamily: tokens.type.body, fontSize: fs, fontWeight: 500,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      cursor: 'pointer', whiteSpace: 'nowrap',
      ...variants[variant],
      ...style,
    }}>
      {icon}
      {children}
    </button>
  );
};

const Badge = ({ children, tone = 'neutral', tokens, dot }) => {
  const tones = {
    neutral: { bg: tokens.mode === 'dark' ? '#23222A' : '#EFEDE7', fg: tokens.n.textMuted, dot: tokens.n.textFaint },
    confirmed: { bg: tokens.mode === 'dark' ? '#0F2A1A' : '#E7F5EC', fg: tokens.mode === 'dark' ? '#5EE2A0' : '#157F3D', dot: '#16A34A' },
    hold: { bg: tokens.mode === 'dark' ? '#2A1F0A' : '#FCF1DA', fg: tokens.mode === 'dark' ? '#F0B255' : '#9A6314', dot: '#D97706' },
    risk: { bg: tokens.mode === 'dark' ? '#2A1414' : '#FCEAEA', fg: tokens.mode === 'dark' ? '#F08585' : '#A02323', dot: '#DC2626' },
    accent: { bg: tokens.mode === 'dark' ? `${tokens.accent[800]}AA` : tokens.accent[100], fg: tokens.mode === 'dark' ? tokens.accent[200] : tokens.accent[700], dot: tokens.accent[500] },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      height: 20, padding: '0 7px', borderRadius: 4,
      background: t.bg, color: t.fg,
      fontFamily: tokens.type.body, fontSize: 11, fontWeight: 500,
      letterSpacing: 0.1, whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 3, background: t.dot }} />}
      {children}
    </span>
  );
};

const Input = ({ placeholder, value, tokens, icon, prefix, w }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: tokens.btnH, padding: '0 10px',
    borderRadius: 8, width: w,
    background: tokens.n.surface,
    border: `0.5px solid ${tokens.n.lineStrong}`,
    color: tokens.n.text,
    fontFamily: tokens.type.body, fontSize: 13,
    boxShadow: tokens.mode === 'dark' ? 'inset 0 1px 0 rgba(255,255,255,.04)' : 'inset 0 1px 2px rgba(20,18,14,.03)',
  }}>
    {icon}
    {prefix && <span style={{ color: tokens.n.textFaint }}>{prefix}</span>}
    <span style={{ color: value ? tokens.n.text : tokens.n.textFaint, flex: 1 }}>{value || placeholder}</span>
  </div>
);

const IconBtn = ({ children, tokens, active }) => (
  <button style={{
    width: 28, height: 28, borderRadius: 6,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: active ? (tokens.mode === 'dark' ? '#23222A' : '#EFEDE7') : 'transparent',
    color: tokens.n.text,
    border: `0.5px solid ${active ? tokens.n.lineStrong : 'transparent'}`,
    cursor: 'pointer',
  }}>{children}</button>
);

const Avatar = ({ initials, color = '#888', size = 22, tokens }) => (
  <div style={{
    width: size, height: size, borderRadius: size / 2,
    background: color, color: '#fff',
    fontFamily: tokens?.type.body || 'system-ui',
    fontSize: size * 0.42, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: `inset 0 0 0 0.5px rgba(255,255,255,.15)`,
  }}>{initials}</div>
);

// Tiny inline icon set, stroke 1.5 (Lucide-feel)
const Icon = ({ d, size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  search:   'M21 21l-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  plus:     'M12 5v14 M5 12h14',
  calendar: 'M3 9h18 M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M16 3v4 M8 3v4',
  arrowR:   'M5 12h14 M13 6l6 6-6 6',
  arrowD:   'M12 5v14 M6 13l6 6 6-6',
  filter:   'M22 3H2l8 9.5V21l4-2v-6.5L22 3Z',
  more:     'M5 12h.01 M12 12h.01 M19 12h.01',
  pin:      'M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13Z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  ticket:   'M3 7v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Z M13 5v14',
  music:    'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  check:    'M5 12l5 5L20 7',
  bolt:     'M13 2L3 14h7l-1 8 10-12h-7l1-8Z',
};

// ─── Components catalog artboard ───────────────────────────────────────────
const ComponentsArtboard = ({ tokens, width, height }) => {
  return (
    <div style={{
      width, height, padding: 28, boxSizing: 'border-box',
      background: tokens.n.bg, color: tokens.n.text,
      fontFamily: tokens.type.body,
      display: 'flex', flexDirection: 'column', gap: 22,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <SectionLabel tokens={tokens}>UI components</SectionLabel>
          <div style={{ fontFamily: tokens.type.display, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 4 }}>
            Primitives
          </div>
        </div>
        <Mono tokens={tokens} size={11}>{tokens.density === 'compact' ? 'Compact' : 'Comfortable'} density</Mono>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel tokens={tokens}>Buttons</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Btn tokens={tokens} variant="primary">Confirm hold</Btn>
          <Btn tokens={tokens} variant="secondary">Save draft</Btn>
          <Btn tokens={tokens} variant="ghost">Cancel</Btn>
          <Btn tokens={tokens} variant="danger">Drop date</Btn>
          <Btn tokens={tokens} variant="primary" icon={<Icon d={ICONS.plus} />}>New routing</Btn>
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel tokens={tokens}>Status</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Badge tokens={tokens} tone="confirmed" dot>Confirmed</Badge>
          <Badge tokens={tokens} tone="hold" dot>1st hold</Badge>
          <Badge tokens={tokens} tone="hold">2nd hold</Badge>
          <Badge tokens={tokens} tone="risk" dot>At risk</Badge>
          <Badge tokens={tokens} tone="accent" dot>Routed</Badge>
          <Badge tokens={tokens} tone="neutral">Draft</Badge>
        </div>
      </div>

      {/* Inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel tokens={tokens}>Inputs</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Input tokens={tokens} placeholder="Search venues, artists, cities…" icon={<Icon d={ICONS.search} color={tokens.n.textFaint} />} w={280} />
          <Input tokens={tokens} value="Apr 12 – Apr 28" icon={<Icon d={ICONS.calendar} color={tokens.n.textFaint} />} w={170} />
          <Input tokens={tokens} value="184,250" prefix="$" w={130} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel tokens={tokens}>Segmented</SectionLabel>
        <div style={{
          display: 'inline-flex', padding: 2, gap: 0,
          background: tokens.mode === 'dark' ? '#23222A' : '#EFEDE7',
          borderRadius: 8, alignSelf: 'flex-start',
        }}>
          {['Calendar', 'Pipeline', 'Settlements'].map((t, i) => (
            <div key={t} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 500,
              borderRadius: 6, cursor: 'pointer',
              background: i === 0 ? tokens.n.surface : 'transparent',
              color: i === 0 ? tokens.n.text : tokens.n.textMuted,
              boxShadow: i === 0 ? '0 1px 2px rgba(20,18,14,.06)' : 'none',
            }}>{t}</div>
          ))}
        </div>
      </div>

      {/* Card preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SectionLabel tokens={tokens}>Cards</SectionLabel>
        <div style={{
          padding: 14, background: tokens.n.surface,
          border: `0.5px solid ${tokens.n.line}`, borderRadius: 10,
          boxShadow: tokens.n.shadow,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 8,
            background: tokens.accent[500],
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <Icon d={ICONS.music} size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Tame Impala — North America Spring</div>
            <div style={{ fontSize: 12, color: tokens.n.textMuted, marginTop: 2 }}>
              14 dates · Apr 12 – May 04 · routing draft
            </div>
          </div>
          <Badge tokens={tokens} tone="accent" dot>Routed</Badge>
          <IconBtn tokens={tokens}><Icon d={ICONS.more} size={14} /></IconBtn>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  Btn, Badge, Input, IconBtn, Avatar, Icon, ICONS, ComponentsArtboard,
});
