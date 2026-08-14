import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTheme, useGlow, ThemeColors } from "../lib/theme";
import { useHomeData } from "../hooks/useHomeData";
import { useWeather } from "../hooks/useWeather";
import FinancePeriodCard from "../components/features/finance/FinancePeriodCard";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import AppText from "../components/ui/AppText";
import GlowView from "../components/ui/GlowView";
import { Goal } from "../lib/storage/types";
import { formatCurrency } from "../lib/currency";

// Pantalla principal (Dashboard): clima, resumen rápido, finanzas, metas en
// curso, tareas pendientes, deseos y notas recientes. Todo enlaza a su tab.
export default function HomeScreen() {
  const colors = useTheme();
  const { glowStyle } = useGlow();
  const styles = getStyles(colors);
  const router = useRouter();

  const {
    userName,
    tasks,
    notes,
    weekStats,
    monthStats,
    yearStats,
    weekBreakdown,
    monthBreakdown,
    yearBreakdown,
    goals,
    wishItems,
    loading,
  } = useHomeData();
  const { weather } = useWeather();
  const [weatherModalVisible, setWeatherModalVisible] = useState(false);

  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return "Buenos días";
    if (hr < 18) return "Buenas tardes";
    return "Buenas noches";
  };

  const todayLabel = new Date().toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <View style={styles.wrapper}>
      <BackgroundDecor colors={colors} screenVariant={0} />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>

      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
      <React.Fragment>
        {/* Cabecera: saludo + fecha + clima */}
        <View style={styles.header}>
        <View style={styles.headerLeft}>
          <AppText style={styles.greeting}>{getGreeting()}</AppText>
          <AppText style={styles.userName} numberOfLines={1}>{userName || "Usuario"}</AppText>
          <AppText style={styles.today} numberOfLines={1}>
            {todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
          </AppText>
        </View>
        {weather && (
          <TouchableOpacity onPress={() => setWeatherModalVisible(true)} activeOpacity={0.7} style={[styles.weatherChip, glowStyle]}>
            <Ionicons
              name={weather.iconName as keyof typeof Ionicons.glyphMap}
              size={22}
              color={colors.primary}
            />
            <View style={styles.weatherInfo}>
              <AppText style={styles.weatherTemp} numberOfLines={1}>
                {weather.temperature}°  {weather.condition}
              </AppText>
              {weather.cityName ? (
                <AppText style={styles.weatherCity} numberOfLines={1}>{weather.cityName}</AppText>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Resumen rápido: 4 stat-tiles navegables */}
      <View style={styles.statsRow}>
        <StatTile
          styles={styles}
          glowStyle={glowStyle}
          icon="checkbox-outline"
          value={String(tasks.length)}
          label="Tareas"
          color={colors.primary}
          onPress={() => router.push("/tasks")}
        />
        <StatTile
          styles={styles}
          glowStyle={glowStyle}
          icon="trending-up-outline"
          value={formatCompact(monthStats.income)}
          label="Ingresos mes"
          color={colors.success}
          onPress={() => router.push("/finance")}
        />
        <StatTile
          styles={styles}
          glowStyle={glowStyle}
          icon="trending-down-outline"
          value={formatCompact(monthStats.expenses)}
          label="Gastos mes"
          color={colors.error}
          onPress={() => router.push("/finance")}
        />
        <StatTile
          styles={styles}
          glowStyle={glowStyle}
          icon="wallet-outline"
          value={formatCompact(monthStats.balance)}
          label="Balance mes"
          color={monthStats.balance >= 0 ? colors.success : colors.error}
          onPress={() => router.push("/finance")}
        />
      </View>

      {/* Sección de finanzas con deslizamiento por periodo */}
      <View style={styles.sectionHeader}>
        <AppText style={styles.sectionTitle}>Finanzas</AppText>
        <TouchableOpacity onPress={() => router.push("/finance")}>
          <AppText style={styles.seeAll}>Ver detalle</AppText>
        </TouchableOpacity>
      </View>

      <FinancePeriodCard
        weekStats={weekStats}
        monthStats={monthStats}
        yearStats={yearStats}
        weekBreakdown={weekBreakdown}
        monthBreakdown={monthBreakdown}
        yearBreakdown={yearBreakdown}
      />

      {/* Metas en curso: progreso compacto por meta */}
      {goals.length > 0 && (
        <React.Fragment>
          <View style={[styles.sectionHeader, styles.sectionSpaced]}>
            <AppText style={styles.sectionTitle}>Metas</AppText>
            <TouchableOpacity onPress={() => router.push("/goals")}>
              <AppText style={styles.seeAll}>Ver todas</AppText>
            </TouchableOpacity>
          </View>

          <GlowView style={styles.list} cardRadius={12}>
            {goals.map((goal, index) => {
              const { pct, meta } = computeGoalProgress(goal);
              const color = goalColor(goal, colors);
              return (
                <TouchableOpacity
                  key={goal.id}
                  style={[styles.goalRow, index === goals.length - 1 && styles.listItemLast]}
                  onPress={() => router.push("/goals")}
                  activeOpacity={0.75}
                >
                  <View style={[styles.goalIconWrap, { backgroundColor: color + "18", borderColor: color + "40" }]}>
                    <Ionicons name={goalIcon(goal)} size={17} color={color} />
                  </View>
                  <View style={styles.goalInfo}>
                    <AppText style={styles.goalTitle} numberOfLines={1}>{goal.title}</AppText>
                    <View style={styles.goalBar}>
                      <View
                        style={[
                          styles.goalBarFill,
                          { width: `${Math.round(pct * 100)}%` as any, backgroundColor: color },
                        ]}
                      />
                    </View>
                    <AppText style={styles.goalMeta} numberOfLines={1}>{meta}</AppText>
                  </View>
                  <AppText style={[styles.goalPct, { color }]}>{Math.round(pct * 100)}%</AppText>
                </TouchableOpacity>
              );
            })}
          </GlowView>
        </React.Fragment>
      )}

      {/* Tareas Pendientes */}
      <View style={[styles.sectionHeader, styles.sectionSpaced]}>
        <AppText style={styles.sectionTitle}>Tareas Pendientes</AppText>
        <TouchableOpacity onPress={() => router.push("/tasks")}>
          <AppText style={styles.seeAll}>Ver todas</AppText>
        </TouchableOpacity>
      </View>

      {tasks.length === 0 ? (
        <GlowView style={styles.emptyCard} cardRadius={12}>
          <AppText style={styles.emptyText}>Sin tareas pendientes</AppText>
        </GlowView>
      ) : (
        <GlowView style={styles.list} cardRadius={12}>
          {tasks.map((task, index) => (
            <TouchableOpacity
              key={task.id}
              style={[styles.listItem, index === tasks.length - 1 && styles.listItemLast]}
              onPress={() => router.push("/tasks")}
            >
              <Ionicons name="square-outline" size={18} color={colors.primary} />
              <AppText style={styles.listText} numberOfLines={1}>{task.title}</AppText>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </GlowView>
      )}

      {/* Deseos: mini-cards con precio */}
      {wishItems.length > 0 && (
        <React.Fragment>
          <View style={[styles.sectionHeader, styles.sectionSpaced]}>
            <AppText style={styles.sectionTitle}>Deseos</AppText>
            <TouchableOpacity onPress={() => router.push("/wishlist")}>
              <AppText style={styles.seeAll}>Ver todos</AppText>
            </TouchableOpacity>
          </View>

          <View style={styles.notesGrid}>
            {wishItems.map((wish) => (
              <TouchableOpacity
                key={wish.id}
                style={[styles.noteCard, glowStyle]}
                onPress={() => router.push("/wishlist")}
                activeOpacity={0.75}
              >
                <AppText style={styles.noteText} numberOfLines={3}>{wish.title}</AppText>
                <AppText style={styles.wishAmount} numberOfLines={1}>
                  {wish.amount != null ? formatCurrency(wish.amount) : "Sin precio"}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>
        </React.Fragment>
      )}

      {/* Notas Recientes */}
      <View style={[styles.sectionHeader, styles.sectionSpaced]}>
        <AppText style={styles.sectionTitle}>Notas Recientes</AppText>
        <TouchableOpacity onPress={() => router.push("/notes")}>
          <AppText style={styles.seeAll}>Ver todas</AppText>
        </TouchableOpacity>
      </View>

      {notes.length === 0 ? (
        <GlowView style={styles.emptyCard} cardRadius={12}>
          <AppText style={styles.emptyText}>Sin notas recientes</AppText>
        </GlowView>
      ) : (
        <View style={styles.notesGrid}>
          {notes.map((note) => (
            <TouchableOpacity
              key={note.id}
              style={[styles.noteCard, glowStyle]}
              onPress={() => router.push("/notes")}
              activeOpacity={0.75}
            >
              <AppText style={styles.noteText} numberOfLines={4}>{note.title ?? note.content}</AppText>
              <AppText style={styles.noteDate}>
                {new Date(note.createdAt).toLocaleDateString("es", {
                  day: "numeric",
                  month: "short",
                })}
              </AppText>
            </TouchableOpacity>
          ))}
        </View>
      )}

      </React.Fragment>
      )}

    </ScrollView>

      {/* Modal de clima detallado */}
      <Modal visible={weatherModalVisible} transparent animationType="fade" onRequestClose={() => setWeatherModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <GlowView style={styles.weatherModalCard} cardRadius={12}>
            <View style={styles.weatherModalHeader}>
              <AppText style={styles.weatherModalTitle}>Clima</AppText>
              <TouchableOpacity onPress={() => setWeatherModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {weather && (
              <>
                {/* Ciudad + país */}
                <View style={styles.weatherModalRow}>
                  <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
                  <AppText style={styles.weatherModalLabel}>
                    {weather.cityName}{weather.country ? `, ${weather.country}` : ""}
                  </AppText>
                </View>

                {/* Temperatura real y sensación */}
                <View style={styles.weatherModalRow}>
                  <Ionicons name="thermometer-outline" size={16} color={colors.textSecondary} />
                  <AppText style={styles.weatherModalLabel}>
                    {weather.temperature}° (sensación {weather.apparentTemp}°)
                  </AppText>
                </View>

                {/* Condición */}
                <View style={styles.weatherModalRow}>
                  <Ionicons name={weather.iconName as keyof typeof Ionicons.glyphMap} size={16} color={colors.textSecondary} />
                  <AppText style={styles.weatherModalLabel}>{weather.condition}</AppText>
                </View>

                {/* Humedad */}
                <View style={styles.weatherModalRow}>
                  <Ionicons name="water-outline" size={16} color={colors.textSecondary} />
                  <AppText style={styles.weatherModalLabel}>Humedad: {weather.humidity}%</AppText>
                </View>

                {/* Viento */}
                <View style={styles.weatherModalRow}>
                  <Ionicons name="speedometer-outline" size={16} color={colors.textSecondary} />
                  <AppText style={styles.weatherModalLabel}>Viento: {weather.windSpeed} km/h</AppText>
                </View>
              </>
            )}

            <TouchableOpacity style={styles.weatherModalBtn} onPress={() => setWeatherModalVisible(false)}>
              <AppText style={styles.weatherModalBtnText}>Cerrar</AppText>
            </TouchableOpacity>
          </GlowView>
        </View>
      </Modal>
    </View>
  );
}

type StatTileProps = {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
  onPress: () => void;
  glowStyle: object;
  styles: ReturnType<typeof getStyles>;
};

// Tile de resumen rápido: icono + valor + etiqueta, navega a su sección.
function StatTile({ icon, value, label, color, onPress, glowStyle, styles }: StatTileProps) {
  return (
    <TouchableOpacity style={[styles.statTile, glowStyle]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={17} color={color} />
      <AppText style={styles.statValue} numberOfLines={1}>{value}</AppText>
      <AppText style={styles.statLabel} numberOfLines={1}>{label}</AppText>
    </TouchableOpacity>
  );
}

// Progreso compacto de una meta para el dashboard. Misma lógica que GoalCard:
// pagos/periodos por instalments, alcancía/ahorro libre por aportes, resto pasos.
function computeGoalProgress(goal: Goal): { pct: number; meta: string } {
  const isPot = goal.type === "pot";
  const isFreeSavings = goal.type === "savings" && !(goal.installments ?? 0);
  const hasInstallments =
    (goal.type === "savings" && (goal.installments ?? 0) > 0) || goal.type === "payment";

  if (hasInstallments) {
    const pct = goal.installments ? (goal.completedInstallments ?? 0) / goal.installments : 0;
    return {
      pct: Math.min(1, pct),
      meta: `${goal.completedInstallments ?? 0} de ${goal.installments} pagos`,
    };
  }

  if (isPot || isFreeSavings) {
    const accumulated = (goal.contributions ?? []).reduce((s, c) => s + (c.amount ?? 0), 0);
    const total = goal.totalAmount ?? 0;
    return {
      pct: total > 0 ? Math.min(1, accumulated / total) : 0,
      meta: `Ahorrado ${formatCurrency(accumulated)}`,
    };
  }

  const done = goal.steps.filter((s) => s.completed).length;
  return {
    pct: goal.steps.length ? done / goal.steps.length : 0,
    meta: `${done} de ${goal.steps.length} pasos`,
  };
}

function goalColor(goal: Goal, colors: ThemeColors): string {
  if (goal.type === "payment") return colors.warning;
  if (goal.type === "pot") return colors.success;
  return colors.primary;
}

function goalIcon(goal: Goal): keyof typeof Ionicons.glyphMap {
  if (goal.type === "savings") return "wallet-outline";
  if (goal.type === "payment") return "card-outline";
  if (goal.type === "pot") return "cash-outline";
  return "flag-outline";
}

// Formato corto para stat-tiles: millones y miles resumidos, resto con formatCurrency.
function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)} M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(0)} k`;
  return formatCurrency(amount);
}

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollInner: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 48,
    },

    /* Cabecera */
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
    },
    headerLeft: {
      flex: 1,
      marginRight: 12,
      minWidth: 0,
    },
    greeting: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: "500",
    },
    userName: {
      fontSize: 26,
      fontWeight: "bold",
      color: colors.textPrimary,
      marginTop: 2,
    },
    today: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },

    /* Chip de clima */
    weatherChip: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 8,
      flexShrink: 1,
      maxWidth: "60%",
      marginTop: 18,
    },
    weatherInfo: {
      flexShrink: 1,
      minWidth: 0,
    },
    weatherTemp: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textPrimary,
      flexShrink: 1,
    },
    weatherCity: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 1,
    },

    /* Resumen rápido */
    statsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 20,
    },
    statTile: {
      flex: 1,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
      alignItems: "center",
      gap: 4,
      minWidth: 0,
    },
    statValue: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.textPrimary,
      textAlign: "center",
    },
    statLabel: {
      fontSize: 10.5,
      color: colors.textSecondary,
      textAlign: "center",
    },

    /* Sección headers */
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    sectionSpaced: {
      marginTop: 20,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    seeAll: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.primary,
    },

    /* Empty state */
    emptyCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      alignItems: "center",
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },

    /* Lista compartida: metas y tareas */
    list: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      overflow: "hidden",
    },
    listItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    listItemLast: {
      borderBottomWidth: 0,
    },
    listText: {
      fontSize: 14,
      color: colors.textPrimary,
      flex: 1,
    },

    /* Fila de meta en el dashboard */
    goalRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    goalIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    goalInfo: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    goalTitle: {
      fontSize: 13.5,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    goalBar: {
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.border,
      overflow: "hidden",
    },
    goalBarFill: {
      height: 5,
      borderRadius: 2.5,
    },
    goalMeta: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    goalPct: {
      fontSize: 13,
      fontWeight: "700",
    },

    /* Grid de notas y deseos */
    notesGrid: {
      flexDirection: "row",
      gap: 12,
    },
    noteCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      justifyContent: "space-between",
      minHeight: 100,
    },
    noteText: {
      fontSize: 13,
      color: colors.textPrimary,
      lineHeight: 19,
      flex: 1,
    },
    noteDate: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 6,
    },
    wishAmount: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.primary,
      marginTop: 6,
    },

    /* Modal clima */
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    weatherModalCard: {
      width: "100%",
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      gap: 14,
    },
    weatherModalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    weatherModalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    weatherModalRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    weatherModalLabel: {
      fontSize: 15,
      color: colors.textPrimary,
      flex: 1,
    },
    weatherModalBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: "center",
      marginTop: 4,
    },
    weatherModalBtnText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#FAF8F5",
    },
  });
}