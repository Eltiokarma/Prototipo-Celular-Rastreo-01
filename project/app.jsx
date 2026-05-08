// Pantalla principal — Combi Juliaca
// Layout: carrusel horizontal de 3 pantallas
//   ← Chat grupal  |  Relojes (principal)  |  Mapa GPS →
// + SOS con swipe-to-unlock

const TWEAKS = /*EDITMODE-BEGIN*/{
  "frontTime": "02:15",
  "backTime": "01:40",
  "front2Time": "04:30",
  "back2Time": "03:35",
  "targetGap": 2,
  "mode": "day",
  "numberStyle": "mono",
  "semaphoreStyle": "dots",
  "showLabels": true,
  "microAnims": true,
  "startPage": 1,
  "initialScreen": "login",
  "currentStop": "Tumbes",
  "nextStop": "Lambayeque",
  "avgSpeed": 28
}/*EDITMODE-END*/;

function parseMin(s) {
  const [m, sec] = s.split(':').map(Number);
  return m + sec / 60;
}
window.parseMin = parseMin;

function computeStatus(front, back, target) {
  const f = parseMin(front);
  const b = parseMin(back);
  const worstDev = Math.max(Math.abs(f - target), Math.abs(b - target));
  if (worstDev <= 0.5) return 'green';
  if (worstDev <= 1.0) return 'yellow';
  return 'red';
}
window.computeStatus = computeStatus;

// Modos basados en la paleta azul cooperativa
const P = window.PALETTE;
const MODES = {
  day: {
    bg: P.bg, panel: P.panel, fg: P.white, dim: P.mute, line: P.line,
    brand: P.brand, bright: P.bright, navy: P.navy, deep: P.deep, sky: P.sky,
    green: P.green, yellow: P.yellow, red: P.red,
    emergency: P.red,
  },
  sun: {
    bg: '#F5F9FF', panel: '#E5EFFA', fg: P.navy, dim: '#5A7A99', line: '#B8CFE3',
    brand: P.brand, bright: P.deep, navy: P.navy, deep: P.deep, sky: P.brand,
    green: '#1F8A4F', yellow: '#B58400', red: '#B3001B',
    emergency: '#B3001B',
  },
  night: {
    bg: '#050D17', panel: '#0E2236', fg: '#D7E5F4', dim: '#3D5570', line: '#1A3149',
    brand: P.brand, bright: P.bright, navy: P.navy, deep: P.deep, sky: P.sky,
    green: '#2BAA68', yellow: '#C49A20', red: '#D43050',
    emergency: '#D43050',
  },
};
window.MODES = MODES;

// ─────────────────────────────────────────────────────────────
// Reloj pequeño (para filas ±2 / ±1)
// ─────────────────────────────────────────────────────────────
function SmallClock({ value, label, color, mode, numberStyle, faded }) {
  const fontFamily = numberStyle === 'mono'
    ? '"JetBrains Mono", ui-monospace, monospace'
    : '"Archivo Black", system-ui, sans-serif';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 14px',
      opacity: faded ? 0.45 : 1,
    }}>
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
        color: mode.dim, textTransform: 'uppercase',
        minWidth: 36,
      }}>{label}</div>
      <div style={{
        fontFamily,
        fontSize: 38, fontWeight: 900,
        color,
        lineHeight: 1,
        letterSpacing: -1.5,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reloj GIGANTE (adelante / atrás — principales)
// ─────────────────────────────────────────────────────────────
function AnimatedDigit({ ch, fontSize, color, enableAnim }) {
  const prev = React.useRef(ch);
  const [anim, setAnim] = React.useState(false);
  React.useEffect(() => {
    if (prev.current !== ch && enableAnim) {
      setAnim(true);
      const t = setTimeout(() => setAnim(false), 260);
      return () => clearTimeout(t);
    }
    prev.current = ch;
  }, [ch, enableAnim]);
  return (
    <span style={{
      display: 'inline-block',
      minWidth: ch === ':' ? fontSize * 0.35 : fontSize * 0.62,
      textAlign: 'center',
      color,
      transform: anim ? 'translateY(-2px)' : 'translateY(0)',
      opacity: anim ? 0.85 : 1,
      transition: 'transform 0.22s cubic-bezier(.2,.8,.2,1), opacity 0.22s',
    }}>{ch}</span>
  );
}

function BigTime({ value, label, color, mode, numberStyle, enableAnim, heartbeat }) {
  const fontFamily = numberStyle === 'mono'
    ? '"JetBrains Mono", ui-monospace, monospace'
    : '"Archivo Black", system-ui, sans-serif';
  const fontSize = 96;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '2px 0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 12, fontWeight: 700, letterSpacing: 2,
        color: mode.dim, textTransform: 'uppercase',
        marginBottom: 0,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: mode.green,
          opacity: heartbeat && enableAnim ? 1 : 0.4,
          transition: 'opacity 0.4s',
        }} />
        {label}
      </div>
      <div style={{
        fontFamily, fontSize, fontWeight: 900,
        lineHeight: 0.95, letterSpacing: -3,
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
      }}>
        {value.split('').map((ch, i) => (
          <AnimatedDigit key={i} ch={ch} fontSize={fontSize} color={color} enableAnim={enableAnim} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Semáforo
// ─────────────────────────────────────────────────────────────
function Semaphore({ status, mode, style, enableAnim }) {
  const colors = { red: mode.red, yellow: mode.yellow, green: mode.green };
  const lit = status;
  const pulseDur = status === 'red' ? '0.8s' : status === 'yellow' ? '1.4s' : '2.4s';

  const dot = (key) => {
    const isLit = key === lit;
    return (
      <div key={key} style={{ position: 'relative', width: 34, height: 34 }}>
        {isLit && enableAnim && (
          <div style={{
            position: 'absolute', inset: -6,
            borderRadius: '50%', background: colors[key], opacity: 0.3,
            animation: `combiBreathe ${pulseDur} ease-in-out infinite`,
          }} />
        )}
        <div style={{
          position: 'relative',
          width: 34, height: 34, borderRadius: '50%',
          background: isLit ? colors[key] : 'transparent',
          border: `3px solid ${isLit ? colors[key] : mode.dim}`,
          opacity: isLit ? 1 : 0.3,
          boxShadow: isLit ? `0 0 24px ${colors[key]}, 0 0 48px ${colors[key]}80` : 'none',
          transition: 'all 0.4s',
        }} />
      </div>
    );
  };

  if (style === 'bar') {
    return (
      <div style={{
        width: '78%', height: 14, borderRadius: 7,
        background: colors[lit],
        boxShadow: `0 0 28px ${colors[lit]}`,
        animation: enableAnim ? `combiBreathe ${pulseDur} ease-in-out infinite` : 'none',
      }} />
    );
  }
  return (
    <div style={{
      display: 'flex', gap: 14, alignItems: 'center',
      padding: '8px 18px', borderRadius: 40,
      background: mode.panel,
      border: `1px solid ${mode.line}`,
    }}>
      {dot('red')}{dot('yellow')}{dot('green')}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Header de contexto: paradero actual + velocidad promedio
// ─────────────────────────────────────────────────────────────
function ContextHeader({ currentStop, nextStop, avgSpeed, mode }) {
  // estado de velocidad: bajo / ok / alto (límite urbano referencial: 35 km/h)
  const speedTone =
    avgSpeed < 18 ? mode.yellow :
    avgSpeed > 38 ? mode.red :
    mode.bright;
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'stretch',
      padding: '0 4px',
    }}>
      {/* paradero actual */}
      <div style={{
        flex: 1,
        background: mode.panel,
        border: `1px solid ${mode.line}`,
        borderRadius: 12,
        padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 1,
        minWidth: 0,
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 9, letterSpacing: 1.5, color: mode.dim,
          textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
            background: mode.bright, boxShadow: `0 0 6px ${mode.bright}`,
          }} />
          Tramo
        </div>
        <div style={{
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          fontSize: 14, color: mode.fg, letterSpacing: -0.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{currentStop} <span style={{ color: mode.dim, fontWeight: 400 }}>→</span> {nextStop}</div>
      </div>

      {/* velocidad promedio */}
      <div style={{
        background: mode.panel,
        border: `1px solid ${mode.line}`,
        borderRadius: 12,
        padding: '8px 12px',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        minWidth: 76,
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 9, letterSpacing: 1.5, color: mode.dim,
          textTransform: 'uppercase',
        }}>Vel. prom</div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 3,
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          color: speedTone,
        }}>
          <span style={{ fontSize: 22, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>{avgSpeed}</span>
          <span style={{ fontSize: 9, letterSpacing: 1, color: mode.dim, fontWeight: 700 }}>KM/H</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pantalla CENTRAL — relojes múltiples
// Fila: -2 (atrás-atrás)  |  -1 (atrás)  |  semáforo + SOS en el centro
//        +1 (adelante) | +2 (adelante-adelante)
// Layout vertical: [+2 chip] [+1 GIGANTE] [semáforo] [-1 GIGANTE] [-2 chip]
// ─────────────────────────────────────────────────────────────
function CenterScreen({ tweaks, onFireSos }) {
  const mode = MODES[tweaks.mode] || MODES.day;
  const status = computeStatus(tweaks.frontTime, tweaks.backTime, tweaks.targetGap);
  const [heartbeat, setHeartbeat] = React.useState(true);
  React.useEffect(() => {
    const id = setInterval(() => setHeartbeat(h => !h), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: mode.bg,
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '40px 14px 14px',
      boxSizing: 'border-box',
      position: 'relative',
    }}>
      {/* contexto: tramo + velocidad */}
      <ContextHeader
        currentStop={tweaks.currentStop}
        nextStop={tweaks.nextStop}
        avgSpeed={tweaks.avgSpeed}
        mode={mode}
      />

      {/* +2 adelante (chip pequeño) */}
      <SmallClock value={tweaks.front2Time} label="+2" color={mode.fg} mode={mode} numberStyle={tweaks.numberStyle} faded={true} />

      <div style={{ height: 1, background: mode.line, opacity: 0.5 }} />

      {/* +1 ADELANTE (principal) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BigTime value={tweaks.frontTime} label="+1 ADELANTE" color={mode.fg} mode={mode}
          numberStyle={tweaks.numberStyle} enableAnim={tweaks.microAnims} heartbeat={heartbeat} />
      </div>

      {/* semáforo central */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
        <Semaphore status={status} mode={mode} style={tweaks.semaphoreStyle} enableAnim={tweaks.microAnims} />
      </div>

      {/* -1 ATRÁS (principal) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BigTime value={tweaks.backTime} label="-1 ATRÁS" color={mode.fg} mode={mode}
          numberStyle={tweaks.numberStyle} enableAnim={tweaks.microAnims} heartbeat={heartbeat} />
      </div>

      <div style={{ height: 1, background: mode.line, opacity: 0.5 }} />

      {/* -2 atrás (chip pequeño) */}
      <SmallClock value={tweaks.back2Time} label="-2" color={mode.fg} mode={mode} numberStyle={tweaks.numberStyle} faded={true} />

      {/* SOS slider */}
      <div style={{ marginTop: 12 }}>
        <SosSlider mode={mode} status={status} enableAnim={tweaks.microAnims} onFire={onFireSos} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Carrusel de 3 pantallas (swipe horizontal)
// ─────────────────────────────────────────────────────────────
function Carousel({ tweaks }) {
  const [page, setPage] = React.useState(tweaks.startPage ?? 1);
  const [dragDx, setDragDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const startX = React.useRef(0);
  const startY = React.useRef(0);
  const lockedAxis = React.useRef(null); // 'x' | 'y' | null
  const containerRef = React.useRef(null);
  const [emergencyFired, setEmergencyFired] = React.useState(false);

  React.useEffect(() => {
    if (emergencyFired) {
      const t = setTimeout(() => setEmergencyFired(false), 2000);
      return () => clearTimeout(t);
    }
  }, [emergencyFired]);

  const onDown = (x, y) => {
    setDragging(true);
    startX.current = x;
    startY.current = y;
    lockedAxis.current = null;
  };
  const onMove = (x, y) => {
    if (!dragging) return;
    const dx = x - startX.current;
    const dy = y - startY.current;
    if (!lockedAxis.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        lockedAxis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
    }
    if (lockedAxis.current === 'x') {
      setDragDx(dx);
    }
  };
  const onUp = () => {
    if (!dragging) return;
    const w = containerRef.current?.offsetWidth || 380;
    const threshold = w * 0.25;
    if (lockedAxis.current === 'x') {
      if (dragDx < -threshold && page < 2) setPage(p => p + 1);
      else if (dragDx > threshold && page > 0) setPage(p => p - 1);
    }
    setDragDx(0);
    setDragging(false);
    lockedAxis.current = null;
  };

  // drag handlers solo sobre zonas "no-interactivas": el SOS slider y el mapa
  // manejan sus propios events. Para simplificar, dejamos el drag en el
  // contenedor pero con guard para no secuestrar clicks en chat/mapa/sos.
  React.useEffect(() => {
    if (!dragging) return;
    const mm = (e) => onMove(e.clientX, e.clientY);
    const mu = () => onUp();
    const tm = (e) => onMove(e.touches[0].clientX, e.touches[0].clientY);
    const tu = () => onUp();
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('touchmove', tm, { passive: false });
    window.addEventListener('touchend', tu);
    return () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', tu);
    };
  }, [dragging, page, dragDx]);

  const mode = MODES[tweaks.mode] || MODES.day;
  const status = computeStatus(tweaks.frontTime, tweaks.backTime, tweaks.targetGap);

  const w = containerRef.current?.offsetWidth || 380;
  const translateX = -page * w + (lockedAxis.current === 'x' ? dragDx : 0);

  return (
    <div ref={containerRef} style={{
      position: 'relative',
      width: '100%', height: '100%',
      overflow: 'hidden',
      background: mode.bg,
    }}
      onMouseDown={(e) => {
        // no iniciar swipe si el target está en un elemento con data-noswipe
        if (e.target.closest('[data-noswipe]')) return;
        onDown(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        if (e.target.closest('[data-noswipe]')) return;
        onDown(e.touches[0].clientX, e.touches[0].clientY);
      }}
    >
      {/* flash SOS global */}
      {emergencyFired && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 99,
          background: mode.emergency,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'combiFlash 0.5s ease-out',
        }}>
          <div style={{
            color: '#fff',
            fontFamily: '"Archivo Black", system-ui, sans-serif',
            fontSize: 44, fontWeight: 900, letterSpacing: 4,
            textAlign: 'center',
          }}>
            SOS<br/>
            <span style={{ fontSize: 18, letterSpacing: 2 }}>ALERTA ENVIADA</span>
          </div>
        </div>
      )}

      {/* slides */}
      <div style={{
        display: 'flex',
        width: `${w * 3}px`, height: '100%',
        transform: `translateX(${translateX}px)`,
        transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(.2,.9,.2,1)',
      }}>
        <div style={{ width: `${w}px`, height: '100%', overflow: 'hidden', flexShrink: 0 }}>
          <ChatScreen />
        </div>
        <div style={{ width: `${w}px`, height: '100%', overflow: 'hidden', flexShrink: 0 }}>
          <CenterScreen
            tweaks={tweaks}
            onFireSos={() => setEmergencyFired(true)}
          />
        </div>
        <div style={{ width: `${w}px`, height: '100%', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, background: mode.bg }}>
            <GpsMap
              frontTime={tweaks.frontTime}
              backTime={tweaks.backTime}
              status={status}
              expanded={true}
            />
            <div style={{
              position: 'absolute', top: 16, left: 16,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 10, letterSpacing: 2, color: mode.sky,
              textTransform: 'uppercase', pointerEvents: 'none',
            }}>
              ← volver
            </div>
          </div>
        </div>
      </div>

      {/* indicador de página (dots) — clicables */}
      <div style={{
        position: 'absolute',
        top: 10, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: 8,
        zIndex: 10,
      }}>
        {[0,1,2].map(i => (
          <button key={i}
            onClick={(e) => { e.stopPropagation(); setPage(i); }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              width: i === page ? 24 : 10,
              height: 10, borderRadius: 5,
              background: i === page ? mode.bright : mode.line,
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              transition: 'all 0.3s',
            }}
          />
        ))}
      </div>

      {/* etiqueta de pantalla actual */}
      <div style={{
        position: 'absolute',
        top: 22, left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 9, letterSpacing: 2,
        color: mode.dim,
        textTransform: 'uppercase',
        pointerEvents: 'none', zIndex: 10,
        opacity: 0.7,
      }}>
        {page === 0 ? 'CHAT' : page === 1 ? 'RUTA' : 'MAPA'}
      </div>
    </div>
  );
}

function CombiScreen({ tweaks }) {
  return <Carousel tweaks={tweaks} />;
}

window.CombiScreen = CombiScreen;
window.DEFAULT_TWEAKS = TWEAKS;
