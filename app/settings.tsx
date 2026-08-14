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
  areAllStylesUnlocked,
  clearStyleData,
  clearFinanceData,
  getDataCounts,
} from "../lib/storage";
import { useTheme, useThemeMode, useThemeShop, useBackgroundShop, useButtonColorShop, useChartColorShop, useMovementLayerShop, useGlowShop, useGlow, useUnlockAllStyles, ThemeColors, ThemeMode } from "../lib/theme";
import { getStyles } from "../lib/settings-styles";
import { APP_INFO } from "../constants";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import AppText from "../components/ui/AppText";
import GlowView from "../components/ui/GlowView";
import { useAlert } from "../components/ui/AlertModal";
import { requestAppRestart } from "../lib/app-restart";
import { clearReadNotifications, deleteOldNotifications } from "../lib/storage/notifications";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Claro", icon: "sunny" },
  { value: "system", label: "Sistema", icon: "contrast" },
  { value: "dark", label: "Oscuro", icon: "moon" },
];

export default function SettingsScreen() {
  const colors = useTheme();
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

  const styles = getStyles(colors, COLOR_CARD_SIZE, CHART_CARD_SIZE, GLOW_CARD_SIZE);

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
  const [deleteSheetVisible, setDeleteSheetVisible] = useState(false);
  const [deletePlan, setDeletePlan] = useState<"styles" | "finance" | "all" | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<Record<string, number>>({});
  const [deleteFinalKind, setDeleteFinalKind] = useState<"styles" | "finance" | "all">("all");
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncExpanded, setSyncExpanded] = useState(false);
  // Indica si hay config de sincronización cargada (URL o API Key) para el indicador del acordeón.
  const syncConfigured = Boolean(syncUrl.trim() || syncKey.trim());
  const codeInputsRef = useRef<Array<TextInput | null>>([]);
  const unlockAllStyles = useUnlockAllStyles();

  // Al volver de la Tienda (/shop) las compras y equipamientos recién hechos
  // quedan en la DB: refrescar las seis tiendas para que esta pantalla las vea.
  useFocusEffect(
    useCallback(() => {
      refreshPurchased();
      refreshPurchasedBackgrounds();
      refreshPurchasedButtonColors();
      chart.refreshPurchasedChartColors();
      movement.refreshPurchasedMovementLayers();
      glow.refreshPurchasedGlow();
    }, [refreshPurchased, refreshPurchasedBackgrounds, refreshPurchasedButtonColors, chart, movement, glow])
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

  // Flujo de borrado: bottom sheet con 3 opciones -> vista con la lista de
  // lo que se eliminara (Volver / Aceptar) -> confirmacion final.
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
    try {
      if (deleteFinalKind === "styles") {
        await clearStyleData();
        await Promise.all([
          refreshPurchased(),
          refreshPurchasedBackgrounds(),
          refreshPurchasedButtonColors(),
          chart.refreshPurchasedChartColors(),
          movement.refreshPurchasedMovementLayers(),
          glow.refreshPurchasedGlow(),
        ]);
        // Los puntos vuelven a 0 en la DB; al reiniciar la app los hooks lo reflejan.
      } else if (deleteFinalKind === "finance") {
        await clearFinanceData();
      } else {
        await clearAllData();
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
    }
  };

  // Pide confirmación y borra las notificaciones leídas de la app.
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

  // Pide confirmación y purga notificaciones con más de 30 días de antigüedad.
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

  // Código secreto: 4 pares de 2 dígitos -> "17-13-14-08". En el acierto
  // desbloquea todas las tiendas; en el error solo muestra feedback.
  const handleUnlockSubmit = async () => {
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
    await unlockAllStyles();
    setUnlockVisible(false);
    setCodeParts(["", "", "", ""]);
    showAlert("Todo desbloqueado", "Todos los temas, fondos, colores, movimientos y brillos ya están disponibles.");
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

  // Si todo ya esta desbloqueado, el toque al footer no muestra el input:
  // solo avisa. Un codigo correcto se puede ingresar una sola vez.
  const handleFooterTap = useCallback(async () => {
    const unlocked = await areAllStylesUnlocked();
    if (unlocked) {
      showAlert("Todo desbloqueado", "Ya todos los temas, fondos, colores, movimientos y brillos estan disponibles.");
    } else {
      setUnlockVisible(true);
    }
  }, [showAlert]);

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
        <TouchableOpacity style={[styles.newCard, glowStyle]} onPress={() => router.push("/shop")} activeOpacity={0.85}>
          <View style={styles.newCardHeader}>
            <View style={styles.newCardIcon}>
              <Ionicons name="color-palette-outline" size={18} color={colors.primary} />
            </View>
            <AppText style={styles.newCardTitle}>Personalización</AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
          {hasActiveProps && <View style={styles.newCardDivider} />}
          {hasActiveProps && (
            <View style={styles.newCardGrid}>
              {activeVariantId !== "default" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>TEMA</AppText>
                <AppText style={styles.newCardValue}>
                  {allThemes.find((t) => t.id === activeVariantId)?.name ?? activeVariantId}
                </AppText>
              </View>
            )}
            {activeBackgroundId && activeBackgroundId !== "flat" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>FONDO</AppText>
                <AppText style={styles.newCardValue}>
                  {allBackgrounds.find((b) => b.id === activeBackgroundId)?.name ?? activeBackgroundId}
                </AppText>
              </View>
            )}
            {(mode === "light" || mode === "dark") && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>MODO</AppText>
                <AppText style={styles.newCardValue}>{mode === "light" ? "Claro" : "Oscuro"}</AppText>
              </View>
            )}
            {activeButtonColorId !== "default" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>COLOR</AppText>
                <AppText style={styles.newCardValue}>
                  {capitalize(activeButtonColorId)}
                </AppText>
              </View>
            )}
            {chart.activeChartColorId !== "default" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>GRÁFICA</AppText>
                <AppText style={styles.newCardValue}>
                  {chart.allChartColors.find((c) => c.id === chart.activeChartColorId)?.name ?? ""}
                </AppText>
              </View>
            )}
            {movement.movementLayerId !== "none" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>MOVIMIENTO</AppText>
                <AppText style={styles.newCardValue}>
                  {movement.allMovementLayers.find((m) => m.id === movement.movementLayerId)?.name ?? ""}
                </AppText>
              </View>
            )}
            {glow.glowId !== "none" && (
              <View style={styles.newCardCell}>
                <AppText style={styles.newCardLabel}>BRILLO</AppText>
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
          <AppText style={styles.footer} numberOfLines={1}>
            Made By {APP_INFO.DEVELOPER} ·{" "}
          </AppText>
          <TouchableOpacity
            onPress={handleFooterTap}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <AppText style={styles.footer}>{APP_INFO.MAINTAINER}</AppText>
          </TouchableOpacity>
          <AppText style={styles.footer} numberOfLines={1}>
            {" "}· v{APP_INFO.VERSION}
          </AppText>
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
          <View style={[styles.deleteSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                  Temas, fondos, colores, gráficas, movimientos, brillos y puntos de la tienda
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
                  { icon: "star-outline" as const, label: "Puntos de la tienda (quedan en 0)", count: deleteCounts.puntos, noCount: true },
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
                  { icon: "color-palette-outline" as const, label: "Estilos (temas, fondos, colores, brillos) y puntos", count: deleteCounts.estilos },
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
        onRequestClose={() => setDeleteConfirmVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.deleteConfirmIcon, { backgroundColor: colors.error + "14" }]}>
              <Ionicons name="trash-outline" size={28} color={colors.error} />
            </View>
            <AppText style={[styles.deleteConfirmTitle, { color: colors.textPrimary }]}>¿Confirmás el borrado?</AppText>
            <AppText style={[styles.deleteConfirmDesc, { color: colors.textSecondary }]}>
              {deleteFinalKind === "styles"
                ? "Se eliminarán los temas, fondos, colores, gráficas, movimientos, brillos y puntos."
                : deleteFinalKind === "finance"
                  ? "Se eliminarán los movimientos, categorías y recurrentes."
                  : "Se eliminarán todos los datos de la app. Esta acción no se puede deshacer."}
            </AppText>
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

      {/* Modal: Código de desbloqueo (tocar "IntoCode" en el footer) */}
      <Modal
        visible={unlockVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setUnlockVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => {
                setUnlockVisible(false);
                setCodeParts(["", "", "", ""]);
              }}
              style={styles.codeCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

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
                onPress={() => {
                  setUnlockVisible(false);
                  setCodeParts(["", "", "", ""]);
                }}
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
          </View>
        </View>
      </Modal>
    </View>
  );
}
