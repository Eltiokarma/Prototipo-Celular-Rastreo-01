// Botón SOS con swipe-to-unlock
// El conductor debe deslizar el círculo rojo de izquierda a derecha
// hasta el final para disparar la alerta. Esto previene toques accidentales.

function SosSlider({ mode, status, enableAnim, onFire }) {
  const trackRef = React.useRef(null);
  const [progress, setProgress] = React.useState(0); // 0..1
  const [dragging, setDragging] = React.useState(false);
  const [fired, setFired] = React.useState(false);
  const startX = React.useRef(0);
  const startProg = React.useRef(0);

  const onDown = (clientX) => {
    if (fired) return;
    setDragging(true);
    startX.current = clientX;
    startProg.current = progress;
  };
  const onMove = (clientX) => {
    if (!dragging || fired) return;
    const track = trackRef.current;
    if (!track) return;
    const trackW = track.offsetWidth - 68; // ancho menos el thumb
    const dx = clientX - startX.current;
    const p = Math.max(0, Math.min(1, startProg.current + dx / trackW));
    setProgress(p);
    if (p >= 0.98) {
      setFired(true);
      setDragging(false);
      onFire && onFire();
      setTimeout(() => { setFired(false); setProgress(0); }, 2200);
    }
  };
  const onUp = () => {
    setDragging(false);
    if (!fired) setProgress(0); // rebote si no llegó al final
  };

  React.useEffect(() => {
    if (!dragging) return;
    const mm = (e) => onMove(e.clientX);
    const mu = () => onUp();
    const tm = (e) => onMove(e.touches[0].clientX);
    const tu = () => onUp();
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    window.addEventListener('touchmove', tm);
    window.addEventListener('touchend', tu);
    return () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', tu);
    };
  }, [dragging]);

  const trackH = 88;
  const thumbSize = 68;
  const suggestSos = status === 'red' && enableAnim;

  return (
    <div ref={trackRef} data-noswipe="sos" style={{
      position: 'relative',
      width: '100%',
      height: trackH,
      borderRadius: trackH / 2,
      background: mode === MODES.sun ? '#f3f3f3' : '#1a1a1a',
      border: `3px solid ${mode.emergency}`,
      overflow: 'hidden',
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      boxSizing: 'border-box',
    }}>
      {/* ring pulsante cuando estado rojo */}
      {suggestSos && !dragging && progress === 0 && (
        <div style={{
          position: 'absolute', inset: -5,
          borderRadius: (trackH + 10) / 2,
          border: `2px solid ${mode.emergency}`,
          animation: 'combiRing 1.6s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}

      {/* relleno a medida que avanza */}
      <div style={{
        position: 'absolute', inset: 0,
        background: mode.emergency,
        width: `calc(${thumbSize/2 + 5}px + ${progress * 100}%)`,
        maxWidth: '100%',
        transition: dragging ? 'none' : 'width 0.25s cubic-bezier(.4,0,.2,1)',
        opacity: 0.9,
      }} />

      {/* etiqueta */}
      <div style={{
        position: 'absolute', inset: 0,
        paddingLeft: thumbSize + 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"Archivo Black", system-ui, sans-serif',
        fontSize: 22, fontWeight: 900, letterSpacing: 2.5,
        color: progress > 0.3 ? '#fff' : mode.emergency,
        transition: 'color 0.2s',
        pointerEvents: 'none',
        zIndex: 2,
        opacity: progress > 0.85 ? 0 : 1,
      }}>
        {fired ? 'ENVIANDO...'
               : progress > 0.5 ? 'SUELTA PARA SOS'
               : 'DESLIZA →'}
      </div>

      {/* chevrons animados */}
      {!fired && progress < 0.3 && enableAnim && (
        <div style={{
          position: 'absolute', right: 24, top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex', gap: 4,
          color: mode.emergency, opacity: 0.4,
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              fontFamily: '"Archivo Black", system-ui',
              fontSize: 22, fontWeight: 900,
              animation: `combiChev 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}>›</span>
          ))}
        </div>
      )}

      {/* thumb arrastrable */}
      <div
        onMouseDown={(e) => onDown(e.clientX)}
        onTouchStart={(e) => onDown(e.touches[0].clientX)}
        style={{
          position: 'absolute',
          left: `calc(${progress} * (100% - ${thumbSize + 10}px) + 5px)`,
          top: 5,
          width: thumbSize, height: thumbSize,
          borderRadius: '50%',
          background: '#fff',
          color: mode.emergency,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Archivo Black", system-ui, sans-serif',
          fontSize: 20, fontWeight: 900,
          cursor: 'grab',
          transition: dragging ? 'none' : 'left 0.3s cubic-bezier(.4,0,.2,1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          zIndex: 3,
          touchAction: 'none',
        }}
      >
        {fired ? '✓' : 'SOS'}
      </div>
    </div>
  );
}

window.SosSlider = SosSlider;
