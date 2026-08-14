import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Modal,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Polygon, Circle, Ellipse, Rect, Path, G } from "react-native-svg";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { purchaseBundle, getUserPoints, awardPoints } from "../lib/storage";
import { getSyncConfig } from "../lib/storage/sync";
import { useTheme, useThemeMode, useThemeShop, useBackgroundShop, useButtonColorShop, useChartColorShop, useMovementLayerShop, useGlowShop, useGlow, ThemeColors, ThemeMode } from "../lib/theme";
import { getThemePreviewColors } from "../lib/theme/presets/themes";
import { getStyles } from "../lib/settings-styles";
import { VISUAL_CONCEPTS, CALM_MOVEMENTS, ACTIVE_MOVEMENTS } from "../lib/recommendations";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import AppText from "../components/ui/AppText";
import GlowView from "../components/ui/GlowView";
import { useAlert } from "../components/ui/AlertModal";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Claro", icon: "sunny" },
  { value: "system", label: "Sistema", icon: "contrast" },
  { value: "dark", label: "Oscuro", icon: "moon" },
];

// Distancia percibida entre dos colores hex (manhattan en RGB). Se usa para
// cruzar estilos coherentes: cada concepto busca el objeto más cercano a su
// color objetivo dentro de cada catálogo.
function hexDist(a: string, b: string): number {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  if (pa.length !== 6 || pb.length !== 6) return 9999;
  const ca = [0, 2, 4].map((i) => parseInt(pa.slice(i, i + 2), 16));
  const cb = [0, 2, 4].map((i) => parseInt(pb.slice(i, i + 2), 16));
  return Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]);
}

type RecItem = {
  key: string;
  id: string;
  name: string;
  cost: number;
  color?: string;
  icon?: { set: "ion" | "mci"; name: string };
};

type Recommendation = {
  label: string;
  items: RecItem[];
  price: number;
};

// set: "ion" para Ionicons y "mci" para MaterialCommunityIcons (existen
// iconos solo disponibles en este set, p. ej. arrow-oscillating y waves).
const MOVEMENT_ICON: Record<string, { set: "ion" | "mci"; name: string }> = {
  none: { set: "ion", name: "close-circle-outline" },
  temblor: { set: "ion", name: "pulse" },
  marea: { set: "mci", name: "waves" },
  cabeceo: { set: "ion", name: "swap-vertical-outline" },
  respiro: { set: "ion", name: "body-outline" },
  vagar: { set: "ion", name: "walk-outline" },
  zoom: { set: "ion", name: "scan-outline" },
  elastico: { set: "ion", name: "resize-outline" },
  balanceo: { set: "ion", name: "swap-horizontal-outline" },
  onda: { set: "ion", name: "radio-outline" },
  latido: { set: "ion", name: "heart-outline" },
  girar: { set: "ion", name: "sync-outline" },
  flotar: { set: "ion", name: "balloon-outline" },
  rebote: { set: "ion", name: "basketball-outline" },
  pendulo: { set: "mci", name: "arrow-oscillating" },
};

// Vista previa de los seis elementos de un recomendado (chips de color e icono).
function RecChips({ items, colors, styles }: { items: RecItem[]; colors: ThemeColors; styles: ReturnType<typeof getStyles> }) {
  return (
    <View style={styles.recomChips}>
      {items.map((it, ci) => {
        const isTheme = it.key === "purchased_themes";
        const isBg = it.key === "purchased_backgrounds";
        const isChart = it.key === "purchased_chart_colors";
        const icon = it.icon;
        return (
          <View key={ci} style={styles.recomChip}>
            <View style={[styles.recomChipBox, { backgroundColor: colors.primary + "12" }]}>
              {it.color && !isChart && !isTheme && (
                <View style={[styles.recomChipDot, { backgroundColor: it.color === "transparent" || it.color === "auto" ? colors.border : it.color }]} />
              )}
              {isTheme && (
                <View style={[styles.recomChipDot, styles.recomChipDotTheme, { backgroundColor: it.color }]} />
              )}
              {isChart && (
                <View style={styles.recomChipBars}>
                  <View style={{ width: 4, height: 8, borderRadius: 2, backgroundColor: it.color }} />
                  <View style={{ width: 4, height: 12, borderRadius: 2, backgroundColor: it.color }} />
                </View>
              )}
              {isBg && <Ionicons name="grid-outline" size={13} color={colors.primary} />}
              {icon && (
                icon.set === "mci" ? (
                  <MaterialCommunityIcons name={icon.name as any} size={13} color={colors.primary} />
                ) : (
                  <Ionicons name={icon.name as any} size={13} color={colors.primary} />
                )
              )}
            </View>
            <AppText style={styles.recomChipName} numberOfLines={1}>{it.name}</AppText>
          </View>
        );
      })}
    </View>
  );
}

export default function ShopScreen() {
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
  // Brillo personalizado comprado: se aplica a los componentes de superficie
  // de la tienda (acordeones, cards) igual que en el resto de pestañas.
  const { glowStyle } = useGlow();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

  const [shopPoints, setShopPoints] = useState(0);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [ptsInfoVisible, setPtsInfoVisible] = useState(false);
  const [shopHelpVisible, setShopHelpVisible] = useState(false);
  // Etiqueta del recomendado que se está equipando (para mostrar la carga).
  const [equipping, setEquipping] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(200);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    themes: false,
    backgrounds: false,
    colors: false,
    chartColors: false,
    movement: false,
    glow: false,
    recomendados: false,
  });
  const toggleSection = useCallback((section: string) =>
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] })), []);

  useEffect(() => {
    getUserPoints().then(setShopPoints);
  }, []);

  // Estilo aleatorio: elige en orden tema, fondo, color, gráficas, movimientos
  // y brillos, siempre entre los que el usuario ya tiene disponibles.
  const randomizeStyle = useCallback(() => {
    const pick = <T,>(items: T[]): T | undefined =>
      items.length > 0 ? items[Math.floor(Math.random() * items.length)] : undefined;

    const theme = pick(allThemes.filter((t) => purchasedIds.has(t.id)));
    const bg = pick(allBackgrounds.filter((b) => purchasedBackgroundIds.has(b.id)));
    const btn = pick(allButtonColors.filter((b) => purchasedButtonColorIds.has(b.id)));
    const chartColor = pick(chart.allChartColors.filter((c) => chart.purchasedChartColorIds.has(c.id)));
    const mov = pick(movement.allMovementLayers.filter((m) => movement.purchasedMovementLayerIds.has(m.id)));
    const gl = pick(glow.allGlowPresets.filter((g) => glow.purchasedGlowIds.has(g.id)));

    if (theme) equipTheme(theme.id);
    if (bg) equipBackground(bg.id);
    if (btn) setButtonColor(btn.id);
    if (chartColor) chart.setChartColor(chartColor.id);
    if (mov) movement.setMovementLayer(mov.id);
    if (gl) glow.setGlow(gl.id);
  }, [allThemes, purchasedIds, equipTheme, allBackgrounds, purchasedBackgroundIds, equipBackground, allButtonColors, purchasedButtonColorIds, setButtonColor, chart, movement, glow]);

  // 20 recomendados: cada uno parte de un CONCEPTO visual (nombre + color
  // objetivo + energía) y desde ahí se eligen los objetos que le van bien:
  // tema, botón, gráfica y brillo los más cercanos al color del concepto;
  // el fondo y el movimiento según la semilla y energía del concepto.
  const recommendations = useMemo<Recommendation[]>(() => {
    const ownedMap: Record<string, Set<string>> = {
      purchased_themes: purchasedIds,
      purchased_backgrounds: purchasedBackgroundIds,
      purchased_button_colors: purchasedButtonColorIds,
      purchased_chart_colors: chart.purchasedChartColorIds,
      purchased_movement_layers: movement.purchasedMovementLayerIds,
      purchased_glow: glow.purchasedGlowIds,
    };

    const near = <T,>(
      list: T[],
      colorOf: (t: T) => string | undefined,
      skip: (t: T) => boolean,
      target: string,
      slide: number
    ): T | undefined => {
      const pool = list.filter((t) => !skip(t));
      if (!pool.length) return undefined;
      const withDist = pool.map((t) => {
        const c = colorOf(t);
        return { t, d: c ? hexDist(c, target) : 9999 };
      });
      withDist.sort((x, y) => x.d - y.d);
      // entre los 3 más cercanos, con desplazamiento para dar variedad
      return withDist[slide % Math.min(3, withDist.length)].t;
    };

    const bgPool = allBackgrounds.filter((b) => b.id !== "flat" && b.id !== "default");

    return VISUAL_CONCEPTS.map((concept, i) => {
      const theme = near(allThemes, (t) => getThemePreviewColors(t.id, isDark).primary, (t) => t.id === "default", concept.target, i);
      const themePrimary = theme ? getThemePreviewColors(theme.id, isDark).primary : colors.primary;
      const bg = bgPool[(concept.bgSeed + i * 13) % bgPool.length];
      const btn = near(allButtonColors, (b) => b.primary || undefined, (b) => b.id === "default", concept.target, i + 1);
      const chartC = near(chart.allChartColors, (c) => c.positive, (c) => c.id === "default", concept.target, i + 2);
      const movPool = movement.allMovementLayers.filter(
        (m) => m.id !== "none" && (concept.energy === "calma" ? CALM_MOVEMENTS : ACTIVE_MOVEMENTS).includes(m.id)
      );
      const mov = movPool.length
        ? movPool[(i + concept.bgSeed) % movPool.length]
        : movement.allMovementLayers.find((m) => m.id === "respiro");
      const gl = near(
        glow.allGlowPresets,
        (g) => (g.color === "auto" || g.color === "transparent" ? undefined : g.color),
        (g) => g.id === "none" || g.id === "auto",
        concept.target,
        i + 3
      );

      const items: RecItem[] = [
        { key: "purchased_themes", id: theme?.id ?? "default", name: theme?.name ?? "Original", cost: theme?.cost ?? 0, color: themePrimary },
        { key: "purchased_backgrounds", id: bg?.id ?? "flat", name: bg?.name ?? "Liso", cost: bg?.cost ?? 0 },
        { key: "purchased_button_colors", id: btn?.id ?? "default", name: btn ? capitalize(btn.id) : "Original", cost: btn?.cost ?? 0, color: btn?.primary || colors.primary },
        { key: "purchased_chart_colors", id: chartC?.id ?? "default", name: chartC?.name ?? "Original", cost: chartC?.cost ?? 0, color: chartC?.positive },
        { key: "purchased_movement_layers", id: mov?.id ?? "none", name: mov?.name ?? "Sin movimiento", cost: mov?.cost ?? 0, icon: mov ? MOVEMENT_ICON[mov.id] : undefined },
        { key: "purchased_glow", id: gl?.id ?? "none", name: gl?.name ?? "Sin brillo", cost: gl?.cost ?? 0, color: gl?.color },
      ];

      const missing = items.filter((it) => !ownedMap[it.key]!.has(it.id));
      return {
        label: concept.name,
        items,
        price: missing.reduce((s, it) => s + it.cost, 0),
      };
    });
  }, [allThemes, allBackgrounds, allButtonColors, chart, movement, glow, purchasedIds, purchasedBackgroundIds, purchasedButtonColorIds, isDark, colors.primary]);

  // Equipa todos los estilos de un recomendado (tema, fondo, colores, etc.).
  // Cada hook escribe su propia clave en la DB, así que se lanzan en paralelo
  // en vez de uno por uno: el equipado completo queda instantáneo.
  const equipRecommendation = useCallback(async (rec: Recommendation) => {
    await Promise.all(
      rec.items.map((it) => {
        if (it.key === "purchased_themes") return equipTheme(it.id);
        if (it.key === "purchased_backgrounds") return equipBackground(it.id);
        if (it.key === "purchased_button_colors") return setButtonColor(it.id);
        if (it.key === "purchased_chart_colors") return chart.setChartColor(it.id);
        if (it.key === "purchased_movement_layers") return movement.setMovementLayer(it.id);
        if (it.key === "purchased_glow") return glow.setGlow(it.id);
        return Promise.resolve();
      })
    );
  }, [equipTheme, equipBackground, setButtonColor, chart, movement, glow]);

  // Compra de un recomendado: desbloquea solo los elementos que faltan, con
  // una transaccion única, y refresca las seis tiendas + puntos. Si ya está
  // completo (precio 0), la card se toca y se equipan sus estilos con carga.
  const buyRecommendation = useCallback(async (rec: Recommendation) => {
    const ownedMap: Record<string, Set<string>> = {
      purchased_themes: purchasedIds,
      purchased_backgrounds: purchasedBackgroundIds,
      purchased_button_colors: purchasedButtonColorIds,
      purchased_chart_colors: chart.purchasedChartColorIds,
      purchased_movement_layers: movement.purchasedMovementLayerIds,
      purchased_glow: glow.purchasedGlowIds,
    };
    if (rec.price <= 0) {
      if (equipping) return;
      setEquipping(rec.label);
      try {
        await equipRecommendation(rec);
        // Equipado: el acordeón pasa a modo cerrado, el resto queda visible.
        toggleSection("recomendados");
      } finally {
        setEquipping(null);
      }
      return;
    }
    const missing = rec.items.filter((it) => !ownedMap[it.key]!.has(it.id));
    showAlert(`Comprar "${rec.label}"`, `Desbloquea ${missing.length} elementos por ${rec.price} pts. ¿Los compras juntos?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Comprar",
        style: "default",
        onPress: async () => {
          const result = await purchaseBundle(
            missing.map((it) => ({ key: it.key, id: it.id })),
            rec.price
          );
          if (result.success) {
            await Promise.all([
              refreshPurchased(),
              refreshPurchasedBackgrounds(),
              refreshPurchasedButtonColors(),
              chart.refreshPurchasedChartColors(),
              movement.refreshPurchasedMovementLayers(),
              glow.refreshPurchasedGlow(),
            ]);
            const pts = await getUserPoints();
            setShopPoints(pts);
            // Combo seleccionado: cerrar para mostrar el resultado aplicado.
            toggleSection("recomendados");
          } else {
            showAlert("Error", result.reason || "No se pudo completar la compra.");
          }
        },
      },
    ]);
  }, [purchasedIds, purchasedBackgroundIds, purchasedButtonColorIds, chart, movement, glow, refreshPurchased, refreshPurchasedBackgrounds, refreshPurchasedButtonColors, equipRecommendation, equipping, showAlert, toggleSection]);

  const handlePurchase = async (themeId: string, cost: number) => {
    setBuyingId(themeId);
    const result = await purchaseTheme(themeId, cost);
    setBuyingId(null);
    if (result.success) {
      const pts = await getUserPoints();
      setShopPoints(pts);
    } else {
      showAlert("Error", result.reason || "No se pudo completar la compra.");
    }
  };

  const handleEquip = async (themeId: string) => {
    await equipTheme(themeId);
  };

  function getConfigSnapshot() {
    return {
      theme: activeVariantId,
      background: activeBackgroundId,
      buttonColor: activeButtonColorId,
      chartColor: chart.activeChartColorId,
      movementLayer: movement.movementLayerId,
      glow: glow.glowId,
      glowIntensity: glow.glowIntensity,
      themeMode: mode,
    };
  }

  async function openFeedback() {
    setFeedbackText("");
    setFeedbackVisible(true);
  }

  async function handleSendFeedback() {
    const desc = feedbackText.trim();
    const wordCount = desc.split(/\s+/).filter(Boolean).length;
    if (wordCount < 50) {
      showAlert(
        "Descripción muy corta",
        `Describe el problema de estilo con al menos 50 palabras (tienes ${wordCount}). Explica qué esperabas ver, qué se ve diferente y qué cambios de estilo realizaste.`
      );
      return;
    }

    const db = (await import("../lib/storage/db")).getDb();
    const hash = JSON.stringify(getConfigSnapshot());

    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'reported_configs'"
    );
    let hashes: string[] = [];
    if (row?.value) {
      try { hashes = JSON.parse(row.value); } catch {}
    }
    if (hashes.includes(hash)) {
      showAlert("Ya reportaste este problema", "Esta configuración ya fue reportada anteriormente. Gracias por tu ayuda.");
      setFeedbackVisible(false);
      return;
    }

    // Reusa la configuracion de sync (URL + API key) guardada por el usuario
    // en SecureStore/settings. No se embebe ninguna key en el bundle de la app.
    const { url, key } = await getSyncConfig();
    if (!url || !key) {
      showAlert(
        "Sincronización no configurada",
        "Configura la URL y API key del servidor en Ajustes > Sincronización para enviar reportes."
      );
      return;
    }

    setSendingFeedback(true);

    try {
      const snapshot = getConfigSnapshot();
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ description: desc, config: snapshot }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${res.status}`);
      }

      hashes.push(hash);
      await db.runAsync(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('reported_configs', ?)",
        JSON.stringify(hashes)
      );
      await awardPoints(10);
      const pts = await getUserPoints();
      setShopPoints(pts);

      setSendingFeedback(false);
      setFeedbackVisible(false);
      showAlert("¡Gracias!", "Has recibido 10 puntos por tu reporte.");
    } catch (e: any) {
      setSendingFeedback(false);
      showAlert("Error al enviar", e.message || "No se pudo enviar el reporte. Verifica que el bridge esté corriendo.");
    }
  }

  return (
    <View style={styles.container}>
      <BackgroundDecor colors={colors} screenVariant={5} />
      <SafeAreaView style={styles.shopSafe} edges={["top", "left", "right"]}>
        {/* Header compacto: título arriba, acciones a un toque */}
        <View style={styles.shopHeader}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.shopBackBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <AppText style={styles.shopTitle}>Tienda</AppText>
            <TouchableOpacity
              onPress={openFeedback}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="bug-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.shopPointsBadge} onPress={() => setPtsInfoVisible(true)} activeOpacity={0.7}>
            <Ionicons name="star" size={14} color={colors.warning} />
            <AppText style={styles.shopPointsText}>{shopPoints}</AppText>
          </TouchableOpacity>
          {/* Hint: guía completa de la lógica de la tienda y sus botones */}
          <TouchableOpacity
            onPress={() => setShopHelpVisible(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="help-circle-outline" size={21} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.shopScroll}>
          <View style={[styles.shopThemeSelector, glowStyle]}>
            {THEME_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.shopThemeOption, active && styles.shopThemeOptionActive]}
                  onPress={() => setMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={opt.icon}
                    size={13}
                    color={active ? colors.surface : colors.textSecondary}
                  />
                  <AppText style={[styles.shopThemeOptionText, active && styles.shopThemeOptionTextActive]}>
                    {opt.label}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Recomendados (1º acordeón): cada uno nace de un concepto visual
              y agrupa los seis estilos que le fueron asignados. Al estar
              completo, el botón pasa a equipar los estilos del combo. */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("recomendados")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="star" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Recomendados</AppText>
                <AppText style={styles.accordionSub}>Combos de estilos que combinan entre sí</AppText>
                <AppText style={styles.accordionDesc}>
                  {VISUAL_CONCEPTS.length} combos · Cada uno sigue un concepto visual
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.recomendados ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.recomendados && (
            <View style={styles.recomContainer}>
              {recommendations.map((rec, index) => {
                const complete = rec.price <= 0;
                const isEquipping = equipping === rec.label;
                if (complete) {
                  // Combo ya comprado: tocar la card entera equipa sus
                  // estilos, mostrando una carga breve mientras se aplican.
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[styles.recomCard, glowStyle, { backgroundColor: colors.surface, borderColor: colors.success + "45" }]}
                      activeOpacity={0.75}
                      onPress={() => buyRecommendation(rec)}
                      disabled={isEquipping}
                    >
                      {/* Tint encima de superficie opaca: el glow sale por el perímetro */}
                      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary + "0D", borderRadius: 12 }]} />
                      <View style={styles.recomHeader}>
                        <AppText style={[styles.recomLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                          #{index + 1} · {rec.label}
                        </AppText>
                      </View>
                      <RecChips items={rec.items} colors={colors} styles={styles} />
                      <View style={styles.recomActions}>
                        {isEquipping && (
                          <View style={styles.recomEquiping}>
                            <ActivityIndicator size="small" color={colors.success} />
                            <AppText style={styles.recomEquipingText}>Equipando estilos...</AppText>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }
                return (
                  <View
                    key={index}
                    style={[styles.recomCard, glowStyle, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    {/* Tint encima de superficie opaca: el glow sale por el perímetro */}
                    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary + "0D", borderRadius: 12 }]} />
                    {/* Título del concepto y precio arriba */}
                    <View style={styles.recomHeader}>
                      <AppText style={[styles.recomLabel, { color: colors.textPrimary }]} numberOfLines={1}>
                        #{index + 1} · {rec.label}
                      </AppText>
                      <View style={styles.recomPriceBadge}>
                        <Ionicons name="star" size={10} color={colors.warning} />
                        <AppText style={styles.recomPriceBadgeText}>{rec.price} pts</AppText>
                      </View>
                    </View>
                    <RecChips items={rec.items} colors={colors} styles={styles} />
                    {/* Compra de lo que falta */}
                    <View style={styles.recomActions}>
                      <TouchableOpacity
                        style={[styles.recomActionBtn, { backgroundColor: colors.primary }]}
                        onPress={() => buyRecommendation(rec)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="cart-outline" size={12} color={colors.surface} />
                        <AppText style={[styles.recomActionText, { color: colors.surface }]}>
                          Comprar · {rec.price} pts
                        </AppText>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Temas */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("themes")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="color-palette-outline" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Temas</AppText>
                <AppText style={styles.accordionSub}>Cambia la paleta de colores de toda la app</AppText>
                <AppText style={styles.accordionDesc}>
                  {allThemes.length} disponibles · Activo: {activeVariantId === "default" ? "Original" : allThemes.find((t) => t.id === activeVariantId)?.name ?? activeVariantId}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.themes ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.themes && (
            <View style={styles.shopGrid}>
              {allThemes.map((theme) => {
                const owned = purchasedIds.has(theme.id);
                const active = activeVariantId === theme.id;
                const preview = getThemePreviewColors(theme.id, false);
                return (
                  <TouchableOpacity
                    key={theme.id}
                    style={[styles.shopCard, { width: CARD_W }, active && styles.shopCardActive, !owned && styles.shopCardLocked]}
                    activeOpacity={0.7}
                    onPress={async () => {
                      if (owned) {
                        await handleEquip(theme.id);
                        toggleSection("themes");
                      } else {
                        showAlert(`Comprar ${theme.name}`, `¿Desbloquear este tema por ${theme.cost} pts?`, [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Comprar", style: "default", onPress: async () => { await handlePurchase(theme.id, theme.cost); } },
                        ]);
                      }
                    }}
                  >
                    <View style={styles.swatchWrap}>
                      <View style={styles.shopSwatches}>
                        <View style={[styles.shopSwatch, { backgroundColor: preview.primary }]} />
                        <View style={[styles.shopSwatch, { backgroundColor: preview.primary + "B0" }]} />
                        <View style={[styles.shopSwatch, { backgroundColor: preview.primary + "70" }]} />
                        <View style={[styles.shopSwatch, { backgroundColor: preview.primary + "40" }]} />
                        <View style={[styles.shopSwatch, { backgroundColor: preview.primary + "1A" }]} />
                      </View>
                      {!owned && (
                        <View style={styles.lockOverlay}>
                          <Ionicons name="lock-closed" size={11} color={colors.surface} />
                          <AppText style={{ fontSize: 10, fontWeight: "700", color: colors.surface }}>{theme.cost}</AppText>
                        </View>
                      )}
                    </View>
                    <AppText style={styles.shopCardName}>{active ? `${theme.name} ✓` : theme.name}</AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Fondos */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("backgrounds")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="image-outline" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Fondos</AppText>
                <AppText style={styles.accordionSub}>Añade patrones decorativos al fondo de la app</AppText>
                <AppText style={styles.accordionDesc}>
                  {allBackgrounds.length} disponibles · Activo: {activeBackgroundId === "default" ? "Original" : allBackgrounds.find((b) => b.id === activeBackgroundId)?.name ?? activeBackgroundId}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.backgrounds ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.backgrounds && (
            <View style={styles.shopGrid}>
              {allBackgrounds.map((bg) => {
                const owned = purchasedBackgroundIds.has(bg.id);
                const active = activeBackgroundId === bg.id;
                return (
                  <TouchableOpacity
                    key={bg.id}
                    style={[styles.shopCard, { width: CARD_W }, active && styles.shopCardActive, !owned && styles.shopCardLocked]}
                    activeOpacity={0.7}
                    onPress={async () => {
                      if (owned) {
                        await equipBackground(bg.id);
                        toggleSection("backgrounds");
                      } else {
                        showAlert(`Comprar ${bg.name}`, `¿Desbloquear este fondo por ${bg.cost} pts?`, [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Comprar", style: "default", onPress: async () => {
                            setBuyingId(bg.id);
                            const result = await purchaseBg(bg.id, bg.cost);
                            setBuyingId(null);
                            if (result.success) { const pts = await getUserPoints(); setShopPoints(pts); }
                            else { showAlert("Error", result.reason || "No se pudo completar la compra."); }
                          }},
                        ]);
                      }
                    }}
                  >
                    <View style={styles.swatchWrap}>
                      <View style={[styles.bgPreview, { backgroundColor: colors.primary + "18" }]}>
                        <Svg width={54} height={54} viewBox="0 0 54 54">
                          {bg.id === "circles" && (<Circle cx={27} cy={27} r={11} fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "diamonds" && (<Polygon points="18.9,13.5 35.1,13.5 40.5,24.3 27,40.5 13.5,24.3" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "triangles" && (<Polygon points="13,39 41,39 27,15" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "rings" && (<Ellipse cx={27} cy={27} rx={15} ry={9} fill="none" stroke={colors.primary} strokeWidth={3} opacity={0.5} />)}
                          {bg.id === "mixed" && (<><Circle cx={16} cy={16} r={7} fill={colors.primary} opacity={0.4} /><Rect x={30} y={10} width={14} height={14} fill={colors.primary} opacity={0.4} rx={3} /><Polygon points="19,29.1 35,29.1 27,43" fill={colors.primary} opacity={0.4} /></>)}
                          {bg.id === "dots" && (<><Circle cx={15} cy={27} r={3} fill={colors.primary} opacity={0.5} /><Circle cx={27} cy={15} r={4} fill={colors.primary} opacity={0.5} /><Circle cx={39} cy={30} r={3} fill={colors.primary} opacity={0.5} /><Circle cx={22} cy={40} r={2} fill={colors.primary} opacity={0.5} /><Circle cx={35} cy={19} r={2.5} fill={colors.primary} opacity={0.5} /></>)}
                          {bg.id === "pentagono" && (<Polygon points="27,6 44,20 38,40 16,40 10,20" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "hexagons" && (<Polygon points="27,7 44.3,17 44.3,37 27,47 9.7,37 9.7,17" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "stars" && (<Polygon points="27,8 31.3,21.1 45.1,21.1 33.9,29.2 38.2,42.4 27,34.3 15.8,42.4 20.1,29.2 8.9,21.1 22.7,21.1" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "flat" && (<></>)}
                          {bg.id === "crosses" && (<Path d="M16,16 L38,38 M38,16 L16,38" fill="none"stroke={colors.primary}strokeWidth={3.2} opacity={0.5} strokeLinecap="round" strokeLinejoin="round"/>)}
                          {bg.id === "waves" && (<Path d="M10,30 Q18,18 27,27 T44,27" fill="none" stroke={colors.primary} strokeWidth={2.5} opacity={0.5} strokeLinecap="round" />)}
                          {bg.id === "squares" && (<Rect x={16} y={16} width={22} height={22} fill={colors.primary} opacity={0.4} rx={3} />)}
                          {bg.id === "arrows" && (<G transform={`rotate(45, 27, 27)`}><Polygon points="27,12 14,42 27,32 40,42" fill={colors.primary} opacity={0.5} /></G>)}
                          {bg.id === "cylinders" && (<G transform={`rotate(45, 27, 27)`}><Rect x={19} y={12} width={16} height={30} rx={8} fill={colors.primary} opacity={0.5} /></G>)}
                          {bg.id === "heptagons" && (<Polygon points="27,5 44.2,13.3 48.4,31.9 36.5,46.8 17.5,46.8 5.6,31.9 9.8,13.3" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "octagons" && (<Polygon points="27,5 42.6,11.4 49,27 42.6,42.6 27,49 11.4,42.6 5,27 11.4,11.4" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "nonagons" && (<Polygon points="27,5 41.1,10.1 48.7,23.2 46.1,38 34.5,47.7 19.5,47.7 7.9,38 5.3,23.2 12.9,10.1" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "decagons" && (<Polygon points="27,5 39.9,9.2 47.9,20.2 47.9,33.8 39.9,44.8 27,49 14.1,44.8 6.1,33.8 6.1,20.2 14.1,9.2" fill={colors.primary} opacity={0.5} />)}
                          {bg.id === "dodecagons" && (<Polygon points="27,5 38,7.9 46.1,16 49,27 46.1,38 38,46.1 27,49 16,46.1 7.9,38 5,27 7.9,16 16,7.9" fill={colors.primary} opacity={0.5} />)}
                        </Svg>
                      </View>
                      {!owned && (
                        <View style={styles.lockOverlay}>
                          <Ionicons name="lock-closed" size={11} color={colors.surface} />
                          <AppText style={{ fontSize: 10, fontWeight: "700", color: colors.surface }}>{bg.cost}</AppText>
                        </View>
                      )}
                    </View>
                    <AppText style={styles.shopCardName}>{active ? `${bg.name} ` : bg.name}</AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Color secundario accordion */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("colors")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="color-fill-outline" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Color secundario</AppText>
                <AppText style={styles.accordionSub}>Personaliza el tono de botones y elementos interactivos</AppText>
                <AppText style={styles.accordionDesc}>
                  {allButtonColors.length} colores · Activo: {activeButtonColorId === "default" ? "Original" : capitalize(activeButtonColorId)}
                  {!freePointsClaimed && <> · <AppText style={{ fontSize: 10, color: colors.primary, textDecorationLine: "underline" }} onPress={async () => {
                    await claimFreePoints();
                    const pts = await getUserPoints();
                    setShopPoints(pts);
                    showAlert("+50 pts", "Has recibido 50 puntos gratis. ¡Gasta tus puntos en colores!");
                  }}>+50 pts gratis</AppText></>}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.colors ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.colors && (
            <View style={styles.colorGrid}>
              {allButtonColors.map((btn) => {
                const owned = purchasedButtonColorIds.has(btn.id);
                const active = activeButtonColorId === btn.id;
                const color = btn.primary || colors.primary;
                return (
                  <TouchableOpacity
                    key={btn.id}
                    style={[styles.colorCard, active && styles.colorCardActive, !owned && styles.shopCardLocked]}
                    activeOpacity={0.7}
                    onPress={async () => {
                      if (owned) {
                        await setButtonColor(btn.id);
                        toggleSection("colors");
                      } else {
                        showAlert(`¿Desbloquear este color?`, `Cuesta ${btn.cost} pts`, [
                          { text: "Cancelar", style: "cancel" },
                          { text: "Comprar", style: "default", onPress: async () => {
                            const result = await purchaseButtonColor(btn.id, btn.cost);
                            if (result.success) { const pts = await getUserPoints(); setShopPoints(pts); }
                            else { showAlert("Error", result.reason || "No se pudo completar la compra."); }
                          }},
                        ]);
                      }
                    }}
                  >
                    <View style={[styles.colorSwatch, { backgroundColor: color }]}>
                      {active && (<Ionicons name="checkmark" size={14} color={colors.surface} />)}
                      {!owned && (
                        <View style={styles.colorLockOverlay}>
                          <Ionicons name="lock-closed" size={10} color={colors.surface} />
                          <AppText style={styles.lockPriceText}>{btn.cost}</AppText>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Colores de gráficas */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("chartColors")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="bar-chart" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Colores de gráficas</AppText>
                <AppText style={styles.accordionSub}>Define los colores de ingresos y gastos en tus gráficos</AppText>
                <AppText style={styles.accordionDesc}>
                  {chart.allChartColors.length} pares · Activo: {chart.allChartColors.find((c) => c.id === chart.activeChartColorId)?.name ?? "Original"}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.chartColors ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.chartColors && (
            <View style={styles.colorGrid}>
              {chart.allChartColors.map((cc) => {
                const owned = cc.cost === 0 || chart.purchasedChartColorIds.has(cc.id);
                const active = chart.activeChartColorId === cc.id;
                const posColor = cc.positive || colors.chartPositive || colors.success;
                const negColor = cc.negative || colors.chartNegative || colors.error;
                return (
                  <View key={cc.id} style={styles.chartCardWrap}>
                    <TouchableOpacity
                      style={[styles.chartCard, active && styles.colorCardActive, !owned && styles.shopCardLocked]}
                      activeOpacity={0.7}
                      onPress={async () => {
                        if (owned) {
                          await chart.setChartColor(cc.id);
                            toggleSection("chartColors");
                        } else {
                          showAlert(`¿Desbloquear este par?`, `Cuesta ${cc.cost} pts`, [
                            { text: "Cancelar", style: "cancel" },
                            { text: "Comprar", style: "default", onPress: async () => {
                              const result = await chart.purchaseChartColor(cc.id, cc.cost);
                              if (result.success) {
                                const pts = await getUserPoints();
                                setShopPoints(pts);
                              } else {
                                showAlert("Error", result.reason || "No se pudo completar la compra.");
                              }
                            }},
                          ]);
                        }
                      }}
                    >
                      <View style={styles.chartPairSwatch}>
                        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: negColor, borderRadius: 5 }} />
                        <View style={styles.chartDiagonalWrap}>
                          <View style={{ flex: 1, backgroundColor: posColor }} />
                          <View style={{ flex: 1 }} />
                        </View>
                      </View>
                      {active && (
                        <View style={styles.chartCheckOverlay}>
                          <Ionicons name="checkmark" size={14} color={colors.surface} />
                        </View>
                      )}
                      {!owned && (
                        <View style={styles.colorLockOverlay}>
                          <Ionicons name="lock-closed" size={10} color={colors.surface} />
                          <AppText style={styles.lockPriceText}>{cc.cost}</AppText>
                        </View>
                      )}
                    </TouchableOpacity>
                    <AppText style={styles.chartPairName} numberOfLines={1}>{cc.name}</AppText>
                  </View>
                );
              })}
            </View>
          )}

          {/* Capa de movimiento */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("movement")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="radio-outline" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Movimiento</AppText>
                <AppText style={styles.accordionSub}>Animaciones sutiles para los fondos</AppText>
                <AppText style={styles.accordionDesc}>
                  {movement.allMovementLayers.length - 1} patrones · Activo: {movement.allMovementLayers.find((m) => m.id === movement.movementLayerId)?.name ?? "Sin movimiento"}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.movement ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.movement && (
            <View style={styles.colorGrid}>
              {movement.allMovementLayers.map((m) => {
                const owned = m.cost === 0 || movement.purchasedMovementLayerIds.has(m.id);
                const active = movement.movementLayerId === m.id;
                return (
                  <View key={m.id} style={styles.chartCardWrap}>
                    <TouchableOpacity
                      style={[styles.chartCard, active && styles.colorCardActive, !owned && styles.shopCardLocked]}
                      activeOpacity={0.7}
                      onPress={async () => {
                        if (owned) {
                          await movement.setMovementLayer(m.id);
                          toggleSection("movement");
                        } else {
                          showAlert(`¿Desbloquear "${m.name}"?`, `Cuesta ${m.cost} pts`, [
                            { text: "Cancelar", style: "cancel" },
                            { text: "Comprar", style: "default", onPress: async () => {
                              const result = await movement.purchaseMovementLayer(m.id, m.cost);
                              if (result.success) {
                                await movement.setMovementLayer(m.id);
                                toggleSection("movement");
                                const pts = await getUserPoints();
                                setShopPoints(pts);
                              } else {
                                showAlert("Error", result.reason || "No se pudo completar la compra.");
                              }
                            }},
                          ]);
                        }
                      }}
                    >
                      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary + "15", alignItems: "center", justifyContent: "center" }}>
                        {MOVEMENT_ICON[m.id]?.set === "mci" ? (
                          <MaterialCommunityIcons name={MOVEMENT_ICON[m.id].name as any} size={22} color={colors.primary} />
                        ) : (
                          <Ionicons name={MOVEMENT_ICON[m.id].name as any} size={22} color={colors.primary} />
                        )}
                        {!owned && (
                          <>
                            <View style={StyleSheet.absoluteFill}>
                              <View style={{ flex: 1, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", gap: 1 }}>
                                <Ionicons name="lock-closed" size={12} color="#fff" />
                                <AppText style={{ fontSize: 9, fontWeight: "800", color: "#fff" }}>{m.cost}</AppText>
                              </View>
                            </View>
                          </>
                        )}
                      </View>
                    </TouchableOpacity>
                    <AppText style={styles.chartPairName} numberOfLines={1}>{active ? `${m.name} ` : m.name}</AppText>
                  </View>
                );
              })}
            </View>
          )}

          {/* Brillo */}
          <TouchableOpacity style={styles.accordionHeader} onPress={() => toggleSection("glow")} activeOpacity={0.7}>
            <View style={styles.accordionLeft}>
              <Ionicons name="sparkles" size={16} color={colors.primary} />
              <View style={styles.accordionInfo}>
                <AppText style={styles.accordionTitle}>Brillo</AppText>
                <AppText style={styles.accordionSub}>Agrega un brillo decorativo para la app</AppText>
                <AppText style={styles.accordionDesc}>
                  {glow.allGlowPresets.length} brillos · Activo: {glow.allGlowPresets.find((g) => g.id === glow.glowId)?.name ?? "Sin brillo"}
                </AppText>
              </View>
            </View>
            <Ionicons name={expandedSections.glow ? "chevron-up" : "chevron-down"} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {expandedSections.glow && (
            <>
              <View style={styles.glowGrid}>
                {glow.allGlowPresets.map((pr) => {
                  const owned = pr.cost === 0 || glow.purchasedGlowIds.has(pr.id);
                  const active = glow.glowId === pr.id;
                  const isNone = pr.id === "none";
                  const isAuto = pr.id === "auto";
                  const rainbowColors = [colors.error, colors.warning, colors.warning, colors.success, colors.accentBlue, colors.primary, colors.error];
                  return (
                    <TouchableOpacity
                      key={pr.id}
                      style={[styles.glowCard, active && styles.glowCardActive, !owned && styles.shopCardLocked]}
                      activeOpacity={0.7}
                      onPress={async () => {
                        if (owned) {
                          await glow.setGlow(pr.id);
                          toggleSection("glow");
                        } else {
                          showAlert(`Comprar ${pr.name}`, `¿Desbloquear este brillo por ${pr.cost} pts?`, [
                            { text: "Cancelar", style: "cancel" },
                            { text: "Comprar", style: "default", onPress: async () => {
                              const result = await glow.purchaseGlow(pr.id, pr.cost);
                              if (result.success) {
                                const pts = await getUserPoints();
                                setShopPoints(pts);
                                await glow.setGlow(pr.id);
                                toggleSection("glow");
                              }
                              else { showAlert("Error", result.reason || "No se pudo completar la compra."); }
                            }},
                          ]);
                        }
                      }}
                    >
                      <View style={styles.glowSwatchWrap}>
                        {isAuto ? (
                          <View style={styles.glowSwatchRainbow}>
                            {rainbowColors.map((c, i) => (<View key={i} style={[styles.rainbowStripe, { backgroundColor: c }]} />))}
                          </View>
                        ) : (
                          <View style={[styles.glowSwatch, { backgroundColor: isNone ? colors.border : pr.color }, active && glow.glowId !== "none" && glow.glowIntensity > 0 && { shadowColor: pr.color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8, elevation: 6 }]}>
                            {active && (<Ionicons name="checkmark" size={14} color={isNone ? colors.textSecondary : colors.surface} />)}
                          </View>
                        )}
                        {!owned && (
                          <View style={styles.colorLockOverlay}>
                            <Ionicons name="lock-closed" size={10} color={colors.surface} />
                            <AppText style={styles.lockPriceText}>{pr.cost}</AppText>
                          </View>
                        )}
                      </View>
                      <AppText style={styles.glowCardName}>{pr.name}</AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {glow.glowId !== "none" && (
                <View style={styles.intensitySection}>
                  <AppText style={styles.intensityLabel}>Intensidad: {glow.glowIntensity}%</AppText>
                  <View
                    style={styles.intensityTrack}
                    onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(e) => {
                      const pct = Math.round((e.nativeEvent.locationX / trackWidth) * 100);
                      glow.setGlowIntensity(Math.max(0, Math.min(100, pct)));
                    }}
                    onResponderMove={(e) => {
                      const pct = Math.round((e.nativeEvent.locationX / trackWidth) * 100);
                      glow.setGlowIntensity(Math.max(0, Math.min(100, pct)));
                    }}
                  >
                    <View style={[styles.intensityFill, {
                      width: `${glow.glowIntensity}%` as any,
                      backgroundColor: glowColor(glow.glowId),
                      opacity: 0.3 + (glow.glowIntensity / 100) * 0.5,
                      shadowColor: glowColor(glow.glowId),
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: (glow.glowIntensity / 100) * 0.6,
                      shadowRadius: 4 + (glow.glowIntensity / 100) * 8,
                      elevation: glow.glowIntensity > 0 ? 3 : 0,
                    }]} />
                  </View>
                </View>
              )}
            </>
          )}

          {/* Combinaciones posibles: al final del todo */}
          <View style={[styles.comboCard, glowStyle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Tint encima de superficie opaca: el glow sale por el perímetro */}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary + "12", borderRadius: 12 }]} />
            <Ionicons name="infinite-outline" size={22} color={colors.primary} />
            <View style={styles.comboInfo}>
              <AppText style={[styles.comboTitle, { color: colors.textPrimary }]}>Personalización total</AppText>
              <AppText style={[styles.comboDesc, { color: colors.textSecondary }]}>
                {allThemes.length} temas · {allBackgrounds.length} fondos · {allButtonColors.length} colores · {chart.allChartColors.length} gráficas · {movement.allMovementLayers.length} movimientos · {glow.allGlowPresets.length} brillos
              </AppText>
              <AppText style={[styles.comboTotal, { color: colors.primary }]}>
                {(allThemes.length * allBackgrounds.length * allButtonColors.length * chart.allChartColors.length * movement.allMovementLayers.length * glow.allGlowPresets.length).toLocaleString("es")} combinaciones posibles
              </AppText>
            </View>
            {/* Estilo aleatorio con lo que el usuario ya tiene disponible */}
            <TouchableOpacity
              onPress={randomizeStyle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.comboShuffle, { backgroundColor: colors.primary + "14" }]}
              activeOpacity={0.7}
            >
              <Ionicons name="shuffle" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Modal: Reporte de feedback */}
      <Modal
        visible={feedbackVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFeedbackVisible(false)}
      >
        <View style={styles.feedbackOverlay}>
          <View style={[styles.feedbackCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.feedbackHeader}>
              <Ionicons name="bug-outline" size={20} color={colors.primary} />
              <AppText style={[styles.feedbackTitle, { color: colors.textPrimary }]}>Reportar inconsistencia visual</AppText>
            </View>

            <AppText style={[styles.feedbackInfo, { color: colors.warning }]}>
              Solo reporta aquí problemas visuales o incongruencias de estilo
              (temas, fondos, colores, movimientos, brillos). No uses esto para
              reportar errores de funcionamiento de la app.
            </AppText>

            <TextInput
              style={[styles.feedbackInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Explica qué incongruencia visual encontraste y cómo debería verse... (mín. 50 palabras)"
              placeholderTextColor={colors.textSecondary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={feedbackText}
              onChangeText={setFeedbackText}
            />

            <View style={[styles.feedbackBadgesContainer, { borderColor: colors.border }]}>
              <AppText style={[styles.feedbackConfigLabel, { color: colors.textSecondary }]}>
                Tu configuración actual:
              </AppText>
              <View style={styles.feedbackBadgesRow}>
                {[
                  { icon: "color-palette-outline" as const, label: "Tema", value: allThemes.find(t => t.id === activeVariantId)?.name ?? activeVariantId },
                  { icon: "grid-outline" as const, label: "Fondo", value: allBackgrounds.find(b => b.id === activeBackgroundId)?.name ?? activeBackgroundId },
                  { icon: "radio-button-on-outline" as const, label: "Botón", value: capitalize(activeButtonColorId) },
                  { icon: "stats-chart-outline" as const, label: "Gráfica", value: chart.allChartColors.find(c => c.id === chart.activeChartColorId)?.name ?? chart.activeChartColorId },
                  { icon: "move-outline" as const, label: "Movimiento", value: movement.allMovementLayers.find(m => m.id === movement.movementLayerId)?.name ?? movement.movementLayerId },
                  { icon: "sunny-outline" as const, label: "Brillo", value: glow.allGlowPresets.find(g => g.id === glow.glowId)?.name ?? glow.glowId },
                  { icon: "flash-outline" as const, label: "Intensidad", value: `${glow.glowIntensity}%` },
                  { icon: "contrast-outline" as const, label: "Modo", value: mode === "light" ? "Claro" : mode === "dark" ? "Oscuro" : "Sistema" },
                ].map(item => (
                  <View key={item.label} style={[styles.feedbackBadge, { backgroundColor: colors.background + "80", borderColor: colors.border }]}>
                    <Ionicons name={item.icon} size={12} color={colors.primary} />
                    <AppText style={[styles.feedbackBadgeLabel, { color: colors.textSecondary }]}>{item.label}</AppText>
                    <AppText style={[styles.feedbackBadgeValue, { color: colors.textPrimary }]}>{item.value}</AppText>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.feedbackActions}>
              <TouchableOpacity
                style={[styles.feedbackBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setFeedbackVisible(false)}
                disabled={sendingFeedback}
              >
                <AppText style={[styles.feedbackBtnText, { color: colors.textPrimary }]}>Cancelar</AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.feedbackBtn, styles.feedbackBtnPrimary, { backgroundColor: colors.primary }]}
                onPress={handleSendFeedback}
                disabled={sendingFeedback}
              >
                <Ionicons name="mail-outline" size={16} color="#fff" />
                <AppText style={[styles.feedbackBtnText, { color: "#fff" }]}>
                  {sendingFeedback ? "Enviando..." : "Enviar reporte"}
                </AppText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Información de puntos */}
      <Modal
        visible={ptsInfoVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setPtsInfoVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.ptsCardHeader}>
              <AppText style={[styles.ptsCardTitle, { color: colors.textPrimary }]}>¿Cómo ganar puntos?</AppText>
            </View>

            <View style={styles.ptsSection}>
              <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Gana puntos</AppText>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="checkbox-outline" size={16} color={colors.success} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Completar una tarea</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.warning }]}>+10 pts</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="flag-outline" size={16} color={colors.success} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Completar un paso de meta</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.warning }]}>+5 pts</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="trophy-outline" size={16} color={colors.success} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Finalizar una meta</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.warning }]}>+50 pts</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="bug-outline" size={16} color={colors.success} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Reportar problema visual</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.warning }]}>+10 pts</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="gift-outline" size={16} color={colors.success} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Puntos gratis (una vez)</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.warning }]}>+50 pts</AppText>
              </View>
            </View>

            <View style={styles.ptsSection}>
              <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Gasta puntos</AppText>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="color-palette-outline" size={16} color={colors.primary} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Temas y fondos</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.textPrimary }]}>50 pts c/u</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="radio-button-on-outline" size={16} color={colors.primary} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Colores de botón y gráfica</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.textPrimary }]}>5 pts c/u</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="move-outline" size={16} color={colors.primary} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Movimientos</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.textPrimary }]}>5-8 pts</AppText>
              </View>
              <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                <Ionicons name="sunny-outline" size={16} color={colors.primary} />
                <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Brillos</AppText>
                <AppText style={[styles.ptsRowValue, { color: colors.textPrimary }]}>5-50 pts</AppText>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.ptsBtn, { backgroundColor: colors.primary }]}
              onPress={() => setPtsInfoVisible(false)}
            >
              <AppText style={styles.ptsBtnText}>Entendido</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Guía de la tienda */}
      <Modal
        visible={shopHelpVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setShopHelpVisible(false)}
      >
        <View style={styles.ptsOverlay}>
          <View style={[styles.ptsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.ptsCardHeader}>
              <AppText style={[styles.ptsCardTitle, { color: colors.textPrimary }]}>Cómo funciona la tienda</AppText>
            </View>

            <ScrollView contentContainerStyle={styles.helpScroll} showsVerticalScrollIndicator={false}>
              <AppText style={[styles.ptsHelpText, { color: colors.textSecondary }]}>
                Aquí personalizas toda la app: temas, fondos, colores, movimientos y brillos. Todo se consigue con puntos, tu saldo de la app.
              </AppText>

              <View style={styles.ptsSection}>
                <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Arriba</AppText>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="star" size={16} color={colors.warning} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Tu saldo en puntos. Tócalo para ver cómo ganarlos.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="bug-outline" size={16} color={colors.textSecondary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Reporta un problema visual y gana +10 pts. Cada reporte cuenta una vez.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="moon-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Modo Oscuro / Claro / Sistema, disponible al inicio de la lista.</AppText>
                </View>
              </View>

              <View style={styles.ptsSection}>
                <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Acordeones</AppText>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="chevron-down-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Toca un título para abrir sus estilos; tocarlo de nuevo lo cierra.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="checkmark-done-outline" size={16} color={colors.success} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Elegir un estilo lo equipa al instante y el panel se cierra solo.</AppText>
                </View>
              </View>

              <View style={styles.ptsSection}>
                <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Cards de estilo</AppText>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Candado y precio: no lo tienes. Tocarla pide confirmación para comprar.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="hand-left-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Sin candado: ya es tuyo. Un toque lo pone en uso.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Check o marca "Activo": es el que se está usando ahora.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="color-fill-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>En "Color secundario" aparece "+50 pts gratis" una sola vez.</AppText>
                </View>
              </View>

              <View style={styles.ptsSection}>
                <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Recomendados</AppText>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="star-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Combos con un concepto visual que agrupan los seis estilos. Compras solo lo que te falta en un pago.</AppText>
                </View>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="flash-outline" size={16} color={colors.success} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Al estar completo, tocar la card equipa los 6 estilos a la vez (verás una carga breve).</AppText>
                </View>
              </View>

              <View style={styles.ptsSection}>
                <AppText style={[styles.ptsSectionTitle, { color: colors.textSecondary }]}>Personalización total</AppText>
                <View style={[styles.ptsRow, { borderColor: colors.border }]}>
                  <Ionicons name="infinite-outline" size={16} color={colors.primary} />
                  <AppText style={[styles.ptsRowText, { color: colors.textPrimary }]}>Última card: combina lo que ya tienes. El botón de mezcla aplica un estilo aleatorio.</AppText>
                </View>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.ptsBtn, { backgroundColor: colors.primary }]}
              onPress={() => setShopHelpVisible(false)}
            >
              <AppText style={styles.ptsBtnText}>Entendido</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}