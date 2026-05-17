/* apple.jsx — iOS / macOS 26 (Liquid Glass) adaptation of ShowFlow

   Key HIG 26 moves embodied:
   - Liquid Glass material: blurred translucent surfaces with inset highlights
   - Concentric, capsule shapes (toolbar pills, floating tab bar, search field)
   - Content scrolls under floating chrome — bars don't have opaque divider
   - Larger, rounder hit targets; SF-style hierarchy (large title → content)
   - Dynamic Island reused as a live-activity surface
   - Sidebar floats inside the window with its own corner radius (Tahoe)
*/

// Glass primitives, themed off our token system but rendered with iOS feel
function Glass({ children, dark = false, radius = 24, style = {}, tint }) {
  // Layered: backdrop-filter on the bg, inset highlight ring on top.
  return (
    <div style={{
      position: 'relative', borderRadius: radius,
      ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius,
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        background: tint || (dark ? 'rgba(28,28,30,0.55)' : 'rgba(255,255,255,0.55)'),
      }} />
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius,
        boxShadow: dark
          ? 'inset 0 0.5px 0 rgba(255,255,255,0.18), inset 0 -0.5px 0 rgba(255,255,255,0.05)'
          : 'inset 0 0.5px 0 rgba(255,255,255,0.85), inset 0 -0.5px 0 rgba(255,255,255,0.3), 0 0 0 0.5px rgba(0,0,0,0.06)',
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  );
}

// SF-style symbol shim using our existing icon paths
function SFIcon({ d, size = 17, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// ─── iOS Today screen ────────────────────────────────────────────────────────
function IOSTodayScreen({ tokens, logoVariant, dark = false }) {
  const a = tokens.accent;
  const text = dark ? '#fff' : '#000';
  const sec  = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const cardBg = dark ? 'rgba(44,44,46,0.85)' : '#fff';
  const pageBg = dark
    ? 'linear-gradient(180deg, #0A090F 0%, #15121F 100%)'
    : `linear-gradient(180deg, ${a[100]} 0%, #F2F2F7 38%)`;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: pageBg,
      fontFamily: '"Geist","SF Pro Text",-apple-system,system-ui,sans-serif',
      color: text, position: 'relative',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Top inset + large title */}
      <div style={{ padding: '60px 20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: sec, fontWeight: 600, letterSpacing: 0.2, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            Tue, May 12
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Glass dark={dark} radius={18} style={{ width: 36, height: 36 }}>
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SFIcon d={ICONS.search} size={17} color={text} />
              </div>
            </Glass>
            <Glass dark={dark} radius={18} style={{ width: 36, height: 36 }}>
              <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <Avatar tokens={tokens} initials="MC" color={a[500]} size={26} />
              </div>
            </Glass>
          </div>
        </div>
        <div style={{
          fontFamily: '"Geist","SF Pro Display",-apple-system,system-ui,sans-serif',
          fontSize: 34, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.05,
        }}>
          Good morning,<br />Maya.
        </div>
        <div style={{ fontSize: 15, color: sec, marginTop: 4, fontWeight: 500 }}>
          3 holds expire today · 1 conflict
        </div>
      </div>

      {/* Scrolling content */}
      <div style={{
        padding: '12px 16px 200px', display: 'flex', flexDirection: 'column', gap: 12,
        overflow: 'hidden',
      }}>
        {/* Hold expiring — hero card */}
        <div style={{
          padding: 16, borderRadius: 22,
          background: a[500], color: '#fff',
          boxShadow: `0 8px 24px ${a[500]}33`,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', opacity: .8, whiteSpace: 'nowrap' }}>
              Hold expires 5:00 PM
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: .8, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              06h 41m
            </div>
          </div>
          <div style={{
            fontFamily: '"Geist","SF Pro Display",sans-serif',
            fontSize: 22, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.15,
          }}>
            Mitski · The Anthem<br />
            <span style={{ opacity: .85, fontWeight: 600 }}>Washington, DC · Apr 30</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Glass radius={999} tint="rgba(255,255,255,0.22)" style={{ flex: 1 }}>
              <div style={{ padding: '11px 0', textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: 600 }}>
                Release
              </div>
            </Glass>
            <Glass radius={999} tint="rgba(255,255,255,0.9)" style={{ flex: 1 }}>
              <div style={{ padding: '11px 0', textAlign: 'center', color: a[700], fontSize: 15, fontWeight: 600 }}>
                Confirm
              </div>
            </Glass>
          </div>
        </div>

        {/* Routings list */}
        <div style={{ fontSize: 13, color: sec, fontWeight: 600, padding: '12px 4px 4px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Active routings
        </div>
        <div style={{ background: cardBg, borderRadius: 18, overflow: 'hidden' }}>
          {[
            { artist: 'Tame Impala', sub: '14 dates · NA Spring', c: '#E26A4D', tag: 'Confirmed', tagColor: '#16A34A' },
            { artist: 'Khruangbin',  sub: '22 dates · West loop', c: '#1F8A5B', tag: '2nd hold', tagColor: '#D97706' },
            { artist: 'Big Thief',   sub: '11 dates · Midwest', c: '#0891B2', tag: 'At risk', tagColor: '#DC2626' },
          ].map((r, i, arr) => (
            <div key={r.artist} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px',
              borderBottom: i < arr.length - 1 ? `0.5px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.18)'}` : 'none',
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: r.c,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SFIcon d={ICONS.music} size={17} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }}>{r.artist}</div>
                <div style={{ fontSize: 13, color: sec, marginTop: 1 }}>{r.sub}</div>
              </div>
              <div style={{
                fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
                color: r.tagColor, background: `${r.tagColor}1F`, whiteSpace: 'nowrap',
              }}>{r.tag}</div>
            </div>
          ))}
        </div>

        {/* Up next */}
        <div style={{ fontSize: 13, color: sec, fontWeight: 600, padding: '12px 4px 4px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Up next · today
        </div>
        <div style={{ background: cardBg, borderRadius: 18, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { t: '10:00', what: 'Promoter call · Live Nation NE',  who: 'Devon Park' },
            { t: '11:30', what: 'Settlement review · Toronto',     who: 'Finance' },
            { t: '2:15',  what: 'Routing read-out · Mitski',       who: 'Maya · Ana' },
          ].map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                fontFamily: '"Geist Mono",ui-monospace,monospace',
                fontSize: 13, fontWeight: 600, color: a[500],
                width: 48, fontVariantNumeric: 'tabular-nums',
              }}>{e.t}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{e.what}</div>
                <div style={{ fontSize: 12, color: sec, marginTop: 1 }}>{e.who}</div>
              </div>
              <SFIcon d="M9 6l6 6-6 6" size={14} color={sec} />
            </div>
          ))}
        </div>
      </div>

      {/* Floating Liquid Glass tab bar */}
      <div style={{ position: 'absolute', bottom: 38, left: 16, right: 16, display: 'flex', gap: 10, zIndex: 30 }}>
        <Glass dark={dark} radius={999} style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '12px 8px' }}>
            {[
              { d: ICONS.bolt,     label: 'Today',  active: true },
              { d: ICONS.calendar, label: 'Route'  },
              { d: ICONS.ticket,   label: 'Deals'  },
              { d: ICONS.music,    label: 'Artists' },
            ].map((it) => (
              <div key={it.label} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '4px 12px', borderRadius: 14,
                background: it.active ? (dark ? `${a[800]}99` : a[100]) : 'transparent',
                color: it.active ? (dark ? a[200] : a[700]) : (dark ? 'rgba(255,255,255,.6)' : 'rgba(60,60,67,.6)'),
              }}>
                <SFIcon d={it.d} size={20} color="currentColor" />
                <span style={{ fontSize: 10, fontWeight: 600 }}>{it.label}</span>
              </div>
            ))}
          </div>
        </Glass>
        <Glass dark={dark} radius={999}>
          <div style={{ width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text }}>
            <SFIcon d={ICONS.search} size={22} color={text} />
          </div>
        </Glass>
      </div>
    </div>
  );
}

// ─── iOS Routing detail with map + capsules ──────────────────────────────────
function IOSRoutingScreen({ tokens, logoVariant, dark = false }) {
  const a = tokens.accent;
  const text = dark ? '#fff' : '#000';
  const sec  = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const mapBg = dark
    ? 'linear-gradient(160deg, #0F1320 0%, #1A1029 60%, #0A0610 100%)'
    : 'linear-gradient(160deg, #E8F0FB 0%, #DDE7F4 60%, #EFE6FA 100%)';
  const cardBg = dark ? 'rgba(44,44,46,0.92)' : '#fff';

  // Synthetic tour path SVG — 6 cities across the US
  const cities = [
    { x: 12, y: 58, name: 'San Diego', date: 'Apr 14' },
    { x: 22, y: 42, name: 'LA',        date: 'Apr 16' },
    { x: 35, y: 24, name: 'Denver',    date: 'Apr 19' },
    { x: 55, y: 34, name: 'Chicago',   date: 'Apr 22' },
    { x: 76, y: 30, name: 'NYC',       date: 'Apr 26' },
    { x: 84, y: 50, name: 'DC',        date: 'Apr 30' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      fontFamily: '"Geist","SF Pro Text",-apple-system,sans-serif',
      color: text, overflow: 'hidden',
      background: dark ? '#000' : '#F2F2F7',
    }}>
      {/* Map plane */}
      <div style={{ position: 'absolute', inset: 0, background: mapBg }}>
        {/* faint grid */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.18,
          backgroundImage: `linear-gradient(${sec} 0.5px, transparent 0.5px), linear-gradient(90deg, ${sec} 0.5px, transparent 0.5px)`,
          backgroundSize: '32px 32px' }} />
        {/* tour path */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d={cities.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x} ${c.y}`).join(' ')}
            stroke={a[500]} strokeWidth="0.6" fill="none" strokeLinecap="round" strokeDasharray="1.5 1" />
        </svg>
        {cities.map((c, i) => (
          <div key={c.name} style={{
            position: 'absolute',
            left: `${c.x}%`, top: `${c.y}%`,
            transform: 'translate(-50%, -50%)',
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: 6, background: a[500],
              boxShadow: `0 0 0 3px ${a[500]}33, 0 2px 6px ${a[700]}88`,
            }} />
            {(i === 0 || i === cities.length - 1) && (
              <div style={{
                position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
                fontSize: 10, fontWeight: 600, color: text, whiteSpace: 'nowrap',
                padding: '2px 6px', borderRadius: 6,
                background: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(10px)',
              }}>{c.name}</div>
            )}
          </div>
        ))}
      </div>

      {/* Top floating header */}
      <div style={{ position: 'absolute', top: 60, left: 16, right: 16, display: 'flex', gap: 8, zIndex: 20 }}>
        <Glass dark={dark} radius={999}>
          <div style={{ padding: '8px 12px 8px 8px', display: 'flex', alignItems: 'center', gap: 6, color: text }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SFIcon d="M15 6l-6 6 6 6" size={14} color={text} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Tame Impala</span>
          </div>
        </Glass>
        <div style={{ flex: 1 }} />
        <Glass dark={dark} radius={999}>
          <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text }}>
            <SFIcon d={ICONS.filter} size={16} color={text} />
          </div>
        </Glass>
        <Glass dark={dark} radius={999}>
          <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: text }}>
            <SFIcon d={ICONS.more} size={16} color={text} />
          </div>
        </Glass>
      </div>

      {/* Bottom sheet — concentric */}
      <Glass dark={dark} radius={32}
        style={{ position: 'absolute', left: 12, right: 12, bottom: 36, zIndex: 25 }}>
        <div style={{ padding: '14px 18px 22px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: sec, margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: '"Geist","SF Pro Display",sans-serif',
                fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>
                NA Spring · 14 dates
              </div>
              <div style={{ fontSize: 13, color: sec, marginTop: 1 }}>Apr 12 – May 04 · 11,420 mi</div>
            </div>
            <div style={{
              fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
              color: '#fff', background: a[500],
            }}>86%</div>
          </div>

          {/* Inline stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { k: 'Confirmed', v: '12 / 14' },
              { k: 'Net (proj)', v: '$2.41M' },
              { k: 'Drive time', v: '38h' },
            ].map((s) => (
              <div key={s.k} style={{
                padding: '8px 10px', borderRadius: 12,
                background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: 10, color: sec, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{s.k}</div>
                <div style={{ fontFamily: '"Geist","SF Pro Display",sans-serif',
                  fontSize: 17, fontWeight: 700, letterSpacing: -0.3, marginTop: 1 }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>

          {/* Stops list (first 3) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { c: 'Forest Hills · NY',    d: 'Apr 26',  s: 'confirmed' },
              { c: 'Anthem · DC',          d: 'Apr 30',  s: 'hold' },
              { c: 'Eaglebank · Fairfax',  d: 'May 02',  s: 'confirmed' },
            ].map((stop, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: 4,
                  background: stop.s === 'confirmed' ? '#16A34A' : '#D97706',
                }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{stop.c}</span>
                <span style={{ fontFamily: '"Geist Mono",ui-monospace,monospace',
                  fontSize: 12, color: sec, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{stop.d}</span>
              </div>
            ))}
          </div>
        </div>
      </Glass>

      {/* Dynamic Island content (overlapping the device's island) */}
      <div style={{
        position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
        zIndex: 51, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 14px 0 14px', height: 37, borderRadius: 24,
        background: '#000', color: '#fff', minWidth: 126, whiteSpace: 'nowrap',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: a[400], flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Routing live</span>
        <span style={{ fontFamily: '"Geist Mono",ui-monospace,monospace', fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
          06:41
        </span>
      </div>
    </div>
  );
}

// ─── macOS Tahoe window ──────────────────────────────────────────────────────
function MacOSDashboard({ tokens, logoVariant, width = 1200, height = 760 }) {
  const a = tokens.accent;
  const n = tokens.n;
  const sec = 'rgba(60,60,67,0.6)';

  // Glass material for the desktop background
  const desktopBg = `linear-gradient(135deg, ${a[200]} 0%, ${a[400]} 50%, ${a[700]} 100%)`;

  return (
    <div style={{
      width, height, background: desktopBg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Geist","SF Pro Text",-apple-system,sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Wallpaper grain / glow */}
      <div style={{ position: 'absolute', inset: 0,
        background: `radial-gradient(800px 500px at 20% 80%, ${a[100]}55, transparent), radial-gradient(900px 600px at 90% 10%, #fff3, transparent)` }} />

      {/* Window */}
      <div style={{
        width: width - 80, height: height - 80,
        borderRadius: 18, overflow: 'hidden',
        background: 'rgba(244,243,238,0.9)',
        boxShadow: '0 0 0 0.5px rgba(0,0,0,0.18), 0 30px 80px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(40px) saturate(180%)',
        display: 'grid', gridTemplateColumns: '230px 1fr',
        position: 'relative',
      }}>
        {/* Sidebar (concentric inset) */}
        <aside style={{
          padding: 8, display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 8, borderRadius: 12,
            background: 'rgba(255,255,255,0.55)',
            backdropFilter: 'blur(40px) saturate(200%)',
            border: '0.5px solid rgba(255,255,255,0.6)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
          }} />
          <div style={{ position: 'relative', zIndex: 1, padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Traffic lights + brand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <MacTrafficLights />
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ padding: '4px 6px' }}>
              <Wordmark logoVariant={logoVariant} size={18} color={n.text} accent={a[500]} tokens={tokens} />
            </div>

            {/* Search field, capsule */}
            <div style={{
              height: 28, borderRadius: 14,
              background: 'rgba(0,0,0,0.05)',
              border: '0.5px solid rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
              fontSize: 12, color: sec,
            }}>
              <SFIcon d={ICONS.search} size={12} color={sec} />
              <span style={{ flex: 1 }}>Search</span>
              <span style={{ fontFamily: '"Geist Mono",ui-monospace,monospace', fontSize: 10, opacity: .6 }}>⌘K</span>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4 }}>
              {[
                { d: ICONS.bolt, l: 'Today', active: true, count: null },
                { d: ICONS.calendar, l: 'Routing', count: 4 },
                { d: ICONS.ticket, l: 'Pipeline', count: 28 },
                { d: ICONS.music, l: 'Artists' },
                { d: ICONS.pin, l: 'Venues' },
              ].map((it) => (
                <div key={it.l} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 9px', borderRadius: 7,
                  background: it.active ? a[500] : 'transparent',
                  color: it.active ? '#fff' : 'rgba(0,0,0,0.78)',
                  fontSize: 13, fontWeight: it.active ? 600 : 500,
                }}>
                  <SFIcon d={it.d} size={13} color="currentColor" />
                  <span style={{ flex: 1 }}>{it.l}</span>
                  {it.count && (
                    <span style={{ fontFamily: '"Geist Mono",ui-monospace,monospace',
                      fontSize: 11, opacity: it.active ? .85 : .55, fontVariantNumeric: 'tabular-nums' }}>
                      {it.count}
                    </span>
                  )}
                </div>
              ))}
            </nav>

            <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.08)', margin: '4px 6px' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ padding: '4px 9px', fontSize: 10, fontWeight: 700, color: sec, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Pinned
              </div>
              {[
                { c: '#E26A4D', n: 'Tame Impala · NA Spring' },
                { c: '#7A5AE0', n: 'Mitski · East Coast' },
                { c: '#1F8A5B', n: 'Khruangbin · West loop' },
              ].map((p) => (
                <div key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 9px', borderRadius: 7, fontSize: 12, color: 'rgba(0,0,0,0.7)' }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: p.c }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.n}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Content */}
        <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
          {/* Toolbar — glass pill cluster */}
          <div style={{
            height: 44, padding: '8px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: '0.5px solid rgba(0,0,0,0.06)',
          }}>
            <Glass radius={14}>
              <div style={{ display: 'flex', padding: 3, gap: 1 }}>
                {['Calendar', 'Pipeline', 'Settlements'].map((t, i) => (
                  <div key={t} style={{
                    padding: '4px 12px', fontSize: 12, fontWeight: 500,
                    borderRadius: 10,
                    background: i === 0 ? '#fff' : 'transparent',
                    color: i === 0 ? '#000' : 'rgba(0,0,0,0.7)',
                    boxShadow: i === 0 ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
                  }}>{t}</div>
                ))}
              </div>
            </Glass>

            <div style={{ flex: 1 }} />

            <Glass radius={999}>
              <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#D97706', fontWeight: 600, whiteSpace: 'nowrap' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: '#D97706', flexShrink: 0 }} />
                3 holds expire today
              </div>
            </Glass>
            <Glass radius={999}>
              <div style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <SFIcon d={ICONS.filter} size={14} color="#000" />
              </div>
            </Glass>
            <div style={{
              height: 28, padding: '0 12px', borderRadius: 999,
              background: a[500], color: '#fff', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              boxShadow: `0 1px 2px ${a[800]}44`,
            }}>
              <SFIcon d={ICONS.plus} size={12} color="#fff" />
              New date
            </div>
          </div>

          {/* Headline */}
          <div style={{ padding: '20px 24px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, color: sec, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Tuesday, May 12
              </div>
              <div style={{
                fontFamily: '"Geist","SF Pro Display",sans-serif',
                fontSize: 28, fontWeight: 700, letterSpacing: -0.6, marginTop: 2,
              }}>
                Good morning, Maya.
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div style={{ padding: '0 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { k: 'Confirmed Q2', v: '$2.41M', d: '+12.4%', up: true },
              { k: 'Active holds', v: '46', d: '−3 today', up: false },
              { k: 'Avg net / show', v: '$184k', d: '+8.1%', up: true },
              { k: 'Routing drives', v: '11h 22m', d: '2 conflicts', flat: true },
            ].map((s) => (
              <div key={s.k} style={{
                padding: 14, borderRadius: 14,
                background: 'rgba(255,255,255,0.85)',
                boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.8), 0 0 0 0.5px rgba(0,0,0,0.06)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontSize: 10, color: sec, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{s.k}</div>
                  <div style={{ fontFamily: '"Geist Mono",ui-monospace,monospace', fontSize: 10, fontVariantNumeric: 'tabular-nums',
                    color: s.flat ? sec : s.up ? '#157F3D' : '#B91C1C' }}>{s.d}</div>
                </div>
                <div style={{ fontFamily: '"Geist","SF Pro Display",sans-serif',
                  fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginTop: 4, whiteSpace: 'nowrap' }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Routing timeline + activity */}
          <div style={{ padding: '14px 24px 24px', display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 12, minHeight: 0 }}>
            <div style={{
              padding: '14px 16px', borderRadius: 14,
              background: 'rgba(255,255,255,0.85)',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.8), 0 0 0 0.5px rgba(0,0,0,0.06)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Active routings</div>
                <div style={{ fontFamily: '"Geist Mono",ui-monospace,monospace', fontSize: 11, color: sec }}>16 weeks · Apr → Jul</div>
              </div>
              {[
                { ag: 'MR', c: '#E26A4D', a: 'Tame Impala',   s: 1, e: 4, span: 'Apr 12 – May 04', status: 'confirmed' },
                { ag: 'JA', c: '#7A5AE0', a: 'Mitski',         s: 3, e: 5, span: 'May 02 – May 14', status: 'hold' },
                { ag: 'NL', c: '#1F8A5B', a: 'Khruangbin',     s: 7, e: 11, span: 'Jun 06 – Jul 08', status: 'hold' },
                { ag: 'EP', c: '#D97706', a: 'Caroline P.',    s: 2, e: 4, span: 'Apr 22 – Apr 30', status: 'confirmed' },
                { ag: 'SC', c: '#0891B2', a: 'Big Thief',      s: 9, e: 12, span: 'Jul 12 – Jul 28', status: 'risk' },
              ].map((t, i, arr) => (
                <div key={t.a} style={{
                  display: 'grid', gridTemplateColumns: '170px 1fr', alignItems: 'center', gap: 12,
                  padding: '7px 0', borderTop: i === 0 ? 'none' : '0.5px solid rgba(0,0,0,0.06)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Avatar tokens={tokens} initials={t.ag} color={t.c} size={20} />
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.a}</div>
                  </div>
                  <div style={{ position: 'relative', height: 20, background: 'rgba(0,0,0,0.05)', borderRadius: 999 }}>
                    <div style={{
                      position: 'absolute', top: 2, bottom: 2,
                      left: `${(t.s / 16) * 100}%`,
                      width: `${((t.e - t.s) / 16) * 100}%`,
                      background: t.status === 'confirmed' ? a[500] : t.status === 'risk' ? '#DC2626' : a[300],
                      borderRadius: 999,
                      display: 'flex', alignItems: 'center', paddingLeft: 8,
                      boxShadow: t.status === 'confirmed' ? `0 1px 2px ${a[800]}44` : 'none',
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.span}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              padding: '14px 16px', borderRadius: 14,
              background: 'rgba(255,255,255,0.85)',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.8), 0 0 0 0.5px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Activity</div>
              {[
                { who: 'Maya Chen',     c: '#7A5AE0', what: 'confirmed 2nd hold on', tgt: 'Mitski · The Anthem', tag: 'Apr 30', t: '2m' },
                { who: 'Devon Park',    c: '#E26A4D', what: 'attached settlement to', tgt: 'Tame Impala · Toronto', tag: '$184,250', t: '11m' },
                { who: 'Ana Ruiz',      c: '#0891B2', what: 'requested routing for',   tgt: 'Khruangbin · West coast', tag: '8 days', t: '38m' },
                { who: 'Routing bot',   c: '#888',    what: 'flagged drive conflict',  tgt: 'Big Thief · CLE → MAD', tag: '11h drive', t: '1h' },
              ].map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, padding: '7px 0',
                  borderTop: i === 0 ? 'none' : '0.5px solid rgba(0,0,0,0.06)' }}>
                  <Avatar tokens={tokens} initials={f.who.split(' ').map(s => s[0]).join('').slice(0,2)} color={f.c} size={20} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{f.who}</span>
                    <span style={{ color: sec }}> {f.what} </span>
                    <span style={{ fontWeight: 500 }}>{f.tgt}</span>
                    <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999,
                        color: a[700], background: a[100], fontWeight: 600 }}>{f.tag}</span>
                      <span style={{ fontSize: 10, color: sec }}>{f.t} ago</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── HIG notes card ──────────────────────────────────────────────────────────
function HIGNotes({ tokens, width, height }) {
  const a = tokens.accent;
  const n = tokens.n;
  const notes = [
    { k: 'Material',    v: 'Liquid Glass — translucent surfaces with backdrop-filter blur (28px) + saturate(180%) + inset highlight ring.' },
    { k: 'Shape',       v: 'Concentric capsules and continuous corners. Floating tab bar (r:999), bottom sheets (r:32), windows (r:18), KPI cards (r:14).' },
    { k: 'Hierarchy',   v: 'SF Pro Display style (Geist Display stand-in) for titles, SF Pro Text for body, SF Mono / Geist Mono for tabular figures.' },
    { k: 'Color',       v: `Accent stays as ${a.name.toLowerCase()}; system grays from iOS's secondaryLabel (rgba 60 60 67 / 0.6). Vibrant tinted glass on light backgrounds, deep elevated dark on Pro Max.` },
    { k: 'Chrome',      v: 'Bars float over content with no opaque divider — scroll attaches to the safe-area inset.' },
    { k: 'Live data',   v: 'Dynamic Island repurposed as live-activity surface for active routings, hold timers, and travel-status pings.' },
    { k: 'Targets',     v: '44pt minimum hit target; primary actions stretched across the screen width on iOS.' },
    { k: 'Sidebar',     v: 'macOS Tahoe: sidebar floats inside the window with its own corner radius; traffic lights live inside the glass panel.' },
  ];
  return (
    <div style={{
      width, height, padding: 28, boxSizing: 'border-box',
      background: n.bg, color: n.text, fontFamily: tokens.type.body,
      display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden',
    }}>
      <div>
        <SectionLabel tokens={tokens}>HIG · iOS 26 / macOS Tahoe</SectionLabel>
        <div style={{ fontFamily: tokens.type.display, fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 4 }}>
          Adaptation notes
        </div>
        <div style={{ fontSize: 13, color: n.textMuted, marginTop: 6, maxWidth: 540, lineHeight: 1.5 }}>
          How the chosen system — Stage mark, violet accent, Geist — translates into Apple's Liquid Glass design language across iPhone and Mac.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        {notes.map((n2, i) => (
          <div key={n2.k} style={{
            display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16,
            padding: '10px 0', alignItems: 'baseline',
            borderTop: i === 0 ? 'none' : `0.5px solid ${n.line}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: a[600], letterSpacing: 0.2, textTransform: 'uppercase' }}>
              {n2.k}
            </div>
            <div style={{ fontSize: 13, color: n.text, lineHeight: 1.45 }}>{n2.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { IOSTodayScreen, IOSRoutingScreen, MacOSDashboard, HIGNotes, Glass, SFIcon });
