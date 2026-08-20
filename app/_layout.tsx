import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { TouchableOpacity, View } from "react-native";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme, useThemeMode } from "../lib/theme";
import { getUserName, getTasks } from "../lib/storage";
import { initDatabase } from "../lib/storage/db";
import OnboardingScreen from "../components/layout/OnboardingScreen";
import DrawerMenu from "../components/layout/DrawerMenu";
import AnimatedSplash from "../components/layout/AnimatedSplash";
import { NotificationProvider } from "../components/layout/NotificationContext";
import { setRestartListener } from "../lib/app-restart";
import NotificationBanner from "../components/layout/NotificationBanner";
import { AlertProvider } from "../components/ui/AlertModal";
import { KeyboardProvider } from "../components/ui/KeyboardAvoiding";
import HintSheet from "../components/ui/HintSheet";
import { configureNotificationHandler, rescheduleAllReminders } from "../lib/notifications/taskReminders";
import { loadNotifications } from "../lib/notifications/loader";
import { requestPermissionsOnFirstLaunch } from "../lib/permissions";
import { runDatabaseMaintenance } from "../lib/storage/backup";
import { syncNavigationBarButtons } from "../lib/native/navigationBar";

const DrawerContext = createContext<{ open: () => void }>({ open: () => {} });

function MenuButton() {
  const colors = useTheme();
  const { open } = useContext(DrawerContext);
  return (
    <TouchableOpacity
      onPress={open}
      style={{ paddingLeft: 16, paddingRight: 8, paddingVertical: 4 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="menu" size={24} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

export default function RootLayout() {
  // Tras un borrado de datos, el resetKey remonta todo el arbol (providers
  // incluidos) y la app arranca de nuevo con la base de datos ya limpia.
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    setRestartListener(() => setResetKey((k) => k + 1));
    return () => setRestartListener(null);
  }, []);

  return (
    <KeyboardProvider key={resetKey}>
      <ThemeProvider>
        <NotificationProvider>
          <AlertProvider>
            <RootContent />
          </AlertProvider>
        </NotificationProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

// Gestiona el flujo inicial: onboarding, splash y tabs autenticadas.
function RootContent() {
  const colors = useTheme();
  const { isDark } = useThemeMode();
  const [userName, setUserName] = useState<string | null | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashMounted, setSplashMounted] = useState(true);
  const splashStartRef = useRef(Date.now());
  const notificationResponseRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let sub: { remove: () => void } | null = null;
    void (async () => {
      const Notifications = await loadNotifications();
      if (!Notifications || disposed) return;
      void configureNotificationHandler();
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        if (data?.screen === "tasks") {
          // Navegar a tareas al tocar la notificacion.
          // setTimeout para que el navigation container termine de montarse.
          setTimeout(() => {
            router.push("/tasks");
          }, 500);
        }
      });
    })();

    return () => {
      disposed = true;
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    initDatabase()
      .then(() => runDatabaseMaintenance())
      .then(() => getUserName())
      .then((name) => {
        setUserName(name ?? null);
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!ready || notificationResponseRef.current) return;
    notificationResponseRef.current = true;
    getTasks().then((tasks) => rescheduleAllReminders(tasks)).catch((err: unknown) => console.error("rescheduleAllReminders failed", err));
  }, [ready]);

  // Pedir todos los permisos runtime al primer arranque con sesión (SMS,
  // notificaciones, calendario y fotos). El flag en SQLite evita repetir.
  useEffect(() => {
    if (!ready || !userName) return;
    requestPermissionsOnFirstLaunch();
  }, [ready, userName]);

  // Garantiza que el splash se vea al menos 1500ms para evitar un parpadeo
  // cuando la DB se inicializa muy rapido (ej. en caliente con HMR).
  // `ready` se activa cuando initDatabase + getUserName terminan.
  useEffect(() => {
    if (!ready) {
      return;
    }

    const minDurationMs = 1500;
    const elapsed = Date.now() - splashStartRef.current;
    const remaining = Math.max(0, minDurationMs - elapsed);
    const timer = setTimeout(() => setSplashVisible(false), remaining);

    return () => clearTimeout(timer);
  }, [ready]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const statusBarStyle = isDark ? "light" : "dark";

  // Sincroniza el color de los botones de la barra de navegación con el tema
  // actual (oscuro => botones claros, claro => botones oscuros).
  useEffect(() => {
    syncNavigationBarButtons(isDark);
  }, [isDark]);

  let content: ReactNode;

  if (userName === undefined) {
    content = <View style={{ flex: 1, backgroundColor: colors.background }} />;
  } else if (userName === null) {
    content = <OnboardingScreen onComplete={(name) => setUserName(name)} />;
  } else {
    content = (
      <>
        <Tabs
          screenOptions={{
            tabBarStyle: { display: "none" },
            headerStyle: {
              backgroundColor: colors.surface,
            },
            headerShadowVisible: false,
            headerTintColor: colors.textPrimary,
            headerTitleStyle: {
              fontWeight: "600",
              fontSize: 17,
            },
            headerLeft: () => <MenuButton />,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Inicio",
              // Boton transparente a la tienda/personalizacion, junto a donde
              // viven los iconos de hint en las demas pestañas.
              headerRight: () => (
                <TouchableOpacity
                  onPress={() => router.push("/shop")}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingLeft: 8, paddingRight: 16, paddingVertical: 4 }}
                >
                  <Ionicons name="storefront" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              ),
            }}
          />
          <Tabs.Screen
            name="finance"
            options={{
              title: "Balances",
              headerRight: () => (
                <HintSheet
                  title="Balances"
                  lines={[
                    "Deslizar el gráfico o tocar Semana / Mes / Año cambia el período; las flechas permiten navegar entre fechas.",
                    "El botón + agrega un gasto, un ingreso o un movimiento recurrente; tocar cualquier movimiento abre su detalle con toda la información, y mantener la tarjeta presionada lo edita.",
                    "Importar carga movimientos desde el flujo n8n o los SMS del banco; el interruptor de ahorro muestra esa línea en el gráfico.",
                  ]}
                  sections={[
                    {
                      title: "Qué se puede registrar",
                      lines: [
                        "Gastos e ingresos puntuales, y recurrentes: cobros y pagos fijos que se repiten cada mes o cada semana (sueldo, alquiler, suscripciones).",
                        "Cada movimiento pertenece a una categoría y el historial se puede filtrar por ella.",
                      ],
                    },
                    {
                      title: "Cómo funciona un recurrente",
                      lines: [
                        "Se define con un día de cobro y un mes de inicio. La app registra un movimiento automático cada mes en ese día.",
                        "Si el mes no tiene ese día (por ejemplo el 31 en febrero), el cobro cae el último día del mes.",
                        "Editar o eliminar el recurrente solo cambia el futuro: los movimientos ya registrados en meses pasados se mantienen.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: "Tareas",
              headerRight: () => (
                <HintSheet
                  title="Tareas"
                  lines={[
                    "Tocar el recuadro a la izquierda completa una tarea y otorga 10 koins.",
                    "Tocar la tarjeta muestra el detalle y sus notas vinculadas; mantenerla presionada permite editarla.",
                    "El botón + crea una tarea: si se le asigna fecha o recordatorio, la aplicación avisa automáticamente.",
                  ]}
                  sections={[
                    {
                      title: "Prioridades",
                      lines: [
                        "Cada tarea tiene una prioridad (alta, media o baja) que se marca con un punto de color en la tarjeta.",
                        "Sirven para ordenar y filtrar la vista, pero no alteran las koins: completar cualquier tarea siempre otorga 10.",
                      ],
                    },
                    {
                      title: "Filtros y búsqueda",
                      lines: [
                        "Se puede filtrar por estado (todas, pendientes o completadas) y por prioridad, además de buscar por texto.",
                        "Los accesos rápidos Hoy, Mañana y Próxima semana dejan crear tareas con fecha sin escribir nada.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="notes"
            options={{
              title: "Notas",
              headerRight: () => (
                <HintSheet
                  title="Notas"
                  lines={[
                    "Tocar una nota la abre a pantalla completa; mantenerla presionada permite editarla.",
                    "Las notas vinculadas se muestran dentro de su meta o tarea, para tener el contexto disponible al revisarlas.",
                  ]}
                  sections={[
                    {
                      title: "Tipos de notas",
                      lines: [
                        "Una nota puede ser independiente o estar vinculada a una meta o una tarea.",
                        "Vincular una nota hace que aparezca también dentro de esa meta o tarea, sin duplicarla: es la misma nota vista desde otro lugar.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="wishlist"
            options={{
              title: "Deseos",
              headerRight: () => (
                <HintSheet
                  title="Deseos"
                  lines={[
                    "Tocar una tarjeta abre el detalle del deseo y su enlace; mantenerla presionada permite editarlo.",
                    "Al pegar un enlace, la aplicación intenta completar el título, la foto y el precio automáticamente.",
                  ]}
                  sections={[
                    {
                      title: "Qué guarda un deseo",
                      lines: [
                        "Cada deseo guarda título, precio de referencia, imagen, categoría y enlace, pensado para decidir compras futuras sin perseguir el producto.",
                        "Muchas tiendas bloquean la extracción automática de datos: si algo queda incompleto, se puede escribir o corregir a mano.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="goals"
            options={{
              title: "Metas Secuenciales",
              headerRight: () => (
                <HintSheet
                  title="Metas Secuenciales"
                  lines={[
                    "Tocar una meta abre su detalle, donde se pueden registrar aportes, marcar pasos y consultar sus notas vinculadas.",
                    "Mantener presionada la tarjeta de una meta abre la barra de opciones: editar, eliminar o cambiar el orden.",
                    "Completar pasos y metas otorga koins que pueden utilizarse en la tienda de Ajustes.",
                  ]}
                  sections={[
                    {
                      title: "Tipos de meta",
                      lines: [
                        "Objetivo: un conjunto de pasos que se completan de a uno, como un plan de acción.",
                        "Ahorro: cuotas fijas semanales o mensuales hasta alcanzar un monto objetivo.",
                        "Pago: cuotas para financiar una compra, cada una con su fecha de vencimiento.",
                        "Alcancía: aportes libres, sin cuotas obligatorias: se guarda lo que se pueda cuando se pueda.",
                      ],
                    },
                    {
                      title: "Cómo se comportan las cuotas",
                      lines: [
                        "En una alcancía por periodos, una cuota vencida sin pagar no se pierde: su aporte se reparte entre las cuotas restantes, con una notificación de aviso.",
                        "Los ahorros y pagos con periodos fijos se planifican solos: la app calcula el monto de cada cuota y la secuencia completa.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: "Ajustes",
              headerRight: () => (
                <HintSheet
                  title="Ajustes"
                  lines={[
                    "Aquí se gestiona el perfil: nombre, sincronización con n8n, tema de la app y datos. La tienda de koins es una pantalla aparte (icono de tienda en Inicio o la tarjeta Personalización).",
                  ]}
                  sections={[
                    {
                      title: "Tienda de koins",
                      lines: [
                        "Las koins se ganan completando tareas (+10), pasos o metas, y al reportar un error.",
                        "Se canjean por temas de color: cada tema tiene un costo fijo y queda equipado después de comprarlo.",
                      ],
                    },
                    {
                      title: "Sincronización con n8n",
                      lines: [
                        "Con la URL del bridge y la clave API configuradas, la app envía sus datos y recibe los que producen tus flujos de n8n.",
                        "La clave debe coincidir con la variable KIORA_API_KEY del servidor; sin coincidencia, la sincronización se rechaza.",
                      ],
                    },
                  ]}
                />
              ),
            }}
          />
          {/* Tienda: pantalla propia, oculta de la barra de pestañas. Su
              cabecera se dibuja dentro de shop.tsx (título compacto arriba). */}
          <Tabs.Screen
            name="shop"
            options={{
              href: null,
              headerShown: false,
              tabBarStyle: { display: "none" },
            }}
          />
          {/* Dev: pantalla de desarrollador, también oculta de las pestañas.
              Se abre desde el trigger invisible del footer de Ajustes. */}
          <Tabs.Screen
            name="dev"
            options={{
              href: null,
              headerShown: false,
              tabBarStyle: { display: "none" },
            }}
          />
        </Tabs>
        <DrawerMenu
          visible={drawerOpen}
          onClose={closeDrawer}
        />
      </>
    );
  }

  return (
    <DrawerContext.Provider value={{ open: openDrawer }}>
      <StatusBar style={statusBarStyle} />
      {content}
      <NotificationBanner />
      {splashMounted ? (
        <AnimatedSplash
          onHidden={() => setSplashMounted(false)}
        />
      ) : null}
    </DrawerContext.Provider>
  );
}

