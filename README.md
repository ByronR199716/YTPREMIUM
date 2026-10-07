# YTPremium

App Android para ver YouTube y escuchar YouTube Music sin anuncios, con reproducción en segundo plano. El acceso se activa con un código.

## Origen y licencia

YTPremium es una versión modificada de [NouTube](https://github.com/nonbili/NouTube) (de nonbili), publicada bajo la licencia **GNU AGPL-3.0**. Este repositorio contiene el código fuente completo de la versión modificada, bajo la misma licencia (ver `LICENSE`).

Cambios principales respecto al original:
- Nombre, ícono y package (`ec.ytpremium.app`).
- Pantalla de acceso por código antes de abrir la app.
- Sin donaciones, enlaces externos, cuentas ni sincronización del proyecto original.

## Compilación

GitHub Actions compila y firma el APK en cada cambio a `main` (`.github/workflows/build.yml`) y lo publica en Releases.
