// Fija los números del Plan del Primer Año v. alfa. Si un cambio del modelo
// mueve alguno, esta prueba falla y obliga a revisar el PDF y el simulador.
const test = require('node:test');
const assert = require('node:assert');
const { simular } = require('./modelo');

const cerca = (a, b) => Math.abs(a - b) < 1;

test('el plan base da los números publicados', () => {
  const { resumen: r, filas } = simular();
  assert.ok(cerca(r.cajaMinima, -40306.24), r.cajaMinima);
  assert.strictEqual(r.mesCajaMinima, 'abr-27');
  assert.ok(cerca(r.utilidad2027, 92207.17), r.utilidad2027);
  assert.ok(cerca(r.cajaFinal, 87091.02), r.cajaFinal);
  assert.strictEqual(r.ganaDesde, 'may-27');
  assert.strictEqual(r.llenoLocal, 'jul-27');
  assert.deepStrictEqual(r.pausa, { desde: 'ago-27', hasta: 'nov-27' });
  assert.deepStrictEqual(filas.map(f => f.rutas), [2, 7, 16, 23, 33, 43, 53, 60, 60, 60, 60, 60, 70, 80, 90, 100]);
});

test('cada mes, el desglose suma el total de gastos', () => {
  for (const f of simular().filas) {
    const s = Object.values(f.desglose).reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
    assert.ok(cerca(s, f.totalGastos), f.mes);
  }
});

test('las rutas reales reemplazan a la capacidad', () => {
  const r = simular({ rutasReales: [2, 3] });
  assert.strictEqual(r.filas[1].rutas, 5);
});
