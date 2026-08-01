// Caché en disco de los assets de CDN (React, Babel, Leaflet, fuentes, tiles).
// El proxy del sandbox falla con 503 cada tanto y dejaba la página en blanco:
// con esto, una vez bajado, los tests no vuelven a depender de la red.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DIR = path.join(__dirname, 'cdn');

module.exports = async function interceptarHttps(ctx) {
  const mem = new Map();
  await ctx.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    const clave = crypto.createHash('sha1').update(url).digest('hex');
    const cuerpo = path.join(DIR, clave);
    const meta = cuerpo + '.json';
    try {
      if (!mem.has(url)) {
        if (fs.existsSync(cuerpo) && fs.existsSync(meta)) {
          mem.set(url, { body: fs.readFileSync(cuerpo), ...JSON.parse(fs.readFileSync(meta, 'utf8')) });
        } else {
          const res = await fetch(url);
          const body = Buffer.from(await res.arrayBuffer());
          const info = { type: res.headers.get('content-type') || 'application/octet-stream', status: res.status };
          if (res.status < 400) {
            fs.writeFileSync(cuerpo, body);
            fs.writeFileSync(meta, JSON.stringify(info));
          }
          mem.set(url, { body, ...info });
        }
      }
      const c = mem.get(url);
      await route.fulfill({ status: c.status, contentType: c.type, body: c.body });
    } catch { await route.abort(); }
  });
};
