# Manual del equipo

`manual-del-equipo.pdf` es el manual de inducción para las primeras personas que entran a trabajar en Micros Tempo: por qué existe la empresa, cómo gana dinero, qué se espera de cada puesto y por qué, cómo se vende una ruta paso a paso, lo que nunca se promete y cómo se mide el trabajo.

Las metas, los sueldos y las fechas son los del Plan del primer año, versión alfa (`plan-financiero/`). Si el plan cambia, este manual se revisa con él.

```bash
cd equipo && latexmk -pdf manual-del-equipo.tex
```

Usa el preámbulo del plan (`plan-financiero/latex/preambulo.tex`) y necesita el mismo TeX Live que el resto de los documentos.
