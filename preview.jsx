/* preview.jsx — In-context demo: ShowFlow dashboard applied with full brand */

const TOURS = [
  { artist: 'Tame Impala',        agent: 'MR', color: '#E26A4D', dates: 14, span: 'Apr 12 – May 04', progress: 86, status: 'confirmed', city: 'Forest Hills · NY' },
  { artist: 'Mitski',             agent: 'JA', color: '#7A5AE0', dates: 9,  span: 'May 02 – May 14',  progress: 64, status: 'hold',     city: 'Greek Theatre · LA' },
  { artist: 'Khruangbin',         agent: 'NL', color: '#1F8A5B', dates: 22, span: 'Jun 06 – Jul 08',  progress: 41, status: 'hold',     city: 'Red Rocks · Morrison' },
  { artist: 'Caroline Polachek',  agent: 'EP', color: '#D97706', dates: 7,  span: 'Apr 22 – Apr 30',  progress: 92, status: 'confirmed', city: 'Brooklyn Steel' },
  { artist: 'Big Thief',          agent: 'SC', color: '#0891B2', dates: 11, span: 'Jul 12 – Jul 28',  progress: 12, status: 'risk',     city: 'Ryman · Nashville' },
];

const FEED = [
  { who: 'Maya Chen',   color: '#7A5AE0', t: '2m', what: 'confirmed 2nd hold on', target: 'Mitski · The Anthem', tag: 'Apr 30' },
  { who: 'Devon Park',  color: '#E26A4D', t: '11m', what: 'attached settlement to', target: 'Tame Impala · Toronto Velodrome', tag: '$184,250' },
  { who: 'Ana Ruiz',    color: '#0891B2', t: '38m', what: 'requested a routing for', target: 'Khruangbin — West coast loop', tag: '8 days' },
  { who: 'Routing bot', color: '#888', t: '1h', what: 'flagged drive conflict', target: 'Big Thief · Cleveland → Madison', tag: '11h drive' },
  { who: 'Jules Adesina', color: '#1F8A5B', t: '2h', what: 'released 1st hold on', target: 'Caroline Polachek · Brooklyn Steel', tag: 'Apr 22' },
];

const DashboardPreview = ({ tokens, logoVariant, width = 1240, height = 800 }) => {
  const a = tokens.accent;
  const n = tokens.n;
  const navItems = [
    { label: 'Today', icon: ICONS.bolt, active: true },
    { label: 'Routing', icon: ICONS.calendar, count: 4 },
    { label: 'Pipeline', icon: ICONS.ticket, count: 28 },
    { label: 'Artists', icon: ICONS.music },
    { label: 'Venues', icon: ICONS.pin },
  ];

  // Tiny chart bars for KPI cards
  const Bars = ({ data, color }) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 26, width: 70 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${v}%`, background: color, opacity: 0.25 + 0.75 * (i / data.length),
          borderRadius: 1,
        }} />
      ))}
    </div>
  );

  const StatCard = ({ label, value, delta, bars, tone }) => (
    <div style={{
      padding: 16, background: n.surface, borderRadius: 10,
      border: `0.5px solid ${n.line}`,
      display: 'flex', flexDirection: 'column', gap: 8,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 11, color: n.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <span style={{ fontSize: 11, fontFamily: tokens.type.mono, fontVariantNumeric: 'tabular-nums',
          color: tone === 'down' ? '#B91C1C' : tone === 'flat' ? n.textFaint : '#157F3D' }}>
          {delta}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: tokens.type.display, fontSize: 28, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1, whiteSpace: 'nowrap' }}>{value}</div>
        <Bars data={bars} color={a[500]} />
      </div>
    </div>
  );

  // Timeline: tours as horizontal bars across a 12-week window
  const TimelineRow = ({ t, idx, weeks }) => {
    // Synthetic start/end positions per artist
    const start = [1, 3, 7, 2, 9][idx % 5];
    const end = start + [3, 2, 4, 2, 3][idx % 5];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', alignItems: 'center', gap: 12,
        padding: '8px 0', borderTop: idx === 0 ? 'none' : `0.5px solid ${n.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Avatar tokens={tokens} initials={t.agent} color={t.color} size={22} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</div>
            <div style={{ fontSize: 11, color: n.textFaint }}>{t.dates} dates</div>
          </div>
        </div>
        <div style={{ position: 'relative', height: 22, background: tokens.mode === 'dark' ? '#0A0910' : '#EFEDE7', borderRadius: 4 }}>
          {/* Week ticks */}
          {Array.from({ length: weeks - 1 }, (_, i) => (
            <div key={i} style={{ position: 'absolute', top: 0, bottom: 0,
              left: `${((i + 1) / weeks) * 100}%`,
              width: 0.5, background: n.line }} />
          ))}
          <div style={{
            position: 'absolute', top: 2, bottom: 2,
            left: `${(start / weeks) * 100}%`,
            width: `${((end - start) / weeks) * 100}%`,
            background: t.status === 'confirmed' ? a[500] : t.status === 'risk' ? '#DC2626' : a[300],
            borderRadius: 3,
            display: 'flex', alignItems: 'center', paddingLeft: 8,
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.span}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      width, height, fontFamily: tokens.type.body, color: n.text, background: n.bg,
      display: 'grid', gridTemplateColumns: '220px 1fr', overflow: 'hidden',
    }}>
      {/* Sidebar */}
      <aside style={{
        background: tokens.mode === 'dark' ? '#0A090C' : '#F1EEE6',
        borderRight: `0.5px solid ${n.line}`,
        padding: '18px 12px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ padding: '4px 6px 8px' }}>
          <Wordmark logoVariant={logoVariant} size={20} color={n.text} accent={a[500]} tokens={tokens} />
        </div>

        {/* Workspace switcher */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 9px', borderRadius: 8,
          background: n.surface, border: `0.5px solid ${n.line}`,
        }}>
          <div style={{ width: 18, height: 18, borderRadius: 4, background: '#1F2937',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>WM</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Wasserman</div>
            <div style={{ fontSize: 10, color: n.textFaint }}>Music · Touring</div>
          </div>
          <Icon d={ICONS.arrowD} size={12} color={n.textFaint} />
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {navItems.map((it) => (
            <div key={it.label} style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: '7px 9px', borderRadius: 7,
              background: it.active ? (tokens.mode === 'dark' ? `${a[800]}55` : a[100]) : 'transparent',
              color: it.active ? (tokens.mode === 'dark' ? a[200] : a[700]) : n.textMuted,
              fontSize: 13, fontWeight: it.active ? 600 : 500,
              cursor: 'pointer',
            }}>
              <Icon d={it.icon} size={14} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.count && (
                <span style={{
                  fontSize: 10, fontFamily: tokens.type.mono,
                  fontVariantNumeric: 'tabular-nums',
                  color: it.active ? 'inherit' : n.textFaint,
                  padding: '1px 5px', borderRadius: 4,
                  background: it.active ? 'transparent' : (tokens.mode === 'dark' ? '#1F1E26' : '#E8E5DD'),
                }}>{it.count}</span>
              )}
            </div>
          ))}
        </nav>

        <div style={{ borderTop: `0.5px solid ${n.line}`, margin: '4px 6px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <SectionLabel tokens={tokens}><div style={{ padding: '4px 9px' }}>Pinned routings</div></SectionLabel>
          {[
            { c: '#E26A4D', n: 'Tame Impala · NA Spring' },
            { c: '#7A5AE0', n: 'Mitski · East Coast' },
            { c: '#1F8A5B', n: 'Khruangbin · West loop' },
          ].map((p) => (
            <div key={p.n} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 9px', borderRadius: 7,
              fontSize: 12, color: n.textMuted, cursor: 'pointer',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: p.c }} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.n}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px', borderRadius: 8 }}>
          <Avatar tokens={tokens} initials="MC" color="#7A5AE0" size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Maya Chen</div>
            <div style={{ fontSize: 10, color: n.textFaint }}>Senior agent</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <header style={{
          height: 52, padding: '0 24px',
          borderBottom: `0.5px solid ${n.line}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <Input tokens={tokens} placeholder="⌘K  ·  Find a date, venue, artist…" icon={<Icon d={ICONS.search} color={n.textFaint} />} w={360} />
          </div>
          <Badge tokens={tokens} tone="hold" dot>3 holds expire today</Badge>
          <IconBtn tokens={tokens}><Icon d={ICONS.calendar} size={14} /></IconBtn>
          <IconBtn tokens={tokens}><Icon d={ICONS.filter} size={14} /></IconBtn>
          <Btn tokens={tokens} variant="primary" size="s" icon={<Icon d={ICONS.plus} />}>New date</Btn>
        </header>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' }}>
          {/* Headline */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: n.textFaint, fontWeight: 500 }}>Tuesday, May 12</div>
              <div style={{ fontFamily: tokens.type.display, fontSize: 26, fontWeight: 600, letterSpacing: -0.5, marginTop: 2 }}>
                Good morning, Maya.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['Calendar', 'Pipeline', 'Settlements'].map((t, i) => (
                <div key={t} style={{
                  padding: '6px 12px', fontSize: 12, fontWeight: 500, borderRadius: 7,
                  border: `0.5px solid ${i === 0 ? n.lineStrong : 'transparent'}`,
                  background: i === 0 ? n.surface : 'transparent',
                  color: i === 0 ? n.text : n.textMuted,
                  cursor: 'pointer',
                }}>{t}</div>
              ))}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard label="Confirmed (Q2)" value="$2.41M" delta="+12.4%" bars={[30,42,28,55,48,72,58,82]} tone="up" />
            <StatCard label="Active holds" value="46" delta="−3 today" bars={[60,55,62,50,58,42,46,46]} tone="down" />
            <StatCard label="Avg net per show" value="$184k" delta="+8.1%" bars={[40,48,52,58,62,66,72,78]} tone="up" />
            <StatCard label="Routing drives" value="11h 22m" delta="2 conflicts" bars={[30,38,42,40,44,52,48,58]} tone="flat" />
          </div>

          {/* Two-column body */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, minHeight: 0 }}>
            {/* Routing timeline */}
            <div style={{
              background: n.surface, border: `0.5px solid ${n.line}`, borderRadius: 10,
              padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
              boxShadow: n.shadow,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Active routings</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: n.textFaint }}>
                  {['Apr', 'May', 'Jun', 'Jul'].map((m) => (
                    <span key={m} style={{ width: 56, textAlign: 'left' }}>{m}</span>
                  ))}
                </div>
              </div>
              {TOURS.map((t, i) => <TimelineRow key={t.artist} t={t} idx={i} weeks={16} />)}
            </div>

            {/* Activity feed */}
            <div style={{
              background: n.surface, border: `0.5px solid ${n.line}`, borderRadius: 10,
              padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
              boxShadow: n.shadow, minHeight: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Activity</div>
                <Mono tokens={tokens} size={10}>last 4h</Mono>
              </div>
              {FEED.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '8px 0',
                  borderTop: i === 0 ? 'none' : `0.5px solid ${n.line}`,
                }}>
                  <Avatar tokens={tokens} initials={f.who.split(' ').map(s => s[0]).join('').slice(0,2)} color={f.color} size={22} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{f.who}</span>
                    <span style={{ color: n.textMuted }}> {f.what} </span>
                    <span style={{ fontWeight: 500 }}>{f.target}</span>
                    <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
                      <Badge tokens={tokens} tone="accent">{f.tag}</Badge>
                      <span style={{ fontSize: 10, color: n.textFaint }}>{f.t} ago</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

Object.assign(window, { DashboardPreview });
