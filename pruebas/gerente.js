// El token de una cuenta de GERENCIA para sembrar datos en las suites.
//
// Existe por la fusión Despacho/gerencia: dar de alta un chofer con su combi
// crea un VEHÍCULO, y los vehículos —los activos— son del gerente, no del
// administrador del día. Las suites que siembran choferes lo hacen ahora con
// esta cuenta, igual que lo haría la cooperativa real.
//
// La cuenta se crea (o se resetea) directo en la base con las mismas piezas
// que usa la consola, en la MISMA empresa que el DESPACHO por defecto.
const RAIZ = require('path').join(__dirname, '..');

module.exports = async function tokenDeGerente(api, dbFile, companyId) {
  const Database = require(RAIZ + '/server/node_modules/better-sqlite3');
  const coop = require(RAIZ + '/server/cooperativas.js');
  const db = new Database(dbFile);
  const empresa = companyId ||
    (db.prepare("SELECT companyId FROM users WHERE role = 'dispatch' ORDER BY createdAt LIMIT 1").get() || {}).companyId;
  const r = coop.gerente(db, { companyId: empresa, usuario: 'GERENTE-PRUEBA', clave: 'gerente-prueba-1' });
  db.close();
  if (r.error) throw new Error('no se pudo crear GERENTE-PRUEBA: ' + r.error);

  const res = await fetch(api + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'GERENTE-PRUEBA', password: 'gerente-prueba-1' }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!cuerpo.token) throw new Error('GERENTE-PRUEBA no pudo entrar: ' + (cuerpo.error || res.status));
  return cuerpo.token;
};
