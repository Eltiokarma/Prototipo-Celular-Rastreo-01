// Login + confirmación de salida a ruta
// Ataca dos problemas: (1) autenticación del conductor,
// (2) "después de la vuelta no quieren salir" → confirmación obligatoria

const COOP = window.COOP;
const P = window.PALETTE;

// ─────────────────────────────────────────────────────────────
// Logo procedural (círculo con volante estilizado)
// ─────────────────────────────────────────────────────────────
function CoopLogo({ size = 72 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="33" fill={P.brand} />
      <circle cx="36" cy="36" r="33" fill="none" stroke={P.sky} strokeWidth="2.5" />
      <circle cx="36" cy="36" r="18" fill="none" stroke="#fff" strokeWidth="3" />
      <circle cx="36" cy="36" r="4" fill="#fff" />
      <line x1="36" y1="22" x2="36" y2="30" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <line x1="36" y1="42" x2="36" y2="50" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <line x1="22" y1="36" x2="30" y2="36" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <line x1="42" y1="36" x2="50" y2="36" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <text x="36" y="66" textAnchor="middle"
        fontFamily="Archivo Black, sans-serif" fontSize="9"
        fill={P.sky} fontWeight="900">R-14</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Campo de entrada
// ─────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', error, autoFocus }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10, letterSpacing: 2, color: error ? P.red : P.sky,
        textTransform: 'uppercase', marginBottom: 6,
      }}>{label}</div>
      <input type={type} value={value} autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '16px 14px',
          fontSize: 22, fontWeight: 600,
          fontFamily: '"Helvetica Neue", system-ui, sans-serif',
          background: P.panel,
          border: `2px solid ${error ? P.red : P.line}`,
          borderRadius: 12,
          color: P.white,
          outline: 'none',
          transition: 'border-color 0.2s',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pantalla de LOGIN
// ─────────────────────────────────────────────────────────────
function LoginScreen({ onSuccess }) {
  const [user, setUser] = React.useState('');
  const [pass, setPass] = React.useState('');
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const submit = () => {
    if (!user || !pass) {
      setError('Completa usuario y contraseña');
      return;
    }
    setLoading(true);
    setError(null);
    setTimeout(() => {
      // simulación: si contraseña es exactamente "1234" falla
      if (pass === '1234') {
        setLoading(false);
        setError('Contraseña incorrecta · intento 2 de 3');
        setPass('');
      } else {
        onSuccess({ user });
      }
    }, 800);
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      background: `linear-gradient(180deg, ${P.bg} 0%, ${P.navy} 100%)`,
      display: 'flex', flexDirection: 'column',
      padding: '40px 24px 24px',
      boxSizing: 'border-box',
      color: P.white,
    }}>
      {/* cabecera con logo */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
        <CoopLogo size={88} />
        <div style={{
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          fontSize: 26, fontWeight: 900, letterSpacing: -0.5,
          color: P.white, marginTop: 14,
        }}>{COOP.name}</div>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10, letterSpacing: 1.5, color: P.sky,
          textTransform: 'uppercase', marginTop: 4, textAlign: 'center',
        }}>{COOP.route}</div>
      </div>

      {/* chip de conexión */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        alignSelf: 'center',
        padding: '4px 10px',
        background: P.panel,
        border: `1px solid ${P.line}`,
        borderRadius: 100,
        marginBottom: 22,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: P.green, boxShadow: `0 0 8px ${P.green}`,
        }} />
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10, letterSpacing: 1.5, color: P.green,
          textTransform: 'uppercase',
        }}>Conectado</span>
      </div>

      {/* formulario */}
      <Field label="Usuario" value={user} onChange={setUser} autoFocus={true} error={!!error && !user} />
      <Field label="Contraseña" value={pass} onChange={setPass} type="password" error={!!error} />

      {/* error */}
      {error && (
        <div style={{
          background: 'rgba(255,77,109,0.12)',
          border: `1px solid ${P.red}`,
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: P.red, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: '"Archivo Black", system-ui',
            fontSize: 14, flexShrink: 0,
          }}>!</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: P.red,
            fontFamily: '"Helvetica Neue", system-ui',
          }}>{error}</div>
        </div>
      )}

      {/* botón ingresar */}
      <button onClick={submit} disabled={loading}
        style={{
          width: '100%',
          padding: '18px',
          fontSize: 20, fontWeight: 900, letterSpacing: 2,
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          background: loading ? P.deep : P.bright,
          color: P.white,
          border: 'none', borderRadius: 14,
          cursor: loading ? 'wait' : 'pointer',
          boxShadow: loading ? 'none' : `0 4px 0 ${P.deep}`,
          transition: 'all 0.12s',
          opacity: loading ? 0.7 : 1,
        }}>
        {loading ? 'VERIFICANDO...' : 'INGRESAR'}
      </button>

      {/* links menores */}
      <div style={{
        marginTop: 18, textAlign: 'center',
        fontFamily: '"Helvetica Neue", system-ui',
        fontSize: 13, color: P.mute,
      }}>
        <a href="#" style={{ color: P.sky, textDecoration: 'none' }}>Olvidé mi contraseña</a>
      </div>

      <div style={{ flex: 1 }} />

      {/* pie */}
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 9, letterSpacing: 1.5, color: P.mute,
        textAlign: 'center', textTransform: 'uppercase',
      }}>
        {COOP.full}<br/>
        Juliaca · Puno · 3 824 m
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirmación de SALIR A RUTA
// Aparece al iniciar la app y al terminar cada vuelta.
// Diseño: muy claro, botón principal grande, escape ("descansar")
// con fricción (10 min bloqueo).
// ─────────────────────────────────────────────────────────────
function StartRouteScreen({ user, lapNumber, onStart, onRest }) {
  const [countdown, setCountdown] = React.useState(15);
  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const isFirstLap = lapNumber === 1;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: P.bg,
      display: 'flex', flexDirection: 'column',
      padding: '28px 22px 22px',
      boxSizing: 'border-box',
      color: P.white,
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
      }}>
        <CoopLogo size={36} />
        <div>
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, letterSpacing: 1.5, color: P.sky,
            textTransform: 'uppercase',
          }}>Hola, conductor</div>
          <div style={{
            fontFamily: '"Archivo Black", system-ui, sans-serif',
            fontSize: 18, color: P.white, letterSpacing: -0.3,
          }}>{user || 'RAÚL MAMANI'}</div>
        </div>
      </div>

      {/* estado de la vuelta */}
      {!isFirstLap && (
        <div style={{
          background: P.panel,
          border: `1px solid ${P.line}`,
          borderRadius: 14,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: P.green, color: P.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: '"Archivo Black", system-ui',
            fontSize: 18, flexShrink: 0,
          }}>✓</div>
          <div>
            <div style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 10, letterSpacing: 1.5, color: P.sky,
              textTransform: 'uppercase',
            }}>Vuelta {lapNumber - 1} completada</div>
            <div style={{
              fontFamily: '"Helvetica Neue", system-ui',
              fontSize: 15, fontWeight: 600, color: P.white,
            }}>48 min · 42 pasajeros</div>
          </div>
        </div>
      )}

      {/* pregunta central */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 11, letterSpacing: 2, color: P.sky,
          textTransform: 'uppercase', marginBottom: 10,
        }}>
          {isFirstLap ? 'Inicio de turno' : `Vuelta ${lapNumber}`}
        </div>
        <div style={{
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          fontSize: 38, fontWeight: 900, letterSpacing: -1.2,
          color: P.white, textAlign: 'center',
          lineHeight: 1.05,
          marginBottom: 8,
          textWrap: 'balance',
        }}>
          ¿Salir a ruta<br/>ahora?
        </div>
        <div style={{
          fontFamily: '"Helvetica Neue", system-ui',
          fontSize: 15, color: P.mute, textAlign: 'center',
          lineHeight: 1.4, maxWidth: 280,
        }}>
          Despacho asignará tu posición en la rueda según tu salida.
        </div>
      </div>

      {/* unidad + turno */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        marginBottom: 16,
      }}>
        <div style={{
          background: P.panel,
          border: `1px solid ${P.line}`,
          borderRadius: 12,
          padding: '10px 12px',
        }}>
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 9, letterSpacing: 1.5, color: P.sky,
            textTransform: 'uppercase',
          }}>Unidad</div>
          <div style={{
            fontFamily: '"Archivo Black", system-ui',
            fontSize: 20, color: P.white, letterSpacing: -0.3,
          }}>V-247</div>
        </div>
        <div style={{
          background: P.panel,
          border: `1px solid ${P.line}`,
          borderRadius: 12,
          padding: '10px 12px',
        }}>
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 9, letterSpacing: 1.5, color: P.sky,
            textTransform: 'uppercase',
          }}>Turno</div>
          <div style={{
            fontFamily: '"Archivo Black", system-ui',
            fontSize: 20, color: P.white, letterSpacing: -0.3,
          }}>13:00 — 21:00</div>
        </div>
      </div>

      {/* botón salir a ruta (principal) */}
      <button onClick={onStart}
        style={{
          width: '100%',
          padding: '22px',
          fontSize: 24, fontWeight: 900, letterSpacing: 2.5,
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          background: P.bright,
          color: P.white,
          border: 'none', borderRadius: 16,
          cursor: 'pointer',
          boxShadow: `0 5px 0 ${P.deep}`,
          marginBottom: 10,
        }}>
        SALIR A RUTA →
      </button>

      {/* opción descansar (con fricción) */}
      <button onClick={onRest}
        disabled={countdown > 0}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: 13, fontWeight: 700, letterSpacing: 1,
          fontFamily: '"Helvetica Neue", system-ui, sans-serif',
          background: 'transparent',
          color: countdown > 0 ? P.mute : P.sky,
          border: `1px solid ${countdown > 0 ? P.line : P.deep}`,
          borderRadius: 10,
          cursor: countdown > 0 ? 'not-allowed' : 'pointer',
        }}>
        {countdown > 0
          ? `Descansar 10 min · disponible en ${countdown}s`
          : 'Descansar 10 min'}
      </button>
    </div>
  );
}

window.LoginScreen = LoginScreen;
window.StartRouteScreen = StartRouteScreen;
