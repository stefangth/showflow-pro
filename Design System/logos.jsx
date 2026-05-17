/* logos.jsx — 6 mark directions for ShowFlow
   Each accepts {size, color, accent, bg} and renders an SVG that respects
   the current token system. The display name on the artboard surfaces it. */

const Logo01_Route = ({ size = 64, color = 'currentColor' }) => (
  // Three waypoints connected as a tour path — most on-brand for routing
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M14 14 C 14 22, 38 22, 38 32 S 50 50, 50 50" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="14" cy="14" r="6" fill={color} />
    <circle cx="38" cy="32" r="5" fill={color} />
    <circle cx="50" cy="50" r="6" fill={color} />
  </svg>
);

const Logo02_Monogram = ({ size = 64, color = 'currentColor', bg }) => (
  // Rounded chip with a custom S — Linear/Ramp style
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="2" y="2" width="60" height="60" rx="16" fill={color} />
    <path
      d="M44 22 C 42 19, 36 17, 30 17 C 23 17, 19 21, 19 25 C 19 30, 24 31, 31 32 C 38 33, 45 34, 45 40 C 45 45, 40 48, 32 48 C 25 48, 20 46, 18 42"
      stroke={bg || '#fff'} strokeWidth="4" strokeLinecap="round" fill="none"
    />
  </svg>
);

const Logo03_Stage = ({ size = 64, color = 'currentColor' }) => (
  // Proscenium arch with two beams — the "show" half of ShowFlow
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M10 50 V 32 C 10 18, 22 10, 32 10 C 42 10, 54 18, 54 32 V 50 Z"
      stroke={color} strokeWidth="3" strokeLinejoin="round" fill="none" />
    <path d="M22 50 L 32 24 L 42 50" stroke={color} strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.55" />
    <circle cx="32" cy="20" r="2.5" fill={color} />
  </svg>
);

const Logo04_Pulse = ({ size = 64, color = 'currentColor' }) => (
  // Asymmetric meter bars — "flow" of a show
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <rect x="10" y="28" width="6" height="14" rx="1.5" fill={color} opacity="0.55" />
    <rect x="20" y="20" width="6" height="24" rx="1.5" fill={color} opacity="0.75" />
    <rect x="30" y="12" width="6" height="40" rx="1.5" fill={color} />
    <rect x="40" y="22" width="6" height="22" rx="1.5" fill={color} opacity="0.75" />
    <rect x="50" y="32" width="6" height="10" rx="1.5" fill={color} opacity="0.55" />
  </svg>
);

const Logo05_Marquee = ({ size = 64, color = 'currentColor' }) => (
  // Bracketed S — venue marquee / scheduling chip
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M14 10 H 8 V 54 H 14" stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    <path d="M50 10 H 56 V 54 H 50" stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none" />
    <path
      d="M42 22 C 40 19, 35 17, 30 17 C 24 17, 21 21, 21 25 C 21 32, 43 30, 43 39 C 43 44, 38 47, 31 47 C 25 47, 21 45, 19 41"
      stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"
    />
  </svg>
);

const Logo06_Anchor = ({ size = 64, color = 'currentColor' }) => (
  // Hexagonal mark with anchor-line — "hold" for venue ops
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <path d="M32 6 L 54 19 V 45 L 32 58 L 10 45 V 19 Z"
      stroke={color} strokeWidth="3" strokeLinejoin="round" fill="none" />
    <path d="M32 22 V 42" stroke={color} strokeWidth="3" strokeLinecap="round" />
    <path d="M22 36 Q 32 48, 42 36" stroke={color} strokeWidth="3"
      strokeLinecap="round" fill="none" />
    <circle cx="32" cy="20" r="3" fill={color} />
  </svg>
);

const LOGOS = [
  { id: 1, name: '01 · Route',    component: Logo01_Route,    note: 'Waypoints on a tour line' },
  { id: 2, name: '02 · Monogram', component: Logo02_Monogram, note: 'Rounded chip, custom S' },
  { id: 3, name: '03 · Stage',    component: Logo03_Stage,    note: 'Proscenium arch + beam' },
  { id: 4, name: '04 · Meter',    component: Logo04_Pulse,    note: 'Asymmetric bars' },
  { id: 5, name: '05 · Marquee',  component: Logo05_Marquee,  note: 'Bracketed wordmark anchor' },
  { id: 6, name: '06 · Anchor',   component: Logo06_Anchor,   note: 'Hex frame with tieline' },
];

// Wordmark — letterforms remain Space Grotesk-y. Logo mark sits left.
const Wordmark = ({ logoVariant = 1, size = 32, color = 'currentColor', accent, tokens }) => {
  const L = LOGOS[(logoVariant - 1) % LOGOS.length].component;
  const markSize = size * 1.2;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32, color }}>
      <L size={markSize} color={accent || color} bg={tokens?.n?.surface} />
      <span style={{
        fontFamily: tokens?.type?.display || '"Space Grotesk", system-ui, sans-serif',
        fontSize: size * 0.82,
        fontWeight: 600,
        letterSpacing: -size * 0.018,
        lineHeight: 1,
      }}>
        ShowFlow
      </span>
    </div>
  );
};

const AppIcon = ({ logoVariant = 1, size = 88, accent, tokens }) => {
  const L = LOGOS[(logoVariant - 1) % LOGOS.length].component;
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.24,
      background: accent,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 6px 20px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.18)',
      color: '#fff',
    }}>
      {/* Use white-on-accent. Monogram needs special handling so its bg matches. */}
      {logoVariant === 2 ? (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Logo02_Monogram size={size * 0.66} color="#fff" bg={accent} />
        </div>
      ) : (
        <L size={size * 0.62} color="#fff" />
      )}
    </div>
  );
};

Object.assign(window, { LOGOS, Wordmark, AppIcon,
  Logo01_Route, Logo02_Monogram, Logo03_Stage, Logo04_Pulse, Logo05_Marquee, Logo06_Anchor });
