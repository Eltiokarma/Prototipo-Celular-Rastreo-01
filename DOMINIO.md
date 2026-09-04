# microstempo.com — el cableado

El dominio y el correo ya existen (Hostinger, 3/9: dominio por 2 años +
2 buzones; `soporte@microstempo.com` creado). Esto documenta cómo se
conecta todo, en el orden que no rompe nada.

## El plano

| Dirección | Qué muestra | Quién la atiende |
| --- | --- | --- |
| `microstempo.com` (y `www`) | La **landing** comercial | El mismo servidor de Railway (por el header Host) |
| `app.microstempo.com` | El producto: app web del chofer, paneles, API, WebSocket | Railway |
| `app.microstempo.com/privacidad` | La política de privacidad (la URL de la ficha de Play) | Railway |
| `soporte@microstempo.com` | Correo público: ficha de Play, `/privacidad`, clientes | Hostinger Email |
| `admin@microstempo.com` (2.º buzón) | Cuentas de servicio: Play Console, Expo, Railway, Geoapify — nunca se publica | Hostinger Email |

Un solo servidor atiende la landing y el producto: el código ya distingue
por dominio (variable `DOMINIO_LANDING`). No hay un hosting más que pagar.
La landing también se puede ver siempre en `/landing`.

## Pasos, en orden

1. **Railway → Settings → Networking → Custom Domain**: agregar
   `app.microstempo.com`, `microstempo.com` y `www.microstempo.com`.
   Railway muestra, para cada uno, el destino DNS a apuntar.
2. **Hostinger → Dominios → microstempo.com → DNS**: crear los registros
   que Railway pidió — `app` y `www` van como **CNAME**. Para la raíz
   (`@`), si Hostinger no acepta CNAME en la raíz, usar la **redirección
   de dominio** de Hostinger: `microstempo.com → https://www.microstempo.com`.
   **No tocar los registros MX**: son del correo y Hostinger ya los puso.
3. **Variables en Railway** (las nuevas en negrita):
   - **`DOMINIO_LANDING`** = `microstempo.com,www.microstempo.com`
   - **`CONTACTO_PRIVACIDAD`** = `soporte@microstempo.com`
   - `TZ` = `America/Lima`
   - `TILES_RELEASE_URL` = `https://github.com/Eltiokarma/Prototipo-Celular-Rastreo-01/releases/download/mapa-propio`
4. **Geoapify → panel → Allowed HTTP referrers**: agregar
   `microstempo.com` y `app.microstempo.com` (la URL vieja de Railway
   puede quedar mientras conviva).
5. Probar: `microstempo.com` → landing · `app.microstempo.com` → app ·
   `app.microstempo.com/privacidad` → política con el correo de soporte.

## Lo que NO cambia todavía

- **La URL vieja de Railway sigue viva** y los APK de prueba que apuntan
  a ella siguen funcionando. No se apaga nada.
- **El APK nuevo** (paquete `com.microstempo.chofer`, perfil `production`)
  ya compila `https://app.microstempo.com` adentro: **no generar el build
  de producción antes del paso 1**, o la app nace apuntando a un dominio
  que no responde.

## La cuenta de Play y el correo

La cuenta de Google Play Console conviene crearla con
`admin@microstempo.com` — y **dejar un Gmail personal como correo de
recuperación**: si el dominio venciera alguna vez, la cuenta de
desarrollador no puede quedar colgando de un buzón muerto.
