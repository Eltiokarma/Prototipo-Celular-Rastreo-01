// Un plugin de Babel para los chequeos de sintaxis: avisa cuando una
// const/let se usa ANTES de su declaración en el mismo cuerpo de función
// —no adentro de una función anidada, que corre después—. Compila bien y
// revienta al ejecutar («Cannot access 'combis' before initialization»).
//
// Existe por la revisión previa a la APK (31/10): un `combis` usado unas
// líneas antes de su `useState` en `App.js` habría tirado la app al abrirla,
// y ni la sintaxis ni ninguna suite lo veía.
module.exports = function zonaMuerta(hallazgos, fuente) {
  const linea = (pos) => fuente.slice(0, pos).split('\n').length;
  return () => ({
    visitor: {
      ReferencedIdentifier(p) {
        const b = p.scope.getBinding(p.node.name);
        if (!b || (b.kind !== 'const' && b.kind !== 'let')) return;
        if (b.path.node.start == null || p.node.start == null || p.node.start >= b.path.node.start) return;
        const enRef = p.getFunctionParent(), enDecl = b.path.getFunctionParent();
        if ((enRef && enRef.node) !== (enDecl && enDecl.node)) return;
        hallazgos.push(`«${p.node.name}» en la línea ${linea(p.node.start)}, declarada en la ${linea(b.path.node.start)}`);
      },
    },
  });
};
