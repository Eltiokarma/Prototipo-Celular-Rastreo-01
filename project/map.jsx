// Mapa GPS — ruta abstracta estilo "night map"
// No usa tiles reales (offline-first); dibuja una red de calles procedural
// con la ruta resaltada y todas las unidades en vivo.

const MAP_COLORS = {
  bg: '#0a0e12',
  street: '#1e242c',
  streetMain: '#2a3340',
  route: '#FFFFFF',
  routeGlow: 'rgba(255,255,255,0.25)',
  label: '#6b7785',
  labelMain: '#aab4c0',
  you: '#FFFFFF',
  green: '#00E676',
  yellow: '#FFD600',
  red: '#FF1744',
  other: '#4a5362',
};

// Ruta procedural: polyline que cruza el canvas
const ROUTE_POINTS = [
  { x: 30,  y: 420 },
  { x: 85,  y: 360 },
  { x: 140, y: 340 },
  { x: 200, y: 310 },
  { x: 250, y: 260 },
  { x: 280, y: 210 },
  { x: 300, y: 160 },
  { x: 320, y: 110 },
  { x: 340, y: 60  },
];

// Convierte progreso 0-1 a posición en la ruta
function posOnRoute(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (ROUTE_POINTS.length - 1);
  const i = Math.floor(seg);
  const frac = seg - i;
  const a = ROUTE_POINTS[i];
  const b = ROUTE_POINTS[Math.min(i + 1, ROUTE_POINTS.length - 1)];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}

// ─────────────────────────────────────────────────────────────
// Calles de fondo (abstractas) + ruta
// ─────────────────────────────────────────────────────────────
function MapBackground() {
  // Calles secundarias: líneas con ángulos irregulares
  const sideStreets = [
    "M 0 100 L 380 140",
    "M 0 180 L 380 220",
    "M 0 260 L 380 300",
    "M 0 350 L 380 390",
    "M 0 440 L 380 480",
    "M 0 520 L 380 550",

    "M 60 0 L 80 600",
    "M 140 0 L 165 600",
    "M 220 0 L 250 600",
    "M 300 0 L 330 600",
  ];

  const mains = [
    "M 0 390 Q 100 370, 200 330 T 380 260",
    "M 40 0 L 120 200 L 200 400 L 280 600",
  ];

  // Ruta principal (poly)
  const routeD = ROUTE_POINTS.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');

  return (
    <svg viewBox="0 0 380 600" preserveAspectRatio="xMidYMid slice" overflow="hidden"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* textura sutil */}
      <defs>
        <pattern id="mapGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="0.5" fill="#151b22" />
        </pattern>
        <filter id="routeGlow">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="380" height="600" fill="url(#mapGrid)" />

      {/* calles laterales */}
      {sideStreets.map((d, i) => (
        <path key={i} d={d} stroke={MAP_COLORS.street} strokeWidth="2" fill="none" />
      ))}
      {/* arteriales */}
      {mains.map((d, i) => (
        <path key={i} d={d} stroke={MAP_COLORS.streetMain} strokeWidth="5" fill="none" strokeLinecap="round" />
      ))}

      {/* ruta resaltada — glow */}
      <path d={routeD}
        stroke={MAP_COLORS.routeGlow} strokeWidth="14"
        fill="none" strokeLinecap="round" strokeLinejoin="round"
        filter="url(#routeGlow)" />
      {/* ruta resaltada — línea */}
      <path d={routeD}
        stroke={MAP_COLORS.route} strokeWidth="4"
        fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* ruta — dashes de dirección */}
      <path d={routeD}
        stroke="#000" strokeWidth="2"
        strokeDasharray="1 10"
        fill="none" strokeLinecap="round" strokeLinejoin="round"
        opacity="0.8" />

      {/* etiquetas de calles de Juliaca (placeholder plausible) */}
      <g style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 9, fill: MAP_COLORS.label }}>
        <text x="14" y="145" opacity="0.7">JR. LAMBAYEQUE</text>
        <text x="14" y="225" opacity="0.7">AV. TUMBES</text>
        <text x="14" y="305" opacity="0.7">AV. CIRCUNVALACIÓN</text>
      </g>
      <g style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 10, fill: MAP_COLORS.labelMain, fontWeight: 700 }}>
        <text x="160" y="38" letterSpacing="1">SALIDA HUANCANÉ →</text>
        <text x="14" y="575" letterSpacing="1">← TERMINAL SUR</text>
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Pin de unidad
// ─────────────────────────────────────────────────────────────
function UnitPin({ x, y, color, label, size = 16, pulse = false, you = false, gap }) {
  return (
    <div style={{
      position: 'absolute',
      left: `${(x / 380) * 100}%`,
      top: `${(y / 600) * 100}%`,
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
    }}>
      {pulse && (
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: size * 2.6, height: size * 2.6,
          borderRadius: '50%',
          background: color,
          opacity: 0.25,
          transform: 'translate(-50%, -50%)',
          animation: 'combiPulse 2s ease-out infinite',
        }} />
      )}
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        background: color,
        border: you ? '3px solid #000' : '2px solid #000',
        boxShadow: `0 0 ${size}px ${color}`,
        position: 'relative',
      }} />
      {gap && (
        <div style={{
          position: 'absolute',
          left: '50%', top: `calc(100% + 4px)`,
          transform: 'translateX(-50%)',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10, fontWeight: 700,
          color: color,
          background: 'rgba(0,0,0,0.7)',
          padding: '1px 5px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}>{gap}</div>
      )}
      {label && !gap && (
        <div style={{
          position: 'absolute',
          left: '50%', top: `calc(100% + 3px)`,
          transform: 'translateX(-50%)',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 8,
          color: '#6b7785',
          whiteSpace: 'nowrap',
        }}>{label}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Mapa completo
// ─────────────────────────────────────────────────────────────
function GpsMap({ frontTime, backTime, status, expanded }) {
  // tu posición: centro de la ruta
  const youT = 0.5;
  const you = posOnRoute(youT);

  // unidad adelante: proporcional al tiempo
  const frontT = youT + 0.12 * (parseMin(frontTime) / 2);
  const front = posOnRoute(frontT);

  // unidad atrás
  const backT = youT - 0.12 * (parseMin(backTime) / 2);
  const back = posOnRoute(backT);

  // otras unidades en ruta
  const others = [
    { t: 0.08, off: -6 },
    { t: 0.22, off: 8 },
    { t: 0.88, off: -4 },
    { t: 0.72, off: 10 },
  ].map(o => {
    const p = posOnRoute(o.t);
    return { x: p.x + o.off, y: p.y + o.off };
  });

  const statusColor =
    status === 'green' ? MAP_COLORS.green :
    status === 'yellow' ? MAP_COLORS.yellow :
    MAP_COLORS.red;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: MAP_COLORS.bg,
      overflow: 'hidden',
    }}>
      <MapBackground />

      {/* otras unidades (atenuadas) */}
      {others.map((o, i) => (
        <UnitPin key={i} x={o.x} y={o.y} color={MAP_COLORS.other} size={8} />
      ))}

      {/* unidad atrás */}
      <UnitPin x={back.x} y={back.y} color={statusColor} size={14} gap={backTime} />

      {/* unidad adelante */}
      <UnitPin x={front.x} y={front.y} color={statusColor} size={14} gap={frontTime} />

      {/* tú */}
      <UnitPin x={you.x} y={you.y} color={MAP_COLORS.you} size={18} pulse={true} you={true} label="TÚ" />

      {/* overlay con info cuando está expandido */}
      {expanded && (
        <div style={{
          position: 'absolute', top: 16, left: 16, right: 16,
          display: 'flex', gap: 10, justifyContent: 'space-between',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 10, color: '#aab4c0',
            border: `1px solid ${MAP_COLORS.street}`,
          }}>
            <div style={{ color: '#6b7785', fontSize: 8, letterSpacing: 1.5 }}>RUTA</div>
            <div style={{ fontWeight: 700, color: '#fff' }}>R-14 · TERMINAL</div>
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 10, color: '#aab4c0',
            border: `1px solid ${MAP_COLORS.street}`,
            textAlign: 'right',
          }}>
            <div style={{ color: '#6b7785', fontSize: 8, letterSpacing: 1.5 }}>EN RUTA</div>
            <div style={{ fontWeight: 700, color: '#fff' }}>{others.length + 3} unid.</div>
          </div>
        </div>
      )}
    </div>
  );
}

window.GpsMap = GpsMap;
