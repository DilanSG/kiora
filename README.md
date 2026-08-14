<div align="center">
  <img src="./assets/icon.png" alt="Kiora Logo" width="120" height="120" />
  <h1>Kiora</h1>
  <p><strong>Keep It Organized, Right Away</strong> — panel personal local-first: tareas, notas, finanzas, deseo
s, metas y clima, donde tus hábitos reales se convierten en puntos y tus puntos en tu propia identidad visual.</p>
  <p>
    <a href="#caracteristicas">Características</a> •
    <a href="#tienda-de-personalizacion">Personalización</a> •
    <a href="#sincronizacion-con-n8n">Sincronización n8n</a> •
    <a href="#instalacion">Instalación</a> •
    <a href="#apk">APK</a> •
    <a href="#licencia">Licencia</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT" />
    <img src="https://img.shields.io/badge/platform-Android%20%7C%20iOS%20%7C%20Web-brightgreen" alt="Platforms" />
    <img src="https://img.shields.io/badge/Expo-54-blueviolet" alt="Expo SDK" />
  </p>
</div>

---

## Qué es

Kiora es una app local-first de productividad personal que **te paga por tus hábitos**: completar tareas, avanzar metas o reportar bugs genera puntos, y esos puntos se gastan en una tienda que transforma la apariencia de toda la app (temas, fondos, colores, brillos). Sin cuenta, sin nube obligatoria, sin ruido.

Todas tus tareas, notas, finanzas, deseos, metas y el clima viven en tu dispositivo (SQLite, modo WAL). La única conexión opcional es un puente self-hosted para automatizaciones de n8n.

## Características

- **Inicio** — Saludo por hora, fecha, clima actual geolocalizado (Open-Meteo, sin API key) con modal de detalle, resumen del período financiero y metas activas.
- **Balances** — Registro de ingresos y gastos por categoría, estadísticas mensuales, vistas por período y **detección automática de gastos desde SMS bancarios** (módulo nativo Android `SmsReader`: clasifica monto, tienda y fecha sin escribir nada).
- **Tareas** — Prioridades, categorías, fechas límite y recordatorios (notificación local + calendario del dispositivo), filtros y búsqueda.
- **Notas** — Notas rápidas, títulos, fijadas al inicio y **vínculos entre notas y entidades** (tarea, meta, deseo...) para contexto cruzado.
- **Deseos** — Wishlist con precio, categoría e **imagen + título obtenidos automáticamente** desde el enlace del producto.
- **Metas** — Tres modalidades (objetiva, ahorro con aportes, cuotas con fechas), pasos desbloqueables, bote de ahorro y reordenamiento manual.
- **Ajustes** — Perfil editable, tema claro/oscuro/sistema, acceso a la tienda de personalización, sincronización n8n, limpieza de notificaciones y borrado de datos con confirmación en 3 pasos.
- **Economía gamificada** — Completar tarea +10 pts, paso de meta +5 pts, meta finalizada +50 pts, reportar un problema visual +10 pts, bono de bienvenida +50 pts.
- **Onboarding y splash animados** — Logo K con gradiente responsivo al tema, órbita en movimiento y presentación de cada sección con tutoriales.

## Tienda de personalización

La exclusividad visual de Kiora: los puntos que ganás con tus hábitos se gastan en equipar estilos que se aplican a **toda** la app en tiempo real.

| Categoría | Cantidad | Ejemplos |
|---|---|---|
| Temas | 75 | Slate, Sky, Ocean, Cobalt, Lavender, Monochrome... |
| Fondos de pantalla | 20 | SVG animados: círculos, ondas, anillos, puntos, mezclas |
| Colores de botones | 58 | Tonalidades propias + modo automático |
| Pares de gráficas | 17 | Paletas para estadísticas y gráficos |
| Capas de movimiento | 17 | Ritmos visuales que se superponen a los fondos |
| Brillos (glow) | 30 | Intensidad ajustable, también modo automático |
| Combos conceptuales | 21 | Conjuntos de estilos que se equipan de un toque |

## Sincronización con n8n

Sin llegar a la nube: **vos** hosteás el puente (`api/`), una app Express que escucha en `PORT` (3001 por defecto) y requiere la variable `KIORA_API_KEY`.

| Endpoint | Método | Función |
|---|---|---|
| `/api/expense` | POST | Recibe un gasto desde una automatización de n8n |
| `/api/expense/pending` | GET | Consulta los movimientos pendientes de sincronizar |
| `/api/report` | POST | Envía un reporte por email (SendGrid) |
| `/api/health` | GET | Healthcheck del bridge |

El bridge usa autenticación `Authorization: Bearer <KIORA_API_KEY>` (comparación a prueba de timing attacks) y persiste los pendientes en `pending.json`. La app importa los gastos desde Ajustes → Sincronización n8n.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 |
| Routing | Expo Router (file-based) |
| Lenguaje | TypeScript 5.9 (strict) |
| Base de datos | SQLite con WAL (13 tablas) |
| Persistencia | expo-secure-store (API key), AsyncStorage (modo de tema) |
| Clima | expo-location + Open-Meteo |
| Recordatorios | expo-notifications + expo-calendar |
| Notificaciones | expo-notifications |
| Módulo nativo | `SmsReader` (Android, detección de gastos SMS) |
| UI | Componentes propios + @expo/vector-icons (sin emojis) |
| Bridge | Node.js + Express (self-hosted) |

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/DilanSG/Poinyta.git
cd Poinyta

# Instalar dependencias
npm install

# Iniciar en desarrollo
npx expo start
```

## APK

Armado de Android con EAS Build (perfil `preview`, genera APK de distribución interna):

```bash
npx eas build --platform android --profile preview
```

También se puede compilar localmente con el Android SDK:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# APK en android/app/build/outputs/apk/release/
```

El APK release se firma con el keystore de depuración (adecuado para distribución interna).

## Uso

1. Abre el onboarding: definí tu nombre y mirá cómo funciona cada sección.
2. El splash deja pasar a un dashboard con clima, tu período financiero y tus metas.
3. Ganá puntos completando tareas, pasos de meta y reportando problemas visuales.
4. Gastalos en la Tienda (Ajustes → Personalización): temas, fondos, colores y brillos.
5. Opcional: hosteá el bridge (`node api/server.js`) y conectá una automatización de n8n para registrar gastos.

## Desarrollo

```bash
npm run typecheck   # único gate de verificación (tsc --noEmit)
npm run android     # build nativo Android (exp run:android)
npm run ios         # build nativo iOS
npm run web         # versión web
```

Sin cuenta en la tienda: los datos personales nunca salen del dispositivo.

## Licencia

```
MIT License

Copyright (c) 2026 Dilan Acuña (IntoCode)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">
  <p>
    Desarrollado y mantenido por <strong>Dilan Acuña</strong> &mdash; Open source, libre y gratuito.
  </p>
  <p>
    <a href="https://github.com/DilanSG">DilanSG</a> •
    <a href="https://github.com/DilanSG/Poinyta/issues">Reportar un problema</a> (+10 pts)
  </p>
</div>