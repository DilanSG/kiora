// QA: seed de datos, estadísticas de la DB, desbloqueo de tienda,
// metadatos y sincronización. Se abre desde el trigger del footer de Ajustes.
import { useEffect, useState, useCallback } from "react";
import { View, StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, BackHandler } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "../lib/theme";
import AppText from "../components/ui/AppText";
import { runDevSeed, DevSeedKind } from "../lib/dev/seed";
import { requestAppRestart } from "../lib/app-restart";
import { getDataCounts } from "../lib/storage/helpers";
import { awardPoints, getUserPoints } from "../lib/storage";
import { unlockAllStyles, areAllStylesUnlocked } from "../lib/storage/unlock-all";
import { fetchLinkMetadata, LinkMetadata } from "../lib/storage/wishlist";
import { syncFromN8n, getSyncConfig } from "../lib/storage/sync";

// Clave de acceso a la vista (solo en la app, sin backend).
const DEV_PASSWORD = "IntoDev2026";

// Plantillas de seed disponibles: solo la descripción del perfil, sin nombre
// de persona, para que la card no revele un personaje.
const SEED_TEMPLATES: { kind: DevSeedKind; icon: keyof typeof Ionicons.glyphMap; desc: string }[] = [
  { kind: "parttime", icon: "school-outline", desc: "Vive solo en Bogotá y trabaja los fines de semana." },
  { kind: "supported", icon: "people-outline", desc: "Estudiante con apoyo mensual de su familia." },
  { kind: "worker", icon: "briefcase-outline", desc: "Asalariado soltero viviendo en Bogotá." },
  { kind: "fellowship", icon: "ribbon-outline", desc: "Maestría con beca y asistente de docencia." },
  { kind: "technical", icon: "construct-outline", desc: "Técnico con prácticas y emprendimiento propio." },
];

export default function DevScreen() {
  const colors = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();

  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  const [selectedKind, setSelectedKind] = useState<DevSeedKind>("parttime");
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [shopUnlocked, setShopUnlocked] = useState<boolean | null>(null);
  const [busyShop, setBusyShop] = useState(false);
  // Saldo actual tras sumar koins: con leerlo de la DB se ve al instante si
  // la escritura persistió (el "no se dieron" solía ser la tienda con saldo
  // viejo por el useEffect de mount).
  const [shopKoins, setShopKoins] = useState<number | null>(null);

  const [metaUrl, setMetaUrl] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaResult, setMetaResult] = useState<LinkMetadata | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncUrl, setSyncUrl] = useState<string | null>(null);
  const [syncHasKey, setSyncHasKey] = useState(false);

  // Volver con el boton fisico también cierra la vista (igual que shop).
  const goBack = useCallback(() => {
    router.back();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack]);

  useEffect(() => {
    areAllStylesUnlocked().then(setShopUnlocked);
    getSyncConfig().then((cfg) => {
      setSyncUrl(cfg.url || null);
      setSyncHasKey(!!cfg.key);
    });
  }, []);

  function handleUnlock() {
    if (password === DEV_PASSWORD) {
      setUnlocked(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  }

  async function handleSeed() {
    if (seeding) return;
    setSeeding(true);
    setSeedError(null);
    try {
      await runDevSeed(selectedKind);
      // Re-monta todo el arbol (como al borrar datos) para que el home y las
      // demas pantallas muestren la data nueva sin navegar manualmente.
      setTimeout(() => requestAppRestart(), 400);
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : "Error inesperado");
      setSeeding(false);
    }
  }

  async function handleCountData() {
    setLoadingStats(true);
    try {
      const counts = await getDataCounts("all");
      setStats(counts);
    } finally {
      setLoadingStats(false);
    }
  }

  async function handleUnlockShop() {
    if (busyShop) return;
    setBusyShop(true);
    try {
      await unlockAllStyles();
      setShopUnlocked(await areAllStylesUnlocked());
    } finally {
      setBusyShop(false);
    }
  }

  async function handleAddKoins() {
    if (busyShop) return;
    setBusyShop(true);
    try {
      await awardPoints(10000);
      setShopKoins(await getUserPoints());
    } finally {
      setBusyShop(false);
    }
  }

  async function handleTestMeta() {
    if (metaLoading) return;
    setMetaLoading(true);
    setMetaResult(null);
    setMetaError(null);
    try {
      setMetaResult(await fetchLinkMetadata(metaUrl.trim()));
    } catch (err: unknown) {
      setMetaError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setMetaLoading(false);
    }
  }

  async function handleSyncNow() {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncMsg(null);
    setSyncError(null);
    try {
      const imported = await syncFromN8n();
      setSyncMsg(`Sincronización completa: ${imported} movimientos importados.`);
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setSyncBusy(false);
    }
  }

  function renderSection(label: string) {
    return <AppText style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</AppText>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        {/* Header compacto: volver y titulo, igual que la tienda. */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <AppText style={[styles.title, { color: colors.textPrimary }]}>Opciones de desarrollador</AppText>
          <View style={{ flex: 1 }} />
        </View>

        {!unlocked ? (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
            <AppText style={[styles.passwordLabel, { color: colors.textSecondary }]}>
              Ingresa la clave de desarrollador para continuar.
            </AppText>
            <TextInput
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setPasswordError(false);
              }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="Clave de desarrollador"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.passwordInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: passwordError ? colors.error : colors.border,
                  color: colors.textPrimary,
                },
              ]}
              onSubmitEditing={handleUnlock}
              returnKeyType="go"
            />
            {passwordError ? (
              <AppText style={[styles.passwordError, { color: colors.error }]}>Clave incorrecta.</AppText>
            ) : null}
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={handleUnlock}>
              <AppText style={styles.btnText}>Entrar</AppText>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
            <AppText style={[styles.hint, { color: colors.textSecondary }]}>
              Herramientas para probar la app sin crear datos a mano. Los cambios se reflejan al navegar entre pestañas.
            </AppText>

            {renderSection("Datos de prueba")}

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {SEED_TEMPLATES.map((tpl) => {
                const selected = tpl.kind === selectedKind;
                return (
                  <TouchableOpacity
                    key={tpl.kind}
                    onPress={() => setSelectedKind(tpl.kind)}
                    style={[
                      styles.templateCard,
                      {
                        backgroundColor: selected ? colors.primary + "14" : colors.background,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Ionicons name={tpl.icon} size={18} color={selected ? colors.primary : colors.textSecondary} />
                    <View style={styles.optionInfo}>
                      <AppText style={[styles.optionTitle, { color: colors.textPrimary }]}>{tpl.desc}</AppText>
                    </View>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "ellipse-outline"}
                      size={18}
                      color={selected ? colors.primary : colors.border}
                    />
                  </TouchableOpacity>
                );
              })}
              {seedError ? <AppText style={[styles.error, { color: colors.error }]}>{seedError}</AppText> : null}
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={handleSeed}
                disabled={seeding}
              >
                {seeding ? (
                  <ActivityIndicator size="small" color="#FAF8F5" />
                ) : (
                  <AppText style={styles.btnText}>Poblar perfil y reiniciar</AppText>
                )}
              </TouchableOpacity>
            </View>

            {renderSection("Base de datos")}

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <AppText style={[styles.optionDesc, { color: colors.textSecondary }]}>
                Conteo de registros por tabla para validar seeds y limpiezas.
              </AppText>
              <TouchableOpacity
                style={[styles.btnGhost, { borderColor: colors.border }]}
                onPress={handleCountData}
                disabled={loadingStats}
              >
                {loadingStats ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <AppText style={[styles.btnGhostText, { color: colors.primary }]}>Contar registros</AppText>
                )}
              </TouchableOpacity>
              {stats ? (
                <View style={styles.statsGrid}>
                  {Object.entries(stats).map(([label, value]) => (
                    <View key={label} style={styles.statRow}>
                      <AppText style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</AppText>
                      <AppText style={[styles.statValue, { color: colors.textPrimary }]}>{value}</AppText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {renderSection("Tienda y koins")}

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.shopRow}>
                <View style={styles.optionInfo}>
                  <AppText style={[styles.optionTitle, { color: colors.textPrimary }]}>Desbloquear toda la tienda</AppText>
                  <AppText style={[styles.optionDesc, { color: colors.textSecondary }]}>
                    {shopUnlocked === null
                      ? "Verificando estado…"
                      : shopUnlocked
                        ? "Todas las tiendas están desbloqueadas."
                        : "Las tiendas aún tienen artículos bloqueados."}
                  </AppText>
                </View>
                <TouchableOpacity
                  style={[styles.smallBtn, { borderColor: colors.primary }]}
                  onPress={handleUnlockShop}
                  disabled={busyShop || shopUnlocked === true}
                >
                  {busyShop ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <AppText style={[styles.smallBtnText, { color: colors.primary }]}>
                      {shopUnlocked === true ? "Ya está" : "Desbloquear"}
                    </AppText>
                  )}
                </TouchableOpacity>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.shopRow}>
                <View style={styles.optionInfo}>
                  <AppText style={[styles.optionTitle, { color: colors.textPrimary }]}>Sumar koins</AppText>
                  <AppText style={[styles.optionDesc, { color: colors.textSecondary }]}>Agrega 10.000 koins para comprar sin esperar tareas.{shopKoins !== null ? ` Saldo actual: ${shopKoins}.` : ""}</AppText>
                </View>
                <TouchableOpacity
                  style={[styles.smallBtn, { borderColor: colors.primary }]}
                  onPress={handleAddKoins}
                  disabled={busyShop}
                >
                  <AppText style={[styles.smallBtnText, { color: colors.primary }]}>+10 000</AppText>
                </TouchableOpacity>
              </View>
            </View>

            {renderSection("Metadatos de enlace")}

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <AppText style={[styles.optionDesc, { color: colors.textSecondary }]}>
                Prueba el completado automático de deseos (noembed) con una URL cualquiera.
              </AppText>
              <TextInput
                value={metaUrl}
                onChangeText={setMetaUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://…"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.passwordInput,
                  { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary },
                ]}
              />
              <TouchableOpacity
                style={[styles.btnGhost, { borderColor: colors.border }]}
                onPress={handleTestMeta}
                disabled={metaLoading || !metaUrl.trim()}
              >
                {metaLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <AppText style={[styles.btnGhostText, { color: colors.primary }]}>Probar</AppText>
                )}
              </TouchableOpacity>
              {metaError ? <AppText style={[styles.error, { color: colors.error }]}>{metaError}</AppText> : null}
              {metaResult ? (
                <View style={styles.statsGrid}>
                  <View style={styles.statRow}>
                    <AppText style={[styles.statLabel, { color: colors.textSecondary }]}>título</AppText>
                    <AppText style={[styles.statValue, { color: colors.textPrimary }]} numberOfLines={1}>
                      {metaResult.title ?? "—"}
                    </AppText>
                  </View>
                  <View style={styles.statRow}>
                    <AppText style={[styles.statLabel, { color: colors.textSecondary }]}>precio</AppText>
                    <AppText style={[styles.statValue, { color: colors.textPrimary }]}>
                      {metaResult.price != null ? metaResult.price.toLocaleString("es-CO") : "—"}
                    </AppText>
                  </View>
                  <View style={styles.statRow}>
                    <AppText style={[styles.statLabel, { color: colors.textSecondary }]}>imagen</AppText>
                    <AppText style={[styles.statValue, { color: colors.textPrimary }]} numberOfLines={1}>
                      {metaResult.image ? "sí" : "—"}
                    </AppText>
                  </View>
                  {metaResult.description ? (
                    <AppText style={[styles.optionDesc, { color: colors.textSecondary }]} numberOfLines={2}>
                      {metaResult.description}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </View>

            {renderSection("Sincronización")}

            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <AppText style={[styles.optionDesc, { color: colors.textSecondary }]}>
                {syncUrl
                  ? `Bridge: ${syncUrl} · clave ${syncHasKey ? "configurada" : "sin clave"}`
                  : "Bridge sin configurar: ve a Ajustes → Sincronización."}
              </AppText>
              <TouchableOpacity
                style={[styles.btnGhost, { borderColor: colors.border }]}
                onPress={handleSyncNow}
                disabled={syncBusy}
              >
                {syncBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <AppText style={[styles.btnGhostText, { color: colors.primary }]}>Sincronizar ahora</AppText>
                )}
              </TouchableOpacity>
              {syncMsg ? <AppText style={[styles.success, { color: colors.success }]}>{syncMsg}</AppText> : null}
              {syncError ? <AppText style={[styles.error, { color: colors.error }]}>{syncError}</AppText> : null}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    safe: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    backBtn: {
      paddingRight: 4,
    },
    title: {
      fontSize: 17,
      fontWeight: "700",
    },
    scroll: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    hint: {
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 14,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 8,
      marginTop: 8,
    },
    card: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
      gap: 10,
    },
    templateCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
    },
    optionInfo: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    optionTitle: {
      fontSize: 14,
      fontWeight: "600",
    },
    optionDesc: {
      fontSize: 12,
      lineHeight: 17,
    },
    passwordLabel: {
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 10,
    },
    passwordInput: {
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 14,
      fontSize: 14,
    },
    passwordError: {
      fontSize: 13,
    },
    error: {
      fontSize: 13,
    },
    success: {
      fontSize: 13,
    },
    btn: {
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 2,
    },
    btnText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#FAF8F5",
    },
    btnGhost: {
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 10,
      alignItems: "center",
    },
    btnGhostText: {
      fontSize: 14,
      fontWeight: "600",
    },
    smallBtn: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minWidth: 96,
      alignItems: "center",
    },
    smallBtnText: {
      fontSize: 13,
      fontWeight: "600",
    },
    shopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    divider: {
      height: 1,
    },
    statsGrid: {
      gap: 6,
      marginTop: 2,
    },
    statRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    statLabel: {
      fontSize: 13,
      flexShrink: 1,
    },
    statValue: {
      fontSize: 13,
      fontWeight: "600",
      flexShrink: 1,
    },
  });
}