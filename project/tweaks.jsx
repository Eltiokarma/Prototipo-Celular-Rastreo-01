// Panel de Tweaks

function TweakRow({ label, children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      paddingBottom: 12, marginBottom: 12,
      borderBottom: '1px solid #2a2a2a',
    }}>
      <label style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10, letterSpacing: 1.5,
        color: '#888', textTransform: 'uppercase',
      }}>{label}</label>
      {children}
    </div>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 4, background: '#1a1a1a',
      borderRadius: 8, padding: 3,
    }}>
      {options.map(opt => (
        <button key={opt.v} onClick={() => onChange(opt.v)} style={{
          flex: 1, padding: '6px 8px',
          borderRadius: 6, border: 'none',
          background: value === opt.v ? '#fff' : 'transparent',
          color: value === opt.v ? '#000' : '#ccc',
          fontFamily: 'system-ui', fontSize: 11, fontWeight: 600,
          cursor: 'pointer',
        }}>{opt.l}</button>
      ))}
    </div>
  );
}

function ScenarioButton({ label, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '8px 6px',
      borderRadius: 6, border: active ? '1px solid #fff' : '1px solid #333',
      background: active ? '#fff' : '#1a1a1a',
      color: active ? '#000' : '#ccc',
      fontFamily: 'system-ui', fontSize: 10, fontWeight: 600,
      cursor: 'pointer',
      textAlign: 'center',
    }}>{label}</button>
  );
}

function TweaksPanel({ tweaks, setTweaks, visible, onNav, currentScreen }) {
  if (!visible) return null;

  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
  };

  const scenarios = [
    { l: 'Saludable', f: '02:00', b: '02:00' },
    { l: 'Adelante lejos', f: '03:30', b: '01:50' },
    { l: 'Atrás pegado', f: '02:10', b: '00:45' },
    { l: 'Crítico', f: '04:20', b: '00:20' },
  ];

  const activeScenario = scenarios.find(
    s => s.f === tweaks.frontTime && s.b === tweaks.backTime
  );

  return (
    <div style={{
      position: 'fixed', right: 20, top: 20,
      width: 280, maxHeight: '92vh', overflow: 'auto',
      background: '#0a0a0a', color: '#eee',
      borderRadius: 14, padding: 16,
      border: '1px solid #2a2a2a',
      boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      fontFamily: 'system-ui, sans-serif',
      zIndex: 9999,
    }}>
      <div style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11, letterSpacing: 2,
        color: '#fff', textTransform: 'uppercase',
        marginBottom: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Tweaks</span>
        <span style={{ color: '#666', fontSize: 9 }}>v2</span>
      </div>

      <TweakRow label="Pantalla">
        <Seg value={currentScreen || 'app'} onChange={v => { update({ initialScreen: v }); onNav && onNav(v); }}
          options={[
            { v: 'login', l: 'Login' },
            { v: 'start', l: 'Salir ruta' },
            { v: 'app', l: 'App' },
          ]}
        />
      </TweakRow>

      <TweakRow label="Escenario">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {scenarios.map(s => (
            <ScenarioButton
              key={s.l}
              label={s.l}
              active={activeScenario?.l === s.l}
              onClick={() => update({ frontTime: s.f, backTime: s.b })}
            />
          ))}
        </div>
      </TweakRow>

      <TweakRow label={`Adelante: ${tweaks.frontTime}`}>
        <input type="range" min="0" max="600" step="5"
          value={parseInt(tweaks.frontTime.split(':')[0])*60 + parseInt(tweaks.frontTime.split(':')[1])}
          onChange={e => {
            const s = parseInt(e.target.value);
            const m = String(Math.floor(s/60)).padStart(2,'0');
            const sec = String(s%60).padStart(2,'0');
            update({ frontTime: `${m}:${sec}` });
          }}
          style={{ width: '100%', accentColor: '#fff' }}
        />
      </TweakRow>

      <TweakRow label={`Atrás: ${tweaks.backTime}`}>
        <input type="range" min="0" max="600" step="5"
          value={parseInt(tweaks.backTime.split(':')[0])*60 + parseInt(tweaks.backTime.split(':')[1])}
          onChange={e => {
            const s = parseInt(e.target.value);
            const m = String(Math.floor(s/60)).padStart(2,'0');
            const sec = String(s%60).padStart(2,'0');
            update({ backTime: `${m}:${sec}` });
          }}
          style={{ width: '100%', accentColor: '#fff' }}
        />
      </TweakRow>

      <TweakRow label={`+2 unidad lejana adelante: ${tweaks.front2Time}`}>
        <input type="range" min="0" max="900" step="5"
          value={parseInt(tweaks.front2Time.split(':')[0])*60 + parseInt(tweaks.front2Time.split(':')[1])}
          onChange={e => {
            const s = parseInt(e.target.value);
            const m = String(Math.floor(s/60)).padStart(2,'0');
            const sec = String(s%60).padStart(2,'0');
            update({ front2Time: `${m}:${sec}` });
          }}
          style={{ width: '100%', accentColor: '#fff' }}
        />
      </TweakRow>

      <TweakRow label={`-2 unidad lejana atrás: ${tweaks.back2Time}`}>
        <input type="range" min="0" max="900" step="5"
          value={parseInt(tweaks.back2Time.split(':')[0])*60 + parseInt(tweaks.back2Time.split(':')[1])}
          onChange={e => {
            const s = parseInt(e.target.value);
            const m = String(Math.floor(s/60)).padStart(2,'0');
            const sec = String(s%60).padStart(2,'0');
            update({ back2Time: `${m}:${sec}` });
          }}
          style={{ width: '100%', accentColor: '#fff' }}
        />
      </TweakRow>

      <TweakRow label="Pantalla inicial">
        <Seg value={String(tweaks.startPage)} onChange={v => update({ startPage: parseInt(v) })}
          options={[
            { v: '0', l: 'Chat' },
            { v: '1', l: 'Ruta' },
            { v: '2', l: 'Mapa' },
          ]}
        />
      </TweakRow>

      <TweakRow label={`Objetivo: ${tweaks.targetGap} min`}>
        <input type="range" min="1" max="5" step="0.5"
          value={tweaks.targetGap}
          onChange={e => update({ targetGap: parseFloat(e.target.value) })}
          style={{ width: '100%', accentColor: '#fff' }}
        />
      </TweakRow>

      <TweakRow label="Modo de luz">
        <Seg value={tweaks.mode} onChange={v => update({ mode: v })}
          options={[
            { v: 'day', l: 'Día' },
            { v: 'sun', l: 'Sol extremo' },
            { v: 'night', l: 'Noche' },
          ]}
        />
      </TweakRow>

      <TweakRow label="Tipografía de números">
        <Seg value={tweaks.numberStyle} onChange={v => update({ numberStyle: v })}
          options={[
            { v: 'mono', l: 'Mono' },
            { v: 'sans', l: 'Sans pesada' },
          ]}
        />
      </TweakRow>

      <TweakRow label="Semáforo">
        <Seg value={tweaks.semaphoreStyle} onChange={v => update({ semaphoreStyle: v })}
          options={[
            { v: 'dots', l: '3 luces' },
            { v: 'bar', l: 'Barra' },
          ]}
        />
      </TweakRow>

      <TweakRow label="Etiquetas">
        <Seg value={tweaks.showLabels ? 'on' : 'off'} onChange={v => update({ showLabels: v === 'on' })}
          options={[
            { v: 'on', l: 'Mostrar' },
            { v: 'off', l: 'Ocultar' },
          ]}
        />
      </TweakRow>

      <TweakRow label="Micro-interacciones">
        <Seg value={tweaks.microAnims ? 'on' : 'off'} onChange={v => update({ microAnims: v === 'on' })}
          options={[
            { v: 'on', l: 'Activadas' },
            { v: 'off', l: 'Desactivadas' },
          ]}
        />
      </TweakRow>

      <div style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 9, color: '#555', lineHeight: 1.5,
        marginTop: 8,
      }}>
        Desliza horizontalmente para cambiar pantalla:<br/>
        <strong style={{color:'#aaa'}}>← Chat · Ruta · Mapa →</strong><br/>
        Desliza el círculo SOS hasta el final para alertar.
      </div>
    </div>
  );
}

window.TweaksPanel = TweaksPanel;
