import React, { useRef, useState } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "../../../lib/theme";
import { PeriodPoint } from "../../../lib/storage/types";
import AppText from "../../ui/AppText";
import GlowView from "../../ui/GlowView";
import { formatCurrency } from "../../../lib/currency";

type PeriodStats = {
  income: number;
  expenses: number;
  balance: number;
};

type Props = {
  weekStats: PeriodStats;
  monthStats: PeriodStats;
  yearStats: PeriodStats;
  weekBreakdown: PeriodPoint[];
  monthBreakdown: PeriodPoint[];
  yearBreakdown: PeriodPoint[];
};

const PERIODS = ["Semana", "Mes", "Año"] as const;
const CHART_H = 52;
const DOT_R = 2.5;
const CHART_PAD = 6;

type ChartProps = { data: PeriodPoint[] };

// Calcula el estilo de un segmento de línea entre puntos: coloca un View
// delgado, lo rota con transform:rotate() y lo posiciona con coordenadas
// absolutas. Es un SVG casero sin dependencias externas.
function lineSegmentStyle(
  x1: number, y1: number,
  x2: number, y2: number,
  color: string
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return {
    position: "absolute" as const,
    left: (x1 + x2) / 2 - length / 2,
    top: (y1 + y2) / 2 - 1,
    width: length,
    height: 2,
    backgroundColor: color,
    borderRadius: 1,
    transform: [{ rotate: `${angle}deg` }],
  };
}

// Grafico de lineas minimalista sin dependencias externas (solo Views con
// rotacion). El tope de la escala es el dia MAS alto del periodo con 25% de
// tolerancia (igual que en Balances): el pico queda dentro del area y no se
// desborda por arriba. Si no hay datos se usa 1 para evitar division por cero.
  function MiniLineChart({ data }: ChartProps) {
    const colors = useTheme();
    const chartStyles = getChartStyles(colors);
    const [cw, setCw] = useState(0);
    const n = data.length;
    const series = data.map((d) => Math.max(d.income, d.expenses));
    const topValue = Math.max(...series, 1);
    const maxVal = topValue + topValue / 4;
  // Con demasiados puntos (vista mes día a día) se etiqueta cada N para evitar solapes.
  const labelStep = Math.max(1, Math.ceil(n / 12));

  // getX interpola linealmente la posicion horizontal de cada punto,
  // distribuyendolos uniformemente a lo ancho del area del grafico.
  function getX(i: number): number {
    if (n <= 1) return CHART_PAD;
    return CHART_PAD + (i / (n - 1)) * (cw - 2 * CHART_PAD);
  }

  // getY invierte la escala: el valor maximo se asigna a Y=0 (borde
  // superior del contenedor) y el valor 0 a Y=CHART_H (borde inferior).
  function getY(val: number): number {
    return CHART_H - (val / maxVal) * CHART_H;
  }

  function onLayout(e: LayoutChangeEvent) {
    setCw(e.nativeEvent.layout.width);
  }

  // Líneas horizontales que definen los valores del eje Y (máximo, mitad y cero),
  // igual que las etiquetas del eje X definen cada punto horizontal.
  const gridVals = [maxVal, maxVal / 2, 0];

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.chartArea} onLayout={onLayout}>
        {cw > 0 && (
          <>
            {gridVals.map((v) => (
              <View
                key={`grid${v}`}
                style={{
                  position: "absolute",
                  left: CHART_PAD,
                  right: CHART_PAD,
                  top: getY(v) - 0.5,
                  height: 1,
                  backgroundColor: colors.border,
                  opacity: v === 0 ? 0.45 : 0.35,
                }}
              />
            ))}
<View
                  style={{
                    position: "absolute",
                    left: CHART_PAD,
                    top: 0,
                width: 2,
                height: CHART_H,
                backgroundColor: colors.border,
                opacity: 0.9,
              }}
            />
            {data.slice(0, -1).map((_, i) => (
              <View
                key={`il${i}`}
                style={lineSegmentStyle(
                  getX(i), getY(data[i].income),
                  getX(i + 1), getY(data[i + 1].income),
                  colors.chartPositive || colors.success
                )}
              />
            ))}
            {data.slice(0, -1).map((_, i) => (
              <View
                key={`el${i}`}
                style={lineSegmentStyle(
                  getX(i), getY(data[i].expenses),
                  getX(i + 1), getY(data[i + 1].expenses),
                  colors.chartNegative || colors.error
                )}
              />
            ))}
            {data.map((point, i) => (
              <View
                key={`id${i}`}
                style={[
                  chartStyles.dot,
                  chartStyles.dotIncome,
                  { left: getX(i) - DOT_R, top: getY(point.income) - DOT_R },
                ]}
              />
            ))}
            {data.map((point, i) => (
              <View
                key={`ed${i}`}
                style={[
                  chartStyles.dot,
                  chartStyles.dotExpense,
                  { left: getX(i) - DOT_R, top: getY(point.expenses) - DOT_R },
                ]}
              />
            ))}
          </>
        )}
      </View>

      {/* Etiquetas del eje X: cada número centrado exactamente bajo su punto,
          usando la misma medición de ancho y fórmula de posición que el gráfico.
          Con muchos puntos (mes día a día) se etiqueta cada N días para que no se solapen. */}
      <View style={chartStyles.labelsRow}>
        {cw > 0 &&
          data.map((_, i) => {
            if (i % labelStep !== 0) return null;
            // El ancho de la etiqueta abarca el tramo entero de días que representa
            // (labelStep celdas), así un número de dos dígitos cabe en una sola línea.
            const cellW = n > 1 ? (cw - 2 * CHART_PAD) / (n - 1) : cw;
            const labelW = cellW * labelStep;
            const left = CHART_PAD + (i / Math.max(n - 1, 1)) * (cw - 2 * CHART_PAD) - labelW / 2;
            return (
              <View key={i} style={[chartStyles.labelCell, { left, width: labelW }]}>
                <AppText numberOfLines={1} style={chartStyles.label}>{i + 1}</AppText>
              </View>
            );
          })}
      </View>
    </View>
  );
}

function getChartStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    chartArea: {
      height: CHART_H,
      position: "relative",
      // El pico de un recurrente excede la escala (segundo día más alto + 25%):
      // queda recortado dentro del área en vez de dibujarse sobre lo demás.
      overflow: "hidden",
    },
    dot: {
      position: "absolute",
      width: DOT_R * 2,
      height: DOT_R * 2,
      borderRadius: DOT_R,
    },
    dotIncome: {
      backgroundColor: colors.chartPositive || colors.success,
    },
    dotExpense: {
      backgroundColor: colors.chartNegative || colors.error,
    },
    labelsRow: {
      position: "relative",
      height: 14,
      marginTop: 5,
    },
    labelCell: {
      position: "absolute",
      alignItems: "center",
    },
    label: {
      fontSize: 8,
      color: colors.textSecondary,
    },
  });
}

export default function FinancePeriodCard({
  weekStats,
  monthStats,
  yearStats,
  weekBreakdown,
  monthBreakdown,
  yearBreakdown,
}: Props) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const { width } = useWindowDimensions();
  const cardWidth = width - 32;
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState(0);

  const statsByPeriod = [weekStats, monthStats, yearStats];
  const breakdownByPeriod = [weekBreakdown, monthBreakdown, yearBreakdown];

  function scrollToPage(index: number) {
    scrollRef.current?.scrollTo({ x: index * cardWidth, animated: true });
    setActivePage(index);
  }

  // Sincroniza el indicador activo al deslizar el scroll horizontal.
  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = e.nativeEvent.contentOffset.x;
    const page = Math.round(offset / cardWidth);
    if (page !== activePage) setActivePage(page);
  }

  return (
    <GlowView cardRadius={16} style={styles.wrapper}>
      <View style={styles.tabs}>
        {PERIODS.map((label, i) => (
          <TouchableOpacity
            key={label}
            style={styles.tab}
            onPress={() => scrollToPage(i)}
            activeOpacity={0.7}
          >
            <AppText style={[styles.tabLabel, activePage === i && styles.tabLabelActive]}>
              {label}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.indicatorTrack}>
        <View
          style={[
            styles.indicatorBar,
            {
              width: `${100 / PERIODS.length}%`,
              left: `${(activePage * 100) / PERIODS.length}%`,
            },
          ]}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={32}
      >
        {statsByPeriod.map((stats, i) => {
          const isPositive = stats.balance >= 0;
          return (
            <View key={i} style={[styles.page, { width: cardWidth }]}>
              <View style={styles.chartSide}>
                <MiniLineChart data={breakdownByPeriod[i]} />
              </View>

              <View style={styles.statsSide}>
                <AppText style={styles.balanceLabel}>Balance</AppText>
                <AppText style={[styles.balanceValue, isPositive ? styles.colorSuccess : styles.colorError]} numberOfLines={1}>
                  {isPositive ? "+" : ""}
                  {formatCurrency(stats.balance)}
                </AppText>

                <View style={styles.statsDivider} />

                <View style={styles.statRow}>
                  <Ionicons name="arrow-up-outline" size={12} color={colors.chartPositive || colors.success} />
                  <AppText style={[styles.statValue, styles.colorSuccess]} numberOfLines={1}>
                    {formatCurrency(stats.income)}
                  </AppText>
                </View>
                <View style={styles.statRow}>
                  <Ionicons name="arrow-down-outline" size={12} color={colors.chartNegative || colors.error} />
                  <AppText style={[styles.statValue, styles.colorError]} numberOfLines={1}>
                    {formatCurrency(stats.expenses)}
                  </AppText>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.legend}>
        <View style={[styles.legendDot, styles.legendDotIncome]} />
        <AppText style={styles.legendText}>Ingresos</AppText>
        <View style={[styles.legendDot, styles.legendDotExpense]} />
        <AppText style={styles.legendText}>Gastos</AppText>
      </View>
    </GlowView>
  );
}

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrapper: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: 20,
    },
    tabs: {
      flexDirection: "row",
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
    },
    tabLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    tabLabelActive: {
      color: colors.primary,
      fontWeight: "700",
    },
    indicatorTrack: {
      height: 2,
      backgroundColor: colors.border,
      position: "relative",
    },
    indicatorBar: {
      position: "absolute",
      height: 2,
      backgroundColor: colors.primary,
      borderRadius: 1,
    },
    page: {
      flexDirection: "row",
      paddingHorizontal: 14,
      paddingVertical: 16,
    },
    chartSide: {
      flex: 5,
      paddingRight: 10,
    },
    statsSide: {
      flex: 4,
      paddingLeft: 12,
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
      justifyContent: "center",
      gap: 3,
      minWidth: 0,
    },
    balanceLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: "500",
    },
    balanceValue: {
      fontSize: 20,
      fontWeight: "bold",
      flexShrink: 1,
    },
    statsDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 6,
    },
    statRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    statValue: {
      fontSize: 13,
      fontWeight: "600",
      flex: 1,
    },
    colorSuccess: {
      color: colors.chartPositive || colors.success,
    },
    colorError: {
      color: colors.chartNegative || colors.error,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingBottom: 10,
      gap: 5,
    },
    legendDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    legendDotIncome: {
      backgroundColor: colors.chartPositive || colors.success,
    },
    legendDotExpense: {
      backgroundColor: colors.chartNegative || colors.error,
    },
    legendText: {
      fontSize: 10,
      color: colors.textSecondary,
      marginRight: 8,
    },
  });
}

