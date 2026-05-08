// Chat grupal de la ruta — mensajes cortos, de voz y texto
// Pensado para lectura de reojo: burbujas grandes, tiempo dominante

const CHAT_SEED = [
  { from: 'Despacho',  role: 'admin',    text: 'Atención ruta R-14. Control en Tumbes.', time: '14:02', tone: 'info' },
  { from: 'Chofer 08', role: 'driver',   text: 'Voy lleno, paso directo', time: '14:05', tone: 'normal' },
  { from: 'Chofer 12', role: 'driver',   voice: 22, time: '14:07', tone: 'normal' }, // mensaje de voz 22s
  { from: 'Chofer 19', role: 'driver',   text: 'Bloqueo en óvalo Huancané', time: '14:08', tone: 'warn' },
  { from: 'Despacho',  role: 'admin',    text: 'Desvío por Jr. Lambayeque', time: '14:09', tone: 'info' },
  { from: 'Chofer 22', role: 'driver',   voice: 8,  time: '14:11', tone: 'normal' },
  { from: 'TÚ',         role: 'you',      text: 'Copiado', time: '14:11', tone: 'normal' },
];

const TONE_COLOR = {
  info:   { bg: '#1a2540', border: '#2d4270', accent: '#6ba4ff' },
  warn:   { bg: '#3a2410', border: '#6a3e16', accent: '#ffb347' },
  normal: { bg: '#1a1e24', border: '#2a2f38', accent: '#aab4c0' },
  you:    { bg: '#0f2a20', border: '#1e5440', accent: '#00E676' },
};

function VoiceBar({ seconds, accent }) {
  // forma de onda procedural
  const bars = Array.from({ length: 22 }, (_, i) => {
    const h = 6 + Math.abs(Math.sin(i * 1.7) * 16) + Math.abs(Math.cos(i * 0.7) * 8);
    return h;
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: accent, color: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>▶</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
        {bars.map((h, i) => (
          <div key={i} style={{
            width: 3, height: h, borderRadius: 1,
            background: accent, opacity: i < 6 ? 1 : 0.4,
          }} />
        ))}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 13, fontWeight: 700, color: accent, minWidth: 28, textAlign: 'right',
      }}>{seconds}"</div>
    </div>
  );
}

function ChatMsg({ msg }) {
  const isYou = msg.role === 'you';
  const tone = isYou ? TONE_COLOR.you : TONE_COLOR[msg.tone] || TONE_COLOR.normal;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isYou ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10, letterSpacing: 1, color: '#6b7785',
        textTransform: 'uppercase', marginBottom: 4,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {msg.role === 'admin' && <span style={{
          background: '#6ba4ff', color: '#000',
          padding: '1px 5px', borderRadius: 3, fontSize: 8,
        }}>ADMIN</span>}
        <span>{msg.from}</span>
        <span style={{ color: '#4a5362' }}>· {msg.time}</span>
      </div>
      <div style={{
        maxWidth: '84%',
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 14,
        padding: '10px 14px',
        fontFamily: '"Helvetica Neue", system-ui, sans-serif',
        fontSize: 17, fontWeight: 500, color: '#fff',
        lineHeight: 1.3,
      }}>
        {msg.voice
          ? <VoiceBar seconds={msg.voice} accent={tone.accent} />
          : msg.text}
      </div>
    </div>
  );
}

function ChatScreen() {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#000',
      display: 'flex', flexDirection: 'column',
      padding: '18px 16px 16px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, letterSpacing: 2, color: '#6b7785',
            textTransform: 'uppercase',
          }}>Grupo ruta</div>
          <div style={{
            fontFamily: '"Archivo Black", system-ui, sans-serif',
            fontSize: 26, color: '#fff', letterSpacing: -0.5,
          }}>R-14 · 24 en línea</div>
        </div>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: '#FF1744',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          fontSize: 18, color: '#fff',
        }}>🎙</div>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {CHAT_SEED.map((m, i) => <ChatMsg key={i} msg={m} />)}
      </div>

      {/* barra inferior — hold to talk */}
      <div style={{
        marginTop: 10,
        background: '#1a1e24',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        border: '1px solid #2a2f38',
      }}>
        <div style={{ flex: 1,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 12, letterSpacing: 1.5, color: '#6b7785',
          textTransform: 'uppercase',
        }}>
          Mantén para hablar
        </div>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: '#FF1744', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, boxShadow: '0 0 24px #FF174460',
        }}>●</div>
      </div>
    </div>
  );
}

window.ChatScreen = ChatScreen;
