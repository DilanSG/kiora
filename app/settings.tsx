import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Dimensions,
} from "react-native";
import { useState, useEffect, useCallback, useRef } from "react";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  clearAllData,
  getSyncConfig,
  setSyncConfig,
  syncFromN8n,
  getUserName,
  setUserName,
  clearStyleData,
  clearFinanceData,
  getDataCounts,
  flushMaterializeChain,
  getUserPoints,
} from "../lib/storage";
import { hasRedeemedSecretCode, redeemSecretCode } from "../lib/storage/helpers";
import { KoinIcon } from "../components/brand/KoinIcon";
import { useTheme, useThemeMode, useThemeShop, useBackgroundShop, useButtonColorShop, useChartColorShop, useMovementLayerShop, useGlowShop, useGlow, ThemeColors, ThemeMode } from "../lib/theme";
import { getStyles } from "../lib/settings-styles";
import { APP_INFO } from "../constants";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import AppText from "../components/ui/AppText";
import GlowView from "../components/ui/GlowView";
import { useAlert } from "../components/ui/AlertModal";
import { requestAppRestart } from "../lib/app-restart";
import { openDevMenu } from "../components/dev/DevMenu";
import { clearReadNotifications, deleteOldNotifications } from "../lib/storage/notifications";
import { useSafeBottom } from "../hooks/useSafeBottom";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Claro", icon: "sunny" },
  { value: "system", label: "Sistema", icon: "contrast" },
  { value: "dark", label: "Oscuro", icon: "moon" },
];

export default function SettingsScreen() {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const { mode, setMode, isDark } = useThemeMode();
  const { activeVariantId, purchasedIds, equipTheme, purchaseTheme, refreshPurchased, allThemes } = useThemeShop();
  const {
    activeBackgroundId,
    purchasedBackgroundIds,
    equipBackground,
    purchaseBackground: purchaseBg,
    refreshPurchasedBackgrounds,
    allBackgrounds,
  } = useBackgroundShop();
  const { activeButtonColorId, purchasedButtonColorIds, setButtonColor, purchaseButtonColor, claimFreePoints, freePointsClaimed, refreshPurchasedButtonColors, allButtonColors } = useButtonColorShop();
  const chart = useChartColorShop();
  const { showAlert } = useAlert();
  const movement = useMovementLayerShop();
  const glow = useGlowShop();
  const glowColor = (id: string) =>
    id === "auto" ? colors.primary : glow.allGlowPresets.find((g) => g.id === id)?.color || colors.primary;
  const activeBtnPreset = allButtonColors.find((b) => b.id === activeButtonColorId);
  const activeBtnColorValue = activeBtnPreset?.primary || colors.primary;
  const { glowStyle } = useGlow();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const hasActiveProps =
    activeVariantId !== "default" ||
    (activeBackgroundId && activeBackgroundId !== "flat") ||
    mode === "light" || mode === "dark" ||
    activeButtonColorId !== "default" ||
    chart.activeChartColorId !== "default" ||
    movement.movementLayerId !== "none" ||
    glow.glowId !== "none";

  const { width: SCREEN_WIDTH } = Dimensions.get("window");
  const CARD_GAP = 8;
  const SIDE_PADDING = 12;
  // Las fórmulas restan n*gap (un gap extra) para que ninguna fila desborde
  // por redondeo fraccionario; justifyContent space-between reabsorbe ese
  // espacio y expande cada fila al ancho real de la pantalla.
  const CARD_W = (SCREEN_WIDTH - SIDE_PADDING * 2 - CARD_GAP * 5) / 5;
  const COLOR_CARD_SIZE = (SCREEN_WIDTH - 24 - 48) / 7;
  // El grid de brillos usa la misma medida que el de color secundario (gap 6,
  // mismo tamaño de tarjeta) para llenar el ancho sin desbordar por redondeo.
  const GLOW_CARD_SIZE = COLOR_CARD_SIZE;
  const CHART_CARD_SIZE = (SCREEN_WIDTH - 24 - 30) / 5;

  const styles = getStyles(colors, COLOR_CARD_SIZE, CHART_CARD_SIZE, GLOW_CARD_SIZE, bottomPad);

  const [syncUrl, setSyncUrl] = useState("");
  const [syncKey, setSyncKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savedName, setSavedName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // El perfil muestra el nombre en grande; recién al tocar el lápiz se
  // despliega el input de edición.
  const [editingName, setEditingName] = useState(false);

  const [unlockVisible, setUnlockVisible] = useState(false);
  const [codeParts, setCodeParts] = useState(["", "", "", ""]);
  // Un solo Modal con dos pasos: "code" (4 pares) y "reward" (badge + "+2000").
  // Cambiar de paso sin cerrar/reabrir el Modal evita la carrera de Dialogs
  // de Android, que hacía aparecer el segundo modal lento o sin recibir toques.
  const [unlockStep, setUnlockStep] = useState<"code" | "reward">("code");
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);
  const [rewardKoins, setRewardKoins] = useState(0);
  // Modal de aviso cuando el código ya fue canjeado antes.
  const [alreadyVisible, setAlreadyVisible] = useState(false);
  // Flag cacheado del canje para que el toque al footer responda al instante,
  // sin esperar una consulta a la DB en cada tap.
  const [secretRedeemed, setSecretRedeemed] = useState<boolean | null>(null);
  const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);
  const [deletePlan, setDeletePlan] = useState<"styles" | "finance" | "all" | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<Record<string, number>>({});
  const [deleteFinalKind, setDeleteFinalKind] = useState<"styles" | "finance" | "all">("all");
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [syncExpanded, setSyncExpanded] = useState(false);
  // Indica si hay config de sincronización cargada (URL o API Key) para el indicador del acordeón.
  const syncConfigured = Boolean(syncUrl.trim() || syncKey.trim());
  const codeInputsRef = useRef<Array<TextInput | null>>([]);

  // Al volver de la Tienda (/shop) las compras y equipamientos recién hechos
  // quedan en la DB: refrescar las seis tiendas para que esta pantalla las vea.
  // Deps SOLO con las funciones estables: chart/movement/glow son objetos que
  // el ThemeProvider recrea en cada render, y meterlos aquí disparaba un bucle
  // infinito (effect -> setPurchasedIds -> re-render -> effect) con lecturas
  // eternas de settings en la cola de la DB.
  useFocusEffect(
    useCallback(() => {
      refreshPurchased();
      refreshPurchasedBackgrounds();
      refreshPurchasedButtonColors();
      chart.refreshPurchasedChartColors();
      movement.refreshPurchasedMovementLayers();
      glow.refreshPurchasedGlow();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshPurchased, refreshPurchasedBackgrounds, refreshPurchasedButtonColors])
  );

  useEffect(() => {
    getSyncConfig().then(({ url, key }) => {
      setSyncUrl(url);
      setSyncKey(key);
    });
    getUserName().then((name) => {
      const value = name ?? "";
      setSavedName(value);
      setNameInput(value);
    });
    hasRedeemedSecretCode().then(setSecretRedeemed);
  }, []);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      showAlert("Atención", "El nombre no puede estar vacío.");
      return;
    }
    if (trimmed === savedName) return;
    setSavingName(true);
    try {
      await setUserName(trimmed);
      setSavedName(trimmed);
      setEditingName(false);
      showAlert("Listo", "Nombre actualizado.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido.";
      showAlert("Error", msg);
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveSyncConfig = async () => {
    try {
      await setSyncConfig(syncUrl, syncKey);
      const hasConfig = Boolean(syncUrl.trim() || syncKey.trim());
      showAlert("Listo", hasConfig ? "Configuración guardada." : "Configuración eliminada.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido.";
      showAlert("Error", msg);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const count = await syncFromN8n();
      showAlert("Sincronizado", count > 0 ? `${count} gasto(s) importados.` : "No hay gastos pendientes.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido.";
      showAlert("Error", msg);
    } finally {
      setSyncing(false);
    }
  };

  const openDeleteList = async (kind: "styles" | "finance" | "all") => {
    setDeleteSheetVisible(false);
    setDeletePlan(kind);
    setDeleteCounts(await getDataCounts(kind));
    setDeleteFinalKind(kind);
  };

  const closeDeleteList = () => setDeletePlan(null);

  const askDeleteConfirm = () => {
    setDeletePlan(null);
    setDeleteConfirmVisible(true);
  };

  const executeDelete = async () => {
    setDeleting(true);
    // Progreso visible desde el primer instante: sin esto, mientras el flush
    // de materializaciones corre el modal solo muestra "Borrando..." y parece
    // congelado. El paso 0 (Preparando) da feedback antes del primer DELETE.
    const totalSteps = deleteFinalKind === "styles" ? 8 : deleteFinalKind === "finance" ? 3 : 13;
    setDeleteProgress({ label: "Preparando…", done: 0, total: totalSteps });
    try {
      // Espera a que terminen las materializaciones de recurrentes en vuelo
      // (acotado a 4s: si tardan más, el retry de "database is locked" de la
      // cola de la DB cubre el lock y el borrado continúa igual).
      await Promise.race([
        flushMaterializeChain(),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
      const reportProgress = (p: { label: string; done: number; total: number }) => setDeleteProgress(p);
      if (deleteFinalKind === "styles") {
        await clearStyleData(reportProgress);
        await Promise.all([
          refreshPurchased(),
          refreshPurchasedBackgrounds(),
          refreshPurchasedButtonColors(),
          chart.refreshPurchasedChartColors(),
          movement.refreshPurchasedMovementLayers(),
          glow.refreshPurchasedGlow(),
        ]);
      } else if (deleteFinalKind === "finance") {
        await clearFinanceData(reportProgress);
      } else {
        await clearAllData(reportProgress);
        // Los puntos vuelven a 0 en la DB; al reiniciar la app los hooks lo reflejan.
      }
      setDeleteConfirmVisible(false);
      // La app se remonta entera (providers + navegación) para que la UI
      // relea la base de datos ya limpia, como si se acabara de abrir.
      requestAppRestart();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error desconocido.";
      showAlert("Error", msg);
      setDeleting(false);
      setDeleteProgress(null);
    }
  };

  const handleClearReadNotifications = () => {
    showAlert("Limpiar notificaciones", "¿Borrar todas las notificaciones leídas?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar",
        style: "destructive",
        onPress: async () => {
          try {
            await clearReadNotifications();
            showAlert("Listo", "Notificaciones leídas eliminadas.");
          } catch (e: unknown) {
            showAlert("Error", e instanceof Error ? e.message : "Error desconocido.");
          }
        },
      },
    ]);
  };

  const handlePurgeOldNotifications = () => {
    showAlert("Limpiar antiguas", "¿Borrar las notificaciones de hace más de 30 días?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteOldNotifications(30);
            showAlert("Listo", "Notificaciones antiguas eliminadas.");
          } catch (e: unknown) {
            showAlert("Error", e instanceof Error ? e.message : "Error desconocido.");
          }
        },
      },
    ]);
  };

  // Cierra el modal del código y deja el paso en "code" para la próxima vez.
  const closeUnlock = () => {
    setUnlockVisible(false);
    setUnlockStep("code");
    setCodeParts(["", "", "", ""]);
    setCollected(false);
  };

  // Código secreto: 4 pares de 2 dígitos -> "17-13-14-08". En el acierto no
  // canjea aún: cambia al paso de recompensa y el botón "+2000" entrega los
  // koins (así cerrar con X no gasta el canje único). El swap es inmediato:
  // la badge se rellena en segundo plano para que el modal no espere a la DB.
  const handleUnlockSubmit = async () => {
    const t0 = Date.now();
    const joined = codeParts.join("");
    if (joined.length !== 8) {
      showAlert("Código incompleto", "Completá los 4 números de 2 dígitos.");
      return;
    }
    if (joined !== "17131408") {
      showAlert("Código incorrecto", "Ese código no es válido.");
      setCodeParts(["", "", "", ""]);
      return;
    }
    setCodeParts(["", "", "", ""]);
    setRewardKoins(-1); // placeholder: la badge muestra "..." hasta cargar
    setUnlockStep("reward");
    const t1 = Date.now();
    console.log(`[unlock] swap reward en ${t1 - t0}ms`);
    getUserPoints()
      .then((pts) => setRewardKoins(pts))
      .catch(() => setRewardKoins(0));
    const t2 = Date.now();
    console.log(`[unlock] getUserPoints resuelto en ${t2 - t1}ms`);
  };

  // El botón "+2000" del paso de recompensa: entrega los koins con feedback
  // inmediato (la badge suma al instante y se marca como canjeado). Si el
  // canje falla, se revierte el total y se avisa. Cerrar con la X antes no
  // entrega nada y el canje único queda intacto.
  const handleCollectKoins = async () => {
    if (collecting || collected) return;
    setCollecting(true);
    const prev = rewardKoins;
    setRewardKoins((k) => (k >= 0 ? k + 2000 : 2000));
    setCollected(true);
    setSecretRedeemed(true);
    try {
      await redeemSecretCode(2000);
      console.log("[unlock] redeemSecretCode ok");
    } catch (e: unknown) {
      setRewardKoins(prev);
      setCollected(false);
      setSecretRedeemed(false);
      showAlert("Error", e instanceof Error ? e.message : "Error desconocido.");
    } finally {
      setCollecting(false);
    }
  };

  const handleCodeChange = (index: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 2);
    const next = [...codeParts];
    next[index] = digits;
    setCodeParts(next);
    if (digits.length === 2 && index < 3) {
      codeInputsRef.current[index + 1]?.focus();
    }
  };

  // El código secreto se puede canjear una sola vez. Con el flag cacheado el
  // toque responde al instante: si ya se usó, sale el modal de aviso sin
  // volver a pedir el código; si no, abre el input. Solo si el flag aún no
  // cargó (primer tap muy temprano) se consulta la DB en el momento.
  const handleFooterTap = useCallback(async () => {
    const redeemed = secretRedeemed ?? (await hasRedeemedSecretCode());
    if (redeemed) {
      setAlreadyVisible(true);
    } else {
      setUnlockVisible(true);
    }
  }, [secretRedeemed]);

  return (
    <View style={styles.container}>
      <BackgroundDecor colors={colors} screenVariant={5} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Perfil */}
        <GlowView style={styles.profileSection} cardRadius={12}>
          {editingName ? (
            <View style={[styles.profileField, styles.profileFieldEditing]}>
              <AppText style={styles.profileLabel}>Nombre de Usuario</AppText>
              <View style={styles.nameRow}>
                <TextInput
                  style={styles.nameInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Usuario..."
                  placeholderTextColor={colors.textSecondary}
                  maxLength={20}
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleSaveName}
                />
                <TouchableOpacity
                  style={[
                    styles.nameSaveBtn,
                    (savingName || !nameInput.trim() || nameInput.trim() === savedName) &&
                      styles.nameSaveBtnDisabled,
                  ]}
                  onPress={handleSaveName}
                  disabled={savingName || !nameInput.trim() || nameInput.trim() === savedName}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={savingName ? "hourglass-outline" : "checkmark"}
                    size={18}
                    color={colors.surface}
                  />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.profileField, styles.profileFieldDisplay]}>
                <AppText style={styles.profileBigName} numberOfLines={1}>
                  {savedName || "Usuario"}
                </AppText>
                <AppText style={styles.profileSub}>
                  {savedName ? "Tu nombre personal en Kiora" : "Elegí cómo te mostramos en Kiora"}
                </AppText>
              </View>
              <TouchableOpacity
                style={styles.nameEditBtn}
                onPress={() => {
                  setNameInput(nameInput.trim() || savedName);
                  setEditingName(true);
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              </TouchableOpacity>
            </>
          )}
        </GlowView>

        {/* Tema de la app */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="contrast-outline" size={12} color={colors.textSecondary} />
            <AppText style={styles.sectionTitle}>Tema de la app</AppText>
          </View>
          <View style={styles.themeSelector}>
            {THEME_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.themeOption, active && styles.themeOptionActive]}
                  onPress={() => setMode(opt.value)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={opt.icon}
                    size={14}
                    color={active ? colors.surface : colors.textSecondary}
                  />
                  <AppText style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                    {opt.label}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Personalización */}
        <TouchableOpacity style={[styles.newCard, glowStyle]} onPress={() => router.push({ pathname: "/shop", params: { from: "settings" } })} activeOpacity={0.85}>
          <View style={styles.newCardHeader}>
            <View style={styles.newCardIcon}>
              <Ionicons name="color-palette-outline" size={18} color={colors.primary} />
            </View>
            <AppText style={styles.newCardTitle}>Personalización</AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
          {hasActiveProps && <View style={styles.newCardDivider} />}
          {hasActiveProps && (
            <View style={styles.newCardList}>
              {activeVariantId !== "default" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="color-palette-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Tema</AppText>
                  <AppText style={styles.newCardValue}>
                    {allThemes.find((t) => t.id === activeVariantId)?.name ?? activeVariantId}
                  </AppText>
                </View>
              )}
              {activeBackgroundId && activeBackgroundId !== "flat" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="grid-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Fondo</AppText>
                  <AppText style={styles.newCardValue}>
                    {allBackgrounds.find((b) => b.id === activeBackgroundId)?.name ?? activeBackgroundId}
                  </AppText>
                </View>
              )}
              {(mode === "light" || mode === "dark") && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name={mode === "light" ? "sunny-outline" : "moon-outline"} size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Modo</AppText>
                  <AppText style={styles.newCardValue}>{mode === "light" ? "Claro" : "Oscuro"}</AppText>
                </View>
              )}
              {activeButtonColorId !== "default" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="color-fill-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Color</AppText>
                  <AppText style={styles.newCardValue}>
                    {capitalize(activeButtonColorId)}
                  </AppText>
                </View>
              )}
              {chart.activeChartColorId !== "default" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="stats-chart-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Gráfica</AppText>
                  <AppText style={styles.newCardValue}>
                    {chart.allChartColors.find((c) => c.id === chart.activeChartColorId)?.name ?? ""}
                  </AppText>
                </View>
              )}
              {movement.movementLayerId !== "none" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="move-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Movimiento</AppText>
                  <AppText style={styles.newCardValue}>
                    {movement.allMovementLayers.find((m) => m.id === movement.movementLayerId)?.name ?? ""}
                  </AppText>
                </View>
              )}
              {glow.glowId !== "none" && (
                <View style={styles.newCardRow}>
                  <View style={[styles.newCardRowIcon, { backgroundColor: colors.primary + "12" }]}>
                    <Ionicons name="sunny-outline" size={15} color={colors.primary} />
                  </View>
                  <AppText style={styles.newCardLabel}>Brillo</AppText>
                  <AppText style={[styles.newCardValue, { color: glowColor(glow.glowId) }]}>
                    {glow.allGlowPresets.find((g) => g.id === glow.glowId)?.name ?? "Brillo"}
                  </AppText>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Sincronización n8n (acordeón) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.syncCard}
            onPress={() => setSyncExpanded((v) => !v)}
            activeOpacity={0.75}
          >
            <View style={styles.syncHeader}>
              <View style={[styles.rowIcon, { backgroundColor: colors.primary + "14" }]}>
                <Ionicons name="git-network-outline" size={17} color={colors.primary} />
              </View>
              <View style={styles.syncHeaderText}>
                <AppText style={styles.rowLabel}>Sincronización n8n</AppText>
                <View style={[styles.syncStatusPill, { backgroundColor: syncConfigured ? colors.success + "14" : colors.background, borderColor: syncConfigured ? colors.success + "38" : colors.border }]}>
                  <View style={[styles.syncStatusDot, { backgroundColor: syncConfigured ? colors.success : colors.textSecondary }]} />
                  <AppText style={[styles.syncStatusText, { color: syncConfigured ? colors.success : colors.textSecondary }]}>
                    {syncConfigured ? "Configurado" : "Sin configurar"}
                  </AppText>
                </View>
              </View>
              <Ionicons
                name={syncExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textSecondary}
              />
            </View>
          </TouchableOpacity>
          {syncExpanded && (
            <GlowView style={[styles.group, styles.syncBody]} cardRadius={12}>
              <TextInput
                style={styles.input}
                placeholder="URL del servidor (ej: http://192.168.1.10:3001)"
                placeholderTextColor={colors.textSecondary}
                value={syncUrl}
                onChangeText={setSyncUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
              <TextInput
                style={[styles.input, styles.inputLast]}
                placeholder="API Key"
                placeholderTextColor={colors.textSecondary}
                value={syncKey}
                onChangeText={setSyncKey}
                autoCapitalize="none"
                secureTextEntry
              />
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                  onPress={handleSaveSyncConfig}
                  activeOpacity={0.7}
                >
                  <Ionicons name="save-outline" size={16} color={colors.primary} />
                  <AppText style={styles.actionBtnGhostText}>Guardar</AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary, syncing && styles.actionBtnDisabled]}
                  onPress={handleSync}
                  disabled={syncing}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="sync-outline"
                    size={16}
                    color={syncing ? colors.textSecondary : colors.surface}
                  />
                  <AppText style={[styles.actionBtnPrimaryText, syncing && { color: colors.textSecondary }]}>
                    {syncing ? "Sincronizando..." : "Sincronizar"}
                  </AppText>
                </TouchableOpacity>
              </View>
            </GlowView>
          )}
        </View>

        {/* Notificaciones */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="notifications-outline" size={12} color={colors.textSecondary} />
            <AppText style={styles.sectionTitle}>Notificaciones</AppText>
          </View>
          <GlowView style={styles.group} cardRadius={12}>
            <TouchableOpacity style={styles.rowItem} onPress={handleClearReadNotifications} activeOpacity={0.6}>
              <View style={[styles.rowIcon, { backgroundColor: colors.primary + "14" }]}>
                <Ionicons name="checkmark-done-outline" size={17} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <AppText style={styles.rowLabel}>Limpiar leídas</AppText>
                <AppText style={styles.rowSub}>Borra las notificaciones que ya viste</AppText>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity style={styles.rowItem} onPress={handlePurgeOldNotifications} activeOpacity={0.6}>
              <View style={[styles.rowIcon, { backgroundColor: colors.warning + "18" }]}>
                <Ionicons name="time-outline" size={17} color={colors.warning} />
              </View>
              <View style={styles.rowText}>
                <AppText style={styles.rowLabel}>Limpiar antiguas</AppText>
                <AppText style={styles.rowSub}>Borra las de hace más de 30 días</AppText>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
          </GlowView>
        </View>

        {/* Datos */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="server-outline" size={12} color={colors.error} />
            <AppText style={styles.sectionTitle}>Datos</AppText>
          </View>
          <TouchableOpacity
            style={styles.dangerCard}
            onPress={() => setDeleteSheetVisible(true)}
            activeOpacity={0.7}
          >
            <View style={[styles.rowIcon, styles.dangerCardIcon]}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <View style={styles.rowText}>
              <AppText style={styles.dangerCardTitle}>Borrar datos</AppText>
              <AppText style={styles.dangerCardSub}>Estilos, finanzas o todo el contenido</AppText>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.error} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footerWrap}>
        <View style={styles.footerRow}>
           <AppText style={styles.footer} numberOfLines={1}> Made By</AppText>
          <TouchableOpacity onPress={handleFooterTap} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
          <AppText style={styles.footer} numberOfLines={1}> {" "}{APP_INFO.DEVELOPER} ·{" "}</AppText>
          </TouchableOpacity>
          <AppText style={styles.footer}>{APP_INFO.MAINTAINER}</AppText>
          <AppText style={styles.footer} numberOfLines={1}>{" "}· v{APP_INFO.VERSION}</AppText>
        </View>
        {/* Trigger invisible del menu de desarrollador: abajo a la derecha
            del texto "Made By", solo responde al toque en esa esquina. */}
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <TouchableOpacity
            onPress={openDevMenu}
            activeOpacity={1}
            style={styles.devTrigger}
          />
        </View>
      </View>

      {/* Bottom sheet: elegir qué datos borrar */}
      <Modal
        visible={deleteSheetVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDeleteSheetVisible(false)}
      >
        <View style={styles.deleteSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setDeleteSheetVisible(false)}
          />
          <View style={[styles.deleteSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.deleteSheetHandle} />
            <AppText style={[styles.deleteSheetTitle, { color: colors.textPrimary }]}>
              ¿Qué datos quieres borrar?
            </AppText>
            <AppText style={[styles.deleteSheetSub, { color: colors.textSecondary }]}>
              Esta acción no se puede deshacer.
            </AppText>

            <TouchableOpacity style={[styles.deleteOption, { backgroundColor: colors.primary + "10", borderColor: colors.border }]} activeOpacity={0.7} onPress={() => openDeleteList("styles")}>
              <View style={[styles.deleteOptionIcon, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="color-palette-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.deleteOptionInfo}>
                <AppText style={[styles.deleteOptionTitle, { color: colors.textPrimary }]}>Datos de estilos</AppText>
                <AppText style={[styles.deleteOptionDesc, { color: colors.textSecondary }]}>
                  Temas, fondos, colores, gráficas, movimientos, brillos y koins de la tienda
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.deleteOption, { backgroundColor: colors.accentBlue + "10", borderColor: colors.border }]} activeOpacity={0.7} onPress={() => openDeleteList("finance")}>
              <View style={[styles.deleteOptionIcon, { backgroundColor: colors.accentBlue + "18" }]}>
                <Ionicons name="wallet-outline" size={18} color={colors.accentBlue} />
              </View>
              <View style={styles.deleteOptionInfo}>
                <AppText style={[styles.deleteOptionTitle, { color: colors.textPrimary }]}>Datos de finanzas</AppText>
                <AppText style={[styles.deleteOptionDesc, { color: colors.textSecondary }]}>
                  Movimientos, categorías y movimientos recurrentes
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.deleteOption, { backgroundColor: colors.error + "10", borderColor: colors.error + "30" }]} activeOpacity={0.7} onPress={() => openDeleteList("all")}>
              <View style={[styles.deleteOptionIcon, { backgroundColor: colors.error + "18" }]}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </View>
              <View style={styles.deleteOptionInfo}>
                <AppText style={[styles.deleteOptionTitle, { color: colors.textPrimary }]}>Todos los datos</AppText>
                <AppText style={[styles.deleteOptionDesc, { color: colors.textSecondary }]}>
                  Toda la app: tareas, notas, metas, deseos, finanzas, estilos y configuración
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.deleteCancel, { borderColor: colors.border }]} activeOpacity={0.7} onPress={() => setDeleteSheetVisible(false)}>
              <AppText style={[styles.deleteCancelText, { color: colors.textPrimary }]}>Cancelar</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Vista: lista de lo que se eliminará */}
      <Modal
        visible={deletePlan !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={closeDeleteList}
      >
        <View style={[styles.shopContainer, { backgroundColor: colors.background }]}>
          <BackgroundDecor colors={colors} screenVariant={5} />
          <View style={styles.shopHeader}>
            <TouchableOpacity onPress={closeDeleteList} style={styles.shopBackBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <AppText style={styles.shopTitle}>
                {deletePlan === "styles" ? "Borrar estilos" : deletePlan === "finance" ? "Borrar finanzas" : "Borrar todo"}
              </AppText>
            </View>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </View>

          <ScrollView contentContainerStyle={styles.deleteListBody}>
            <View style={[styles.deleteSummary, { backgroundColor: colors.error + "0D", borderColor: colors.error + "30" }]}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
              <AppText style={[styles.deleteSummaryText, { color: colors.textSecondary }]}>
                Se eliminarán de forma permanente los siguientes datos de esta sección:
              </AppText>
            </View>

            {deletePlan === "styles" && (
              <>
                {[
                  { icon: "color-palette-outline" as const, label: "Temas", count: deleteCounts.temas },
                  { icon: "grid-outline" as const, label: "Fondos", count: deleteCounts.fondos },
                  { icon: "color-fill-outline" as const, label: "Colores de botones", count: deleteCounts.colores },
                  { icon: "stats-chart-outline" as const, label: "Paletas de gráficas", count: deleteCounts.graficas },
                  { icon: "move-outline" as const, label: "Movimientos visuales", count: deleteCounts.movimientos_visuales },
                  { icon: "sunny-outline" as const, label: "Brillos", count: deleteCounts.brillos },
                  { icon: "star-outline" as const, label: "Koins de la tienda (quedan en 0)", count: deleteCounts.puntos, noCount: true },
                  { icon: "bug-outline" as const, label: "Reportes visuales registrados", count: deleteCounts.reportes },
                ].map((row) => (
                  <View key={row.label} style={[styles.deleteRow, { borderColor: colors.border }]}>
                    <View style={[styles.deleteRowIcon, { backgroundColor: colors.primary + "12" }]}>
                      <Ionicons name={row.icon} size={16} color={colors.primary} />
                    </View>
                    <AppText style={[styles.deleteRowLabel, { color: colors.textPrimary }]}>{row.label}</AppText>
                    {!row.noCount && (
                      <AppText style={[styles.deleteRowCount, { color: colors.textSecondary }]}>
                        {row.count ?? 0}
                      </AppText>
                    )}
                  </View>
                ))}
              </>
            )}

            {deletePlan === "finance" && (
              <>
                {[
                  { icon: "swap-horizontal-outline" as const, label: "Movimientos (gastos e ingresos)", count: deleteCounts.movimientos },
                  { icon: "pricetags-outline" as const, label: "Categorías", count: deleteCounts.categorias },
                  { icon: "repeat-outline" as const, label: "Movimientos recurrentes", count: deleteCounts.recurrentes },
                ].map((row) => (
                  <View key={row.label} style={[styles.deleteRow, { borderColor: colors.border }]}>
                    <View style={[styles.deleteRowIcon, { backgroundColor: colors.accentBlue + "12" }]}>
                      <Ionicons name={row.icon} size={16} color={colors.accentBlue} />
                    </View>
                    <AppText style={[styles.deleteRowLabel, { color: colors.textPrimary }]}>{row.label}</AppText>
                    <AppText style={[styles.deleteRowCount, { color: colors.textSecondary }]}>{row.count ?? 0}</AppText>
                  </View>
                ))}
              </>
            )}

            {deletePlan === "all" && (
              <>
                {[
                  { icon: "checkmark-done-outline" as const, label: "Tareas", count: deleteCounts.tareas },
                  { icon: "document-text-outline" as const, label: "Notas", count: deleteCounts.notas },
                  { icon: "flag-outline" as const, label: "Metas", count: deleteCounts.metas },
                  { icon: "list-outline" as const, label: "Pasos de metas", count: deleteCounts.pasos },
                  { icon: "cash-outline" as const, label: "Cuotas y aportes", count: deleteCounts.cuotas_y_aportes },
                  { icon: "heart-outline" as const, label: "Deseos", count: deleteCounts.deseos },
                  { icon: "swap-horizontal-outline" as const, label: "Movimientos (gastos e ingresos)", count: deleteCounts.movimientos },
                  { icon: "pricetags-outline" as const, label: "Categorías", count: deleteCounts.categorias },
                  { icon: "repeat-outline" as const, label: "Movimientos recurrentes", count: deleteCounts.recurrentes },
                  { icon: "notifications-outline" as const, label: "Notificaciones de la app", count: deleteCounts.notificaciones },
                  { icon: "link-outline" as const, label: "Vínculos de notas", count: deleteCounts.vinculos },
                  { icon: "color-palette-outline" as const, label: "Estilos (temas, fondos, colores, brillos) y koins", count: deleteCounts.estilos },
                  { icon: "sync-outline" as const, label: "Sincronización (URL y clave API)", count: undefined, noCount: true },
                ].map((row) => (
                  <View key={row.label} style={[styles.deleteRow, { borderColor: colors.border }]}>
                    <View style={[styles.deleteRowIcon, { backgroundColor: colors.error + "12" }]}>
                      <Ionicons name={row.icon} size={16} color={colors.error} />
                    </View>
                    <AppText style={[styles.deleteRowLabel, { color: colors.textPrimary }]}>{row.label}</AppText>
                    {!row.noCount && (
                      <AppText style={[styles.deleteRowCount, { color: colors.textSecondary }]}>{row.count ?? 0}</AppText>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {/* Botones al fondo: volver o aceptar */}
          <View style={[styles.deleteFooter, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <TouchableOpacity style={[styles.deleteFooterBtn, { borderColor: colors.border }]} activeOpacity={0.7} onPress={closeDeleteList}>
              <Ionicons name="arrow-back" size={16} color={colors.textPrimary} />
              <AppText style={[styles.deleteFooterBtnText, { color: colors.textPrimary }]}>Volver</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.deleteFooterBtn, styles.deleteFooterBtnDanger, { backgroundColor: colors.error }]} activeOpacity={0.7} onPress={askDeleteConfirm}>
              <AppText style={[styles.deleteFooterBtnText, { color: colors.surface }]}>Aceptar</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Confirmación final del borrado */}
      <Modal
        visible={deleteConfirmVisible}
        animationType="fade"
        transparent
        onRequestClose={deleting ? () => {} : () => setDeleteConfirmVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.deleteConfirmIcon, { backgroundColor: colors.error + "14" }]}>
              <Ionicons name="trash-outline" size={28} color={colors.error} />
            </View>
            <AppText style={[styles.deleteConfirmTitle, { color: colors.textPrimary }]}>¿Confirmás el borrado?</AppText>
            <AppText style={[styles.deleteConfirmDesc, { color: colors.textSecondary }]}>
              {deleteFinalKind === "styles"
                ? "Se eliminarán los temas, fondos, colores, gráficas, movimientos, brillos y koins."
                : deleteFinalKind === "finance"
                  ? "Se eliminarán los movimientos, categorías y recurrentes."
                  : "Se eliminarán todos los datos de la app. Esta acción no se puede deshacer."}
            </AppText>

            {/* Barra de progreso en vivo: cada paso libera la cola de la DB,
                así la UI se actualiza y la app no parece congelada. */}
            {deleting && deleteProgress && (
              <View style={styles.deleteProgressWrap}>
                <View style={styles.deleteProgressRow}>
                  <AppText
                    style={[styles.deleteProgressLabel, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {deleteProgress.label}
                  </AppText>
                  <AppText style={[styles.deleteProgressPct, { color: colors.textSecondary }]}>
                    {Math.round((deleteProgress.done / deleteProgress.total) * 100)}%
                  </AppText>
                </View>
                <View style={[styles.deleteProgressTrack, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.deleteProgressFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${(deleteProgress.done / deleteProgress.total) * 100}%` as `${number}%`,
                      },
                    ]}
                  />
                </View>
                <AppText style={[styles.deleteProgressCount, { color: colors.textSecondary }]}>
                  Paso {deleteProgress.done} de {deleteProgress.total}
                </AppText>
              </View>
            )}

            <View style={styles.deleteConfirmActions}>
              <TouchableOpacity style={[styles.deleteConfirmBtn, { borderColor: colors.border }]} activeOpacity={0.7} onPress={() => setDeleteConfirmVisible(false)} disabled={deleting}>
                <AppText style={[styles.deleteConfirmBtnText, { color: colors.textPrimary }]}>Volver</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.deleteConfirmBtn, { backgroundColor: colors.error }]} activeOpacity={0.7} onPress={executeDelete} disabled={deleting}>
                {deleting ? (
                  <AppText style={[styles.deleteConfirmBtnText, { color: colors.surface }]}>Borrando...</AppText>
                ) : (
                  <AppText style={[styles.deleteConfirmBtnText, { color: colors.surface }]}>Borrar</AppText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Código de desbloqueo (tocar "IntoCode" en el footer). Un solo
          Modal con dos pasos: "code" pide los 4 pares y "reward" muestra el
          badge + botón "+2000". Cambiar de paso sin reabrir el Modal evita
          que Android apile dos Dialogs (aparecía tarde y no recibía toques). */}
      <Modal
        visible={unlockVisible}
        animationType="fade"
        transparent
        onRequestClose={closeUnlock}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={closeUnlock}
              style={styles.codeCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

            {unlockStep === "code" ? (
              <>
                <View style={styles.codeRow}>
                  {[0, 1, 2, 3].map((i) => (
                    <TextInput
                      key={i}
                      ref={(el) => {
                        codeInputsRef.current[i] = el;
                      }}
                      style={[styles.codeInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
                      keyboardType="number-pad"
                      maxLength={2}
                      value={codeParts[i]}
                      onChangeText={(t) => handleCodeChange(i, t)}
                      onKeyPress={(e) => {
                        if (e.nativeEvent.key === "Backspace" && codeParts[i] === "" && i > 0) {
                          codeInputsRef.current[i - 1]?.focus();
                        }
                      }}
                      selectTextOnFocus
                    />
                  ))}
                </View>

                <View style={styles.feedbackActions}>
                  <TouchableOpacity
                    style={[styles.feedbackBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={closeUnlock}
                  >
                    <AppText style={[styles.feedbackBtnText, { color: colors.textPrimary }]}>Cancelar</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.feedbackBtn, styles.feedbackBtnPrimary, { backgroundColor: colors.primary }]}
                    onPress={handleUnlockSubmit}
                  >
                    <AppText style={[styles.feedbackBtnText, { color: "#fff" }]}>Aceptar</AppText>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {/* Badge con los koins a la izquierda; la X queda a la derecha */}
                <View style={styles.rewardTopRow}>
                  <View style={styles.rewardBadge}>
                    <KoinIcon size={20} />
                    <AppText style={styles.rewardBadgeText}>{rewardKoins >= 0 ? rewardKoins : "..."}</AppText>
                  </View>
                </View>

                <AppText style={[styles.rewardText, { color: colors.textPrimary }]}>
                  {collected
                    ? "Listo mi vida,\n+2000 koins."
                    : "Para mi niña hermosa,\n+2000 Koins solo para ti princesa"}
                </AppText>

                <TouchableOpacity
                  style={[
                    styles.rewardClaimBtn,
                    { backgroundColor: collected ? colors.success : colors.primary },
                  ]}
                  onPress={collected ? closeUnlock : handleCollectKoins}
                  activeOpacity={0.7}
                  disabled={collecting}
                >
                  {collected ? (
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  ) : (
                    <KoinIcon size={20} color="#fff" />
                  )}
                  <AppText style={[styles.rewardClaimText, { color: "#fff" }]}>
                    {collected ? "Listo" : "+2000"}
                  </AppText>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal: aviso de que el código ya fue canjeado (el toque al footer
          solo muestra este aviso, sin volver a pedir el código). */}
      <Modal
        visible={alreadyVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setAlreadyVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setAlreadyVisible(false)}
              style={styles.codeCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

            <AppText style={[styles.rewardText, { color: colors.textPrimary }]}>
              Uy amor quiere más puntos?{"\n"}Haga cosas mejor jsjsjs
            </AppText>
          </View>
        </View>
      </Modal>
    </View>
  );
}
