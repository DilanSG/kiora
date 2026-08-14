import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Platform,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
  Switch,
} from "react-native";
import { KeyboardAvoidingView } from "../components/ui/KeyboardAvoiding";
import { useRef, useState, useMemo, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors, useGlow } from "../lib/theme";
import { useTransactions } from "../hooks/useTransactions";
import { Transaction, PeriodPoint, RecurringExpense, RecurringInterval } from "../lib/storage/types";
import { addTransactionsBatch, getMonthlyStats, getWeeklyBreakdownForMonth, getWeeklyStatsForWeek, getDailyBreakdownForWeekDate, getYearlyStats, getMonthlyBreakdownForYear, syncFromN8n, computeNextRecurrence } from "../lib/storage";
import { requestSmsPermission, readSmsInbox, classifySmsMessages, ParsedMovement, SmsPermissionResult, openAppSettings } from "../lib/native/SmsReader";
import { TransactionCard } from "../components/features/finance/TransactionCard";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import EmptyState from "../components/ui/EmptyState";
import AppText from "../components/ui/AppText";
import { useAlert } from "../components/ui/AlertModal";
import GlowView from "../components/ui/GlowView";
import { formatCurrency } from "../lib/currency";
import { CalendarPicker, MONTHS_ES } from "../components/ui/CalendarPicker";

// ─── Gráfico de líneas ─────────────────────────────────────────────────────

const CHART_H = 100;
const DOT_R = 3;
const Y_AXIS_W = 44;
const PERIODS = ["Semana", "Mes", "Año"] as const;

const DAYS_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_ES_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Formatea un valor numérico como etiqueta compacta para el eje Y.
function formatYVal(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 10_000) return `${Math.round(val / 1_000)}k`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return String(Math.round(val));
}

// Eje Y con tres etiquetas (máximo, mitad y cero) alineadas verticalmente al área del gráfico.
function YAxis({ maxVal }: { maxVal: number }) {
  const colors = useTheme();
  const lblStyle = { fontSize: 8, color: colors.textSecondary };
  return (
    <View style={{ width: Y_AXIS_W, height: CHART_H }}>
      <AppText
        numberOfLines={1}
        disableHorizontalPadding
        style={[lblStyle, { position: "absolute", top: 0, right: 4 }]}
      >
        {formatYVal(maxVal)}
      </AppText>
      <AppText
        numberOfLines={1}
        disableHorizontalPadding
        style={[lblStyle, { position: "absolute", top: CHART_H / 2 - 5, right: 4 }]}
      >
        {formatYVal(maxVal / 2)}
      </AppText>
      <AppText
        numberOfLines={1}
        disableHorizontalPadding
        style={[lblStyle, { position: "absolute", bottom: 0, right: 4 }]}
      >
        0
      </AppText>
    </View>
  );
}

// Renderiza un segmento de linea entre dos puntos usando una View con
// rotacion CSS. La linea se posiciona en el centro del segmento y se
// rota segun el angulo entre (x1,y1) y (x2,y2). Es una alternativa ligera
// a react-native-svg para graficos simples sin dependencias extra.
function lineSegmentStyle(
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  thickness = 2
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return {
    position: "absolute" as const,
    left: (x1 + x2) / 2 - length / 2,
    top: (y1 + y2) / 2 - thickness / 2,
    width: length,
    height: thickness,
    backgroundColor: color,
    borderRadius: thickness / 2,
    transform: [{ rotate: `${angle}deg` }],
  };
}

// Gráfico de líneas comparativo (ingresos vs gastos) con puntos centrados en cada celda de etiqueta.
// El ahorro se dibuja como línea fina de 1px sobre la de ingresos; los gastos
// recurrentes ya forman parte del total de gastos y no tienen serie propia.
function FinanceLineChart({ data, maxVal, showSavings = false }: { data: PeriodPoint[]; maxVal: number; showSavings?: boolean }) {
  const colors = useTheme();
  const [cw, setCw] = useState(0);
  const n = data.length;

  function getX(i: number): number {
    if (cw === 0 || n === 0) return 0;
    return cw * (i + 0.5) / n;
  }
  function getY(val: number): number {
    return CHART_H - (val / maxVal) * CHART_H;
  }

  return (
    <View
      style={{ height: CHART_H, position: "relative" }}
      onLayout={(e: LayoutChangeEvent) => setCw(e.nativeEvent.layout.width)}
    >
      {cw > 0 && (
        <>
          {data.slice(0, -1).map((_, i) => (
            <View key={`il${i}`} style={lineSegmentStyle(getX(i), getY(data[i].income), getX(i + 1), getY(data[i + 1].income), colors.chartPositive || colors.success)} />
          ))}
          {data.slice(0, -1).map((_, i) => (
            <View key={`el${i}`} style={lineSegmentStyle(getX(i), getY(data[i].expenses), getX(i + 1), getY(data[i + 1].expenses), colors.chartNegative || colors.error)} />
          ))}
          {showSavings && data.slice(0, -1).map((_, i) => (
            <View key={`sl${i}`} style={lineSegmentStyle(getX(i), getY(data[i].savings ?? 0), getX(i + 1), getY(data[i + 1].savings ?? 0), colors.chartPositive || colors.success, 1)} />
          ))}
          {data.map((p, i) => (
            <View key={`id${i}`} style={{ position: "absolute", width: DOT_R * 2, height: DOT_R * 2, borderRadius: DOT_R, backgroundColor: colors.chartPositive || colors.success, left: getX(i) - DOT_R, top: getY(p.income) - DOT_R }} />
          ))}
          {data.map((p, i) => (
            <View key={`ed${i}`} style={{ position: "absolute", width: DOT_R * 2, height: DOT_R * 2, borderRadius: DOT_R, backgroundColor: colors.chartNegative || colors.error, left: getX(i) - DOT_R, top: getY(p.expenses) - DOT_R }} />
          ))}
          {/* Marcas de fechas de ahorro, punto más pequeño */}
          {showSavings && data.map((p, i) =>
            (p.savings ?? 0) > 0 ? (
              <View key={`sd${i}`} style={{ position: "absolute", width: DOT_R * 2 - 2, height: DOT_R * 2 - 2, borderRadius: DOT_R - 1, backgroundColor: colors.chartPositive || colors.success, left: getX(i) - DOT_R + 1, top: getY(p.savings ?? 0) - DOT_R + 1 }} />
            ) : null
          )}
        </>
      )}
    </View>
  );
}

// Intenta extraer monto y descripción de un SMS bancario; devuelve objeto con amount/description o null.
function parseSmsText(text: string): { amount: number; description: string } | null {
  const amountMatch = text.match(/\$?\s*([\d]{1,3}(?:[.,][\d]{3})*(?:[.,][\d]{1,2})?)/);
  if (!amountMatch) return null;
  const rawNum = amountMatch[1].replace(/\./g, "").replace(",", ".");
  const amount = parseFloat(rawNum);
  if (isNaN(amount) || amount <= 0) return null;
  const descMatch = text.match(/(?:en|at|compra\s+en\s+)\s*([A-Za-z0-9\s\-\.]+?)(?:\s+el\b|\s+\d|\.|,|$)/i);
  const description = descMatch?.[1]?.trim() ?? "";
  return { amount, description };
}

// ─── Selector de fecha (calendario) ──────────────────────────────────────────

// Devuelve la fecha del lunes de la semana actual con hora en 00:00:00.
function getCurrentWeekMonday(): Date {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Formatea el rango de fechas de una semana dado su lunes, ej. "26 may – 1 jun 2026".
function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()} ${MONTHS_ES_SHORT[d.getMonth()]}`;
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  return sameYear
    ? `${fmt(monday)} – ${fmt(sunday)} ${monday.getFullYear()}`
    : `${fmt(monday)} ${monday.getFullYear()} – ${fmt(sunday)} ${sunday.getFullYear()}`;
}


// Teclado numérico compartido por los modales de gasto (normal y recurrente).
function Numpad({ onKey, styles, colors }: {
  onKey: (key: string) => void;
  styles: ReturnType<typeof getStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.numpad}>
      {([["1","2","3"],["4","5","6"],["7","8","9"],["." ,"0","⌫"]] as string[][]).map((row, ri) => (
        <View key={ri} style={styles.numpadRow}>
          {row.map((key) => (
            <TouchableOpacity
              key={key}
              style={styles.numpadKey}
              onPress={() => onKey(key)}
              activeOpacity={0.6}
            >
              <AppText style={styles.numpadKeyText}>{key}</AppText>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </View>
  );
}

// Los cuatro modos del formulario: gasto, ingreso, gasto recurrente e
// ingreso recurrente. Cada uno muestra solo los campos que necesita.
type MovementFormKind = "expense" | "income" | "recurring_expense" | "recurring_income";

// Compone el ISO del ancla (día del cobro + mes de inicio) recortando el día
// al largo del mes, p. ej. día 31 con mes de 30 días → día 30.
function recurringAnchorIso(day: number, startMonth: Date): string {
  const y = startMonth.getFullYear();
  const m = startMonth.getMonth();
  const d = Math.min(day, new Date(y, m + 1, 0).getDate());
  return new Date(y, m, d, 12, 0, 0).toISOString();
}

// Selector de día del cobro (chips 1-31) y mes de inicio (navegación mensual),
// compartido por los modales de creación y edición del gasto recurrente.
function RecurringSchedule({ day, onDay, startMonth, onStartMonth, styles, colors }: {
  day: number;
  onDay: (d: number) => void;
  startMonth: Date;
  onStartMonth: (m: Date) => void;
  styles: ReturnType<typeof getStyles>;
  colors: ThemeColors;
}) {
  const prevMonth = () => onStartMonth(new Date(startMonth.getFullYear(), startMonth.getMonth() - 1, 1, 12, 0, 0));
  const nextMonth = () => onStartMonth(new Date(startMonth.getFullYear(), startMonth.getMonth() + 1, 1, 12, 0, 0));
  return (
    <>
      <AppText style={[styles.label, { marginTop: 4 }]}>El día del movimiento</AppText>
      <View style={styles.dayGrid}>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <TouchableOpacity
            key={d}
            style={[styles.dayChip, day === d && styles.dayChipActive]}
            onPress={() => onDay(d)}
            activeOpacity={0.7}
          >
            <AppText style={[styles.dayChipText, day === d && styles.whiteText]}>{d}</AppText>
          </TouchableOpacity>
        ))}
      </View>
      <AppText style={[styles.label, { marginTop: 4 }]}>Mes de inicio</AppText>
      <View style={styles.startMonthRow}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <AppText style={styles.startMonthLabel}>
          {MONTHS_ES[startMonth.getMonth()]} {startMonth.getFullYear()}
        </AppText>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </>
  );
}

// Pantalla de Finanzas: gráfico deslizable por periodo, stats por periodo, listado de movimientos editables.
export default function FinanceScreen() {
  const colors = useTheme();
  const styles = getStyles(colors);
  const { glowStyle } = useGlow();
  const { width } = useWindowDimensions();
  const cardWidth = width - 32;

  const {
    transactions,
    incomeCategories,
    expenseCategories,
    weekStats,
    monthStats,
    yearStats,
    weekBreakdown,
    monthBreakdown,
    yearBreakdown,
    recurringExpenses,
    totalSavings,
    savingsStatEnabled,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addCategory,
    addRecurringExpense,
    updateRecurringExpense,
    deleteRecurringExpense,
    setSavingsStatEnabled,
    reload,
  } = useTransactions();
  const { showAlert } = useAlert();

  // ─── Period pager ────────────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView>(null);
  const [activePeriod, setActivePeriod] = useState(0);

  // ─── Navegación de semana ────────────────────────────────────────────────
  const [navWeekMonday, setNavWeekMonday] = useState(() => getCurrentWeekMonday());
  const [navWeekStats, setNavWeekStats] = useState({ income: 0, expenses: 0, balance: 0 });
  const [navWeekBreakdown, setNavWeekBreakdown] = useState<PeriodPoint[]>(
    Array.from({ length: 7 }, () => ({ income: 0, expenses: 0 }))
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [ws, wb] = await Promise.all([
        getWeeklyStatsForWeek(navWeekMonday),
        getDailyBreakdownForWeekDate(navWeekMonday),
      ]);
      if (!cancelled) {
        setNavWeekStats(ws);
        setNavWeekBreakdown(wb);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [navWeekMonday, transactions]);

  // Retrocede una semana en la navegación.
  function prevWeek() {
    setNavWeekMonday((m) => {
      const prev = new Date(m);
      prev.setDate(m.getDate() - 7);
      return prev;
    });
  }

  // Avanza una semana, sin pasar de la semana actual.
  function nextWeek() {
    if (navWeekMonday.getTime() >= getCurrentWeekMonday().getTime()) return;
    setNavWeekMonday((m) => {
      const next = new Date(m);
      next.setDate(m.getDate() + 7);
      return next;
    });
  }

  // ─── Navegación de mes ───────────────────────────────────────────────────
  const [navMonth, setNavMonth] = useState(new Date().getMonth());
  const [navYear, setNavYear] = useState(new Date().getFullYear());
  const [navMonthStats, setNavMonthStats] = useState({ income: 0, expenses: 0, balance: 0 });
  const [navMonthBreakdown, setNavMonthBreakdown] = useState<PeriodPoint[]>(
    Array.from({ length: 4 }, () => ({ income: 0, expenses: 0 }))
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [ms, mb] = await Promise.all([
        getMonthlyStats(navYear, navMonth),
        getWeeklyBreakdownForMonth(navYear, navMonth),
      ]);
      if (!cancelled) {
        setNavMonthStats(ms);
        setNavMonthBreakdown(mb);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [navYear, navMonth, transactions]);

  // Retrocede un mes en la navegación del gráfico mensual.
  function prevMonth() {
    if (navMonth === 0) {
      setNavMonth(11);
      setNavYear((y) => y - 1);
    } else {
      setNavMonth((m) => m - 1);
    }
  }

  // Avanza un mes en la navegación, sin pasar del mes actual.
  function nextMonth() {
    const now = new Date();
    if (navYear === now.getFullYear() && navMonth === now.getMonth()) return;
    if (navMonth === 11) {
      setNavMonth(0);
      setNavYear((y) => y + 1);
    } else {
      setNavMonth((m) => m + 1);
    }
  }

  // ─── Navegación de año ─────────────────────────────────────────────────
  const [navYearNum, setNavYearNum] = useState(new Date().getFullYear());
  const [navYearStats, setNavYearStats] = useState({ income: 0, expenses: 0, balance: 0 });
  const [navYearBreakdown, setNavYearBreakdown] = useState<PeriodPoint[]>(
    Array.from({ length: 12 }, () => ({ income: 0, expenses: 0 }))
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [ys, yb] = await Promise.all([
        getYearlyStats(navYearNum),
        getMonthlyBreakdownForYear(navYearNum),
      ]);
      if (!cancelled) {
        setNavYearStats(ys);
        setNavYearBreakdown(yb);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [navYearNum, transactions]);

  // Retrocede un año en la navegación.
  function prevYear() {
    setNavYearNum((y) => y - 1);
  }

  // Avanza un año, sin pasar del año actual.
  function nextYear() {
    if (navYearNum >= new Date().getFullYear()) return;
    setNavYearNum((y) => y + 1);
  }

  const statsByPeriod = [navWeekStats, navMonthStats, navYearStats];
  const breakdownByPeriod = [navWeekBreakdown, navMonthBreakdown, navYearBreakdown];

  // Desplaza el pager al periodo seleccionado (0=Semana, 1=Mes, 2=Año).
  function scrollToPeriod(i: number) {
    scrollRef.current?.scrollTo({ x: i * cardWidth, animated: true });
    setActivePeriod(i);
  }

  // Sincroniza el indicador activo al deslizar el pager manualmente.
  function handlePeriodScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
    if (page !== activePeriod) setActivePeriod(page);
  }

  // ─── Modal de movimiento ─────────────────────────────────────────────────
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  // Identifica qué cuadrito del grid está activo: gasto, ingreso o sus
  // variantes recurrentes. De él se derivan isExpense e isRecurring.
  const [formKind, setFormKind] = useState<MovementFormKind>("expense");
  const isExpense = formKind === "expense" || formKind === "recurring_expense";
  const isRecurring = formKind === "recurring_expense" || formKind === "recurring_income";
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [showCategoryAdd, setShowCategoryAdd] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [dateMode, setDateMode] = useState<"auto" | "manual">("auto");
  const [calDate, setCalDate] = useState(new Date());

  // ─── Modal de importación ─────────────────────────────────────────────────
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importStep, setImportStep] = useState<"menu" | "n8n">("menu");
  const [importLoading, setImportLoading] = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // SMS import state - se maneja fuera del Modal para evitar conflicto de
  // dialogos con PermissionsAndroid en New Architecture (Fabric).
  const [showSmsImport, setShowSmsImport] = useState(false);
  const [smsPermission, setSmsPermission] = useState<"unknown" | "granted" | "denied" | "never_ask_again">("unknown");
  const [smsSearching, setSmsSearching] = useState(false);
  const [smsList, setSmsList] = useState<ParsedMovement[]>([]);
  const [selectedSms, setSelectedSms] = useState<Set<string>>(new Set());
  // Filtro de tipo sobre la lista de movimientos detectados por SMS.
  const [smsFilter, setSmsFilter] = useState<"all" | "expense" | "income">("all");

  // ─── Modal de movimiento recurrente (edición desde la lista) ──────────────
  const [recurModalVisible, setRecurModalVisible] = useState(false);
  // Lista de recurrentes abierta desde el icono repeat del encabezado.
  const [recurListVisible, setRecurListVisible] = useState(false);
  const [editingRecur, setEditingRecur] = useState<RecurringExpense | null>(null);
  const [recType, setRecType] = useState<"expense" | "income">("expense");
  const [recTitle, setRecTitle] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recCategory, setRecCategory] = useState("");
  const [recInterval, setRecInterval] = useState<RecurringInterval>("monthly");
  // Día del cobro y mes de inicio del gasto recurrente: juntos forman el ancla.
  // El mes por defecto es enero del año en curso para que el desglose anual
  // cuente el recurrente en todos los meses pasados.
  const [recDay, setRecDay] = useState(new Date().getDate());
  const [recStartMonth, setRecStartMonth] = useState(() => new Date(new Date().getFullYear(), 0, 1, 12, 0, 0));

  const categories = useMemo(
    () => (isExpense ? expenseCategories : incomeCategories),
    [isExpense, incomeCategories, expenseCategories]
  );

  function resetForm() {
    setFormKind("expense");
    setAmount("");
    setTitle("");
    setCategory("");
    setShowCategoryAdd(false);
    setNewCatName("");
    setDateMode("auto");
    setCalDate(new Date());
    setRecInterval("monthly");
    setRecDay(new Date().getDate());
    setRecStartMonth(new Date(new Date().getFullYear(), 0, 1, 12, 0, 0));
    setEditingTx(null);
  }

  // Abre el modal vacío para crear un nuevo movimiento.
  function openAdd() {
    resetForm();
    setModalVisible(true);
  }

  // Abre el modal precargado con los datos de un movimiento existente para editarlo.
  function openEdit(tx: Transaction) {
    setEditingTx(tx);
    setFormKind(tx.type === "expense" ? "expense" : "income");
    setAmount(String(tx.amount));
    setTitle(tx.description);
    setCategory(tx.category);
    setDateMode("manual");
    setCalDate(new Date(tx.date));
    setShowCategoryAdd(false);
    setNewCatName("");
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    resetForm();
  }

  // Guarda el movimiento: actualiza si hay edición en curso, crea uno nuevo si no.
  async function handleSave() {
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      showAlert("Monto inválido", "Ingresa un monto mayor a cero.");
      return;
    }
    if (!category) {
      showAlert("Falta categoría", "Selecciona una categoría.");
      return;
    }
    // En modo recurrente no se crea un movimiento, sino la plantilla que lo
    // genera sola cada semana/mes/año en la fecha marcada.
    if (!editingTx && isRecurring) {
      const desc = title.trim();
      if (!desc) {
        showAlert("Falta concepto", "Escribe un nombre para el movimiento recurrente.");
        return;
      }
      const anchorIso = recurringAnchorIso(recDay, recStartMonth);
      await addRecurringExpense({
        type: isExpense ? "expense" : "income",
        description: desc,
        amount: value,
        category,
        interval: recInterval,
        anchorDate: anchorIso,
      });
      closeModal();
      return;
    }
    const txDate =
      dateMode === "manual"
        ? new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate(), 12, 0, 0).toISOString()
        : undefined;
    if (editingTx) {
      await updateTransaction(editingTx.id, {
        type: isExpense ? "expense" : "income",
        amount: value,
        description: title.trim(),
        category,
        ...(txDate !== undefined ? { date: txDate } : {}),
      });
    } else {
      await addTransaction({
        type: isExpense ? "expense" : "income",
        amount: value,
        description: title.trim(),
        category,
        ...(txDate !== undefined ? { date: txDate } : {}),
      });
    }
    closeModal();
  }

  // Muestra confirmación y elimina el movimiento en edición.
  function handleDelete(id: string) {
    showAlert("Eliminar movimiento", "¿Deseas borrar esta transacción?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          deleteTransaction(id);
          closeModal();
        },
      },
    ]);
  }

  // Agrega una nueva categoría al tipo activo y la selecciona en el formulario.
  async function handleAddCategory() {
    const term = newCatName.trim();
    if (!term) return;
    await addCategory(isExpense ? "expense" : "income", term);
    setCategory(term);
    setNewCatName("");
    setShowCategoryAdd(false);
  }

  // ─── Gestión de movimientos recurrentes ───────────────────────────────
  const INTERVAL_LABELS: Record<RecurringInterval, string> = {
    weekly: "Cada semana",
    monthly: "Cada mes",
    yearly: "Cada año",
  };

  function resetRecurForm() {
    setEditingRecur(null);
    setRecType("expense");
    setRecTitle("");
    setRecAmount("");
    setRecCategory("");
    setRecInterval("monthly");
    setRecDay(new Date().getDate());
    setRecStartMonth(new Date(new Date().getFullYear(), 0, 1, 12, 0, 0));
    setShowCategoryAdd(false);
    setNewCatName("");
  }

  // Abre el modal del movimiento recurrente precargado con los datos de una plantilla para editarla.
  function openRecurEdit(item: RecurringExpense) {
    setEditingRecur(item);
    setRecType(item.type === "income" ? "income" : "expense");
    setRecTitle(item.description);
    setRecAmount(String(item.amount));
    setRecCategory(item.category);
    setRecInterval(item.interval);
    const a = new Date(item.anchorDate);
    setRecDay(a.getDate());
    setRecStartMonth(new Date(a.getFullYear(), a.getMonth(), 1, 12, 0, 0));
    setShowCategoryAdd(false);
    setNewCatName("");
    setRecurModalVisible(true);
  }

  function closeRecurModal() {
    setRecurModalVisible(false);
    resetRecurForm();
  }

  // Guarda el movimiento recurrente: actualiza si hay edición, crea uno nuevo si no.
  async function handleSaveRecurring() {
    const value = parseFloat(recAmount);
    if (isNaN(value) || value <= 0) {
      showAlert("Monto inválido", "Ingresa un monto mayor a cero.");
      return;
    }
    const desc = recTitle.trim();
    if (!desc) {
      showAlert("Falta concepto", "Escribe un nombre para el movimiento recurrente.");
      return;
    }
    if (!recCategory) {
      showAlert("Falta categoría", "Selecciona una categoría.");
      return;
    }
    const anchorIso = recurringAnchorIso(recDay, recStartMonth);
    if (editingRecur) {
      await updateRecurringExpense(editingRecur.id, {
        type: recType,
        description: desc,
        amount: value,
        category: recCategory,
        interval: recInterval,
        anchorDate: anchorIso,
      });
    } else {
      await addRecurringExpense({
        type: recType,
        description: desc,
        amount: value,
        category: recCategory,
        interval: recInterval,
        anchorDate: anchorIso,
      });
    }
    closeRecurModal();
  }

  // Confirma y elimina la plantilla junto con los movimientos que generó.
  function handleDeleteRecurring() {
    if (!editingRecur) return;
    showAlert(
      "Eliminar movimiento recurrente",
      `Se borrará "${editingRecur.description}" y todos los movimientos que generó. Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            await deleteRecurringExpense(editingRecur.id);
            closeRecurModal();
          },
        },
      ]
    );
  }

  // Agrega una categoría del tipo activo para el formulario recurrente.
  async function handleAddRecurCategory() {
    const term = newCatName.trim();
    if (!term) return;
    await addCategory(recType, term);
    setRecCategory(term);
    setNewCatName("");
    setShowCategoryAdd(false);
  }

  // Próxima fecha de cobro de un gasto recurrente para la vista previa.
  function nextPreviewDate(item: RecurringExpense): Date {
    return computeNextRecurrence(item.anchorDate, item.interval);
  }

  // Maneja la entrada del teclado numérico del modal de movimiento.
  // Teclado numerico personalizado para el campo de monto. Reglas:
  // - Solo un punto decimal permitido, maximo 2 decimales.
  // - Maximo 10 digitos enteros (previene overflow con numeros enormes).
  // - Si el usuario empieza con "0" y tipea un digito, reemplaza el 0 (ej: "05" → "5").
  // - ⌫ borra el ultimo caracter (o limpia todo si solo queda 1 caracter).
  function applyNumpad(key: string, current: string, set: (v: string) => void) {
    if (key === "⌫") {
      set(current.length > 1 ? current.slice(0, -1) : "");
      return;
    }
    if (key === "." && current.includes(".")) return;
    if (key === "." && current === "") { set("0."); return; }
    const dotIdx = current.indexOf(".");
    if (dotIdx !== -1 && current.length - dotIdx > 2) return;
    if (current.replace(/[.,]/g, "").length >= 10) return;
    set(current === "0" && key !== "." ? key : current === "" ? key : current + key);
  }

  function handleNumpad(key: string) {
    applyNumpad(key, amount, setAmount);
  }

  function handleRecNumpad(key: string) {
    applyNumpad(key, recAmount, setRecAmount);
  }

  // Sincroniza movimientos pendientes desde el flujo n8n.
  async function handleSyncN8n() {
    setImportLoading(true);
    setImportError(null);
    setImportCount(null);
    try {
      const count = await syncFromN8n();
      setImportCount(count);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Error al sincronizar.");
    } finally {
      setImportLoading(false);
    }
  }

  // Solicita permiso READ_SMS, lee el inbox y clasifica compras automaticamente.
  async function handleSmsScan() {
    // Feedback inmediato al usuario: muestra "Analizando mensajes..."
    // incluso antes de pedir el permiso, para que sepa que el boton respondio.
    setSmsSearching(true);
    setSmsPermission("unknown");
    setImportError(null);

    try {
      // Timeout de 20s por si el dialogo de permisos no aparece o el usuario
      // no responde. En algunos dispositivos PermissionsAndroid puede colgarse
      // si la Activity no esta en primer plano.
      const timeoutPromise = new Promise<SmsPermissionResult>((_, reject) =>
        setTimeout(() => reject(new Error("La solicitud de permiso no respondió. Reintenta.")), 20000)
      );
      const result = await Promise.race([requestSmsPermission(), timeoutPromise]);

      if (result !== "granted") {
        setSmsPermission(result === "never_ask_again" ? "never_ask_again" : "denied");
        setSmsSearching(false);
        return;
      }
      setSmsPermission("granted");

      const messages = await readSmsInbox(300);
      const found = classifySmsMessages(messages);
      setSmsList(found);
      setSelectedSms(new Set(found.map((e) => e.id)));
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "Error al solicitar permiso o leer SMS.");
    } finally {
      setSmsSearching(false);
    }
  }

  // Registra como movimientos (gasto o ingreso) los elementos seleccionados.
  async function handleSmsAddSelected() {
    const toAdd = smsList.filter((e) => selectedSms.has(e.id));
    await addTransactionsBatch(
      toAdd.map((m) => ({
        type: m.type,
        amount: m.amount,
        description: m.description,
        category:
          m.type === "income"
            ? incomeCategories[0] ?? "Ingresos"
            : expenseCategories[0] ?? "General",
        date: new Date(
          m.date.getFullYear(),
          m.date.getMonth(),
          m.date.getDate(),
          12, 0, 0
        ).toISOString(),
      }))
    );
    closeImportModal();
    reload();
  }

  // Alterna la selección de un gasto SMS detectado.
  function toggleSmsItem(id: string) {
    setSelectedSms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Conteos por tipo y lista visible segun el filtro activo en el import SMS.
  const smsCounts = useMemo(
    () => ({
      expense: smsList.filter((m) => m.type === "expense").length,
      income: smsList.filter((m) => m.type === "income").length,
    }),
    [smsList]
  );
  const visibleSms = smsList.filter((m) => smsFilter === "all" || m.type === smsFilter);

  // Cierra el modal de importación y resetea su estado.
  function closeImportModal() {
    setImportModalVisible(false);
    setShowSmsImport(false);
    setImportStep("menu");
    setImportCount(null);
    setImportError(null);
    setSmsPermission("unknown");
    setSmsSearching(false);
    setSmsList([]);
    setSelectedSms(new Set());
    setSmsFilter("all");
  }

  return (
    <View style={styles.container}>
      <BackgroundDecor colors={colors} screenVariant={1} />
      {showSmsImport ? (
        /* Vista completa de importacion SMS - fuera del Modal RN para
           evitar conflicto con PermissionsAndroid en New Architecture.
           Cuando importModalVisible se setea a false, el Modal cierra con
           animacion pero sigue en un Dialog de Android encima de todo.
           Al renderizar condicionalmente este bloque en vez de un overlay,
           el Modal desaparece del arbol completamente y el dialogo de
           permiso se muestra sin interferencias. */
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={styles.smsOverlayHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="chatbubble-ellipses" size={22} color={colors.primary} />
              <AppText style={styles.smsOverlayTitle}>Importar desde SMS</AppText>
            </View>
            <TouchableOpacity onPress={() => { closeImportModal(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.smsScroll} keyboardShouldPersistTaps="handled">
            {smsPermission === "unknown" && smsList.length === 0 && !smsSearching && (
              <View style={styles.smsEmptyState}>
                <View style={styles.smsEmptyIconWrap}>
                  <Ionicons name="chatbubbles-outline" size={40} color={colors.primary} />
                </View>
                <AppText style={styles.smsEmptyTitle}>Escanea tus SMS</AppText>
                <AppText style={styles.smsEmptyDesc}>
                  Kiora buscará movimientos (gastos e ingresos) en los últimos mensajes bancarios y mostrará una lista para elegir qué registrar.
                </AppText>
                <TouchableOpacity style={styles.smsStartButton} onPress={handleSmsScan}>
                  <Ionicons name="scan-outline" size={20} color={colors.surface} />
                  <AppText style={styles.smsStartButtonText}>Buscar movimientos</AppText>
                </TouchableOpacity>
              </View>
            )}

            {smsSearching && (
              <View style={styles.smsEmptyState}>
                <View style={[styles.smsEmptyIconWrap, { borderColor: colors.primary }]}>
                  <Ionicons name="search-outline" size={40} color={colors.primary} />
                </View>
                <AppText style={styles.smsEmptyTitle}>Analizando mensajes...</AppText>
                <AppText style={styles.smsEmptyDesc}>
                  Revisando los últimos 300 SMS en busca de movimientos.
                </AppText>
              </View>
            )}

            {importError && smsPermission === "granted" && !smsSearching && (
              <View style={[styles.importFeedback, { borderColor: colors.error, marginHorizontal: 16 }]}>
                <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
                <AppText style={[styles.importFeedbackText, { color: colors.error }]}>
                  {importError}
                </AppText>
              </View>
            )}

            {smsPermission === "denied" && (
              <View style={styles.smsEmptyState}>
                <View style={[styles.smsEmptyIconWrap, { borderColor: colors.error }]}>
                  <Ionicons name="close-circle-outline" size={40} color={colors.error} />
                </View>
                <AppText style={[styles.smsEmptyTitle, { color: colors.error }]}>
                  Permiso denegado
                </AppText>
                <AppText style={styles.smsEmptyDesc}>
                  No se concedió el acceso a SMS. Puede intentarse de nuevo.
                </AppText>
                <TouchableOpacity style={styles.smsStartButton} onPress={handleSmsScan}>
                  <Ionicons name="refresh-outline" size={20} color={colors.surface} />
                  <AppText style={styles.smsStartButtonText}>Intentar de nuevo</AppText>
                </TouchableOpacity>
              </View>
            )}

            {smsPermission === "never_ask_again" && (
              <View style={styles.smsEmptyState}>
                <View style={[styles.smsEmptyIconWrap, { borderColor: colors.warning }]}>
                  <Ionicons name="lock-closed-outline" size={40} color={colors.warning} />
                </View>
                <AppText style={[styles.smsEmptyTitle, { color: colors.warning }]}>
                  Permiso bloqueado
                </AppText>
                <AppText style={styles.smsEmptyDesc}>
                  El permiso fue denegado permanentemente. Para activarlo se debe ir a Ajustes del sistema, buscar Kiora en la lista de aplicaciones y habilitar el permiso de SMS.
                </AppText>
                <TouchableOpacity style={styles.smsStartButton} onPress={openAppSettings}>
                  <Ionicons name="settings-outline" size={20} color={colors.surface} />
                  <AppText style={styles.smsStartButtonText}>Abrir Ajustes</AppText>
                </TouchableOpacity>
              </View>
            )}

            {smsPermission === "granted" && smsList.length === 0 && !smsSearching && !importError && (
              <View style={styles.smsEmptyState}>
                <View style={[styles.smsEmptyIconWrap, { borderColor: colors.textSecondary }]}>
                  <Ionicons name="checkmark-circle-outline" size={40} color={colors.textSecondary} />
                </View>
                <AppText style={styles.smsEmptyTitle}>Sin resultados</AppText>
                <AppText style={styles.smsEmptyDesc}>
                  No se encontraron movimientos bancarios en los mensajes recientes.
                </AppText>
              </View>
            )}

            {smsList.length > 0 && !smsSearching && (
              <>
                <View style={styles.smsResultHeader}>
                  <AppText style={styles.smsResultCount}>
                    {smsList.length} movimiento{smsList.length === 1 ? "" : "s"} detectado{smsList.length === 1 ? "" : "s"}
                  </AppText>
                  <AppText style={styles.smsResultSub}>
                    {smsCounts.expense > 0 && `${smsCounts.expense} gasto${smsCounts.expense === 1 ? "" : "s"}`}
                    {smsCounts.expense > 0 && smsCounts.income > 0 && " · "}
                    {smsCounts.income > 0 && `${smsCounts.income} ingreso${smsCounts.income === 1 ? "" : "s"}`}
                    {" · toca los que deseas registrar"}
                  </AppText>
                </View>
                <View style={styles.smsFilterRow}>
                  {([
                    ["all", `Todos (${smsList.length})`],
                    ["expense", `Gastos (${smsCounts.expense})`],
                    ["income", `Ingresos (${smsCounts.income})`],
                  ] as const).map(([key, label]) => {
                    const active = smsFilter === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.smsFilterChip, active && styles.smsFilterChipActive]}
                        onPress={() => setSmsFilter(key)}
                        activeOpacity={0.7}
                      >
                        <AppText style={[styles.smsFilterText, active && styles.smsFilterTextActive]}>
                          {label}
                        </AppText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {visibleSms.length === 0 ? (
                  <View style={styles.smsFilterEmpty}>
                    <AppText style={styles.smsEmptyDesc}>
                      No hay movimientos de este tipo.
                    </AppText>
                  </View>
                ) : (
                <View style={styles.smsListWrap}>
                  {visibleSms.map((m) => {
                    const isSelected = selectedSms.has(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.smsCard, glowStyle, isSelected && styles.smsCardSelected]}
                        onPress={() => toggleSmsItem(m.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.smsCheckbox, isSelected && styles.smsCheckboxSelected]}>
                          {isSelected && <Ionicons name="checkmark" size={14} color={colors.surface} />}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <AppText style={[styles.smsCardAmount, { color: m.type === "income" ? colors.success : colors.error }]}>
                              {m.type === "income" ? "+" : "-"}{formatCurrency(m.amount)}
                            </AppText>
                            <AppText style={styles.smsCardDate}>
                              {m.date.toLocaleDateString("es", { day: "2-digit", month: "short" })}
                            </AppText>
                          </View>
                          <AppText style={styles.smsCardDesc} numberOfLines={2}>
                            {m.description || m.rawBody.slice(0, 60)}
                          </AppText>
                          <AppText style={styles.smsCardMeta}>
                            {m.sender ? `${m.sender}` : ""}
                          </AppText>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                )}
                <TouchableOpacity
                  style={[styles.smsAddButton, selectedSms.size === 0 && { opacity: 0.5 }]}
                  onPress={handleSmsAddSelected}
                  disabled={selectedSms.size === 0}
                >
                  <Ionicons name="download-outline" size={20} color={colors.surface} />
                  <AppText style={styles.smsAddButtonText}>
                    Agregar {selectedSms.size} movimiento{selectedSms.size === 1 ? "" : "s"}
                  </AppText>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Tarjeta de periodos (gráfico + estadísticas) ── */}
        <GlowView style={styles.periodCard} cardRadius={12}>
          <View style={styles.tabs}>
            {PERIODS.map((label, i) => (
              <TouchableOpacity
                key={label}
                style={styles.tab}
                onPress={() => scrollToPeriod(i)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.tabLabel, activePeriod === i && styles.tabLabelActive]}>
                  {label}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.indicatorTrack}>
            <View
              style={[
                styles.indicatorBar,
                { width: `${100 / 3}%`, left: `${(activePeriod * 100) / 3}%` },
              ]}
            />
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handlePeriodScroll}
            scrollEventThrottle={32}
          >
            {statsByPeriod.map((stats, i) => {
              const data = breakdownByPeriod[i];
              // El eje Y debe escalar sobre todas las series, incluida la de ahorro.
              const maxVal = Math.max(...data.map((d) => Math.max(d.income, d.expenses, d.savings ?? 0)), 1);
              const isPositive = stats.balance >= 0;

              const xLabels =
                i === 0 ? DAYS_ES :
                i === 1 ? ["Sem 1", "Sem 2", "Sem 3", "Sem 4"] :
                MONTHS_ES_SHORT;

              const now = new Date();
              const navLabel =
                i === 0
                  ? formatWeekRange(navWeekMonday)
                  : i === 1
                  ? `${MONTHS_ES[navMonth]} ${navYear}`
                  : String(navYearNum);
              const onPrevNav = i === 0 ? prevWeek : i === 1 ? prevMonth : prevYear;
              const onNextNav = i === 0 ? nextWeek : i === 1 ? nextMonth : nextYear;
              const canGoNext =
                i === 0
                  ? navWeekMonday.getTime() < getCurrentWeekMonday().getTime()
                  : i === 1
                  ? !(navYear === now.getFullYear() && navMonth === now.getMonth())
                  : navYearNum < now.getFullYear();

              return (
                <View key={i} style={[styles.page, { width: cardWidth }]}>
                  {/* Navegación de periodo */}
                  <View style={styles.monthNav}>
                    <TouchableOpacity
                      onPress={onPrevNav}
                      hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                    >
                      <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <AppText style={styles.monthNavLabel}>{navLabel}</AppText>
                    <TouchableOpacity
                      onPress={onNextNav}
                      hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                      disabled={!canGoNext}
                    >
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={canGoNext ? colors.textSecondary : colors.border}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Gráfico con eje Y */}
                  <View style={styles.chartRow}>
                    <YAxis maxVal={maxVal} />
                    <View style={{ flex: 1 }}>
                      <FinanceLineChart data={data} maxVal={maxVal} showSavings={savingsStatEnabled} />
                      <View style={styles.xLabels}>
                        {xLabels.map((label, j) => (
                          <View key={j} style={styles.xLabelCell}>
                            <AppText
                              style={styles.xLabel}
                              numberOfLines={1}
                              disableHorizontalPadding
                            >
                              {label}
                            </AppText>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>

                  {/* Fila de estadísticas */}
                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <AppText style={[styles.statLabel, styles.textCenter]}>Ingresos</AppText>
                      <AppText
                        style={[styles.statValue, styles.incomeColor, styles.textCenter]}
                        numberOfLines={1}
                      >
                        +{formatCurrency(stats.income)}
                      </AppText>
                    </View>
                    <View style={[styles.statItem, styles.statItemCenter]}>
                      <AppText style={[styles.statLabel, styles.textCenter]}>Balance</AppText>
                      <AppText
                        style={[
                          styles.statValue,
                          styles.textCenter,
                          isPositive ? styles.incomeColor : styles.expenseColor,
                        ]}
                        numberOfLines={1}
                      >
                        {isPositive ? "+" : ""}
                        {formatCurrency(stats.balance)}
                      </AppText>
                    </View>
                    <View style={[styles.statItem, styles.statItemRight]}>
                      <AppText style={[styles.statLabel, styles.textCenter]}>Gastos</AppText>
                      <AppText
                        style={[styles.statValue, styles.expenseColor, styles.textCenter]}
                        numberOfLines={1}
                      >
                        -{formatCurrency(stats.expenses)}
                      </AppText>
                    </View>
                    {savingsStatEnabled ? (
                      <View style={styles.statItem}>
                        <AppText style={[styles.statLabel, styles.textCenter]}>Ahorro</AppText>
                        <AppText
                          style={[styles.statValue, styles.savingsColor, styles.textCenter]}
                          numberOfLines={1}
                        >
                          +{formatCurrency(totalSavings)}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: colors.chartPositive || colors.success }]} />
            <AppText style={styles.legendText}>Ingresos</AppText>
            <View style={[styles.legendDot, { backgroundColor: colors.chartNegative || colors.error }]} />
            <AppText style={styles.legendText}>Gastos</AppText>
            {savingsStatEnabled && (
              <>
                <View style={[styles.legendDot, styles.legendDotThin, { backgroundColor: colors.chartPositive || colors.success }]} />
                <AppText style={styles.legendText}>Ahorro</AppText>
              </>
            )}
          </View>
        </GlowView>

        {/* ── Lista de movimientos ── */}
        <View style={styles.sectionRow}>
          <AppText style={styles.sectionTitle}>Movimientos</AppText>
          <View style={styles.sectionRowActions}>
            <TouchableOpacity
              style={styles.importButton}
              onPress={() => setRecurListVisible(true)}
            >
              <Ionicons name="repeat" size={13} color={colors.primary} />
              <AppText style={styles.importButtonText}>Recurrentes</AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.importButton}
              onPress={() => { setImportStep("menu"); setImportModalVisible(true); }}
            >
              <Ionicons name="cloud-download-outline" size={13} color={colors.primary} />
              <AppText style={styles.importButtonText}>Importar</AppText>
            </TouchableOpacity>
            <View style={styles.savingsToggleWrap}>
              <Switch
                value={savingsStatEnabled}
                onValueChange={(v) => setSavingsStatEnabled(v)}
                trackColor={{ false: colors.border, true: colors.success }}
                thumbColor={colors.surface}
              />
              <Ionicons name="cash-outline" size={13} color={colors.success} />
            </View>
          </View>
        </View>

        {transactions.length === 0 ? (
          <EmptyState
            icon="wallet-outline"
            title="Sin movimientos"
            subtitle="Tus transacciones aparecerán aquí"
          />
        ) : (
          transactions.map((tx) => (
            <TransactionCard key={tx.id} item={tx} onPress={() => openEdit(tx)} />
          ))
        )}

        <View style={{ height: 88 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Ionicons name="add" size={28} color={colors.surface} />
      </TouchableOpacity>

      {/* Modal agregar / editar movimiento */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>
                {editingTx
                  ? (isExpense ? "Editar gasto" : "Editar ingreso")
                  : isRecurring
                    ? (isExpense ? "Nuevo gasto recurrente" : "Nuevo ingreso recurrente")
                    : (isExpense ? "Nuevo gasto" : "Nuevo ingreso")}
              </AppText>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* Grid 2x2 de tipos: gasto, ingreso y sus variantes recurrentes.
                  En edición los recurrentes se deshabilitan (se editan desde la lista). */}
              <View style={styles.kindGrid}>
                {([
                  ["expense", "remove-circle-outline", "Gasto", colors.error],
                  ["income", "add-circle-outline", "Ingreso", colors.success],
                  ["recurring_expense", "repeat", "Gasto recurrente", colors.error],
                  ["recurring_income", "repeat", "Ingreso recurrente", colors.success],
                ] as const).map(([kind, icon, label, tint]) => {
                  const active = formKind === kind;
                  const disabled = editingTx !== null && (kind === "recurring_expense" || kind === "recurring_income");
                  return (
                    <TouchableOpacity
                      key={kind}
                      style={[
                        styles.kindGridItem,
                        active && styles.kindGridItemActive,
                        disabled && { opacity: 0.4 },
                      ]}
                      onPress={() => {
                        if (disabled) return;
                        setFormKind(kind);
                        setCategory("");
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={icon} size={26} color={active ? colors.surface : tint} />
                      <AppText style={[styles.kindGridLabel, active && styles.whiteText]}>
                        {label}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={styles.input}
                placeholder={isExpense ? "Concepto de gasto" : "Concepto de ingreso"}
                placeholderTextColor={colors.textSecondary}
                value={title}
                onChangeText={setTitle}
                returnKeyType="next"
              />

              {/* Monto con teclado numérico */}
              <GlowView style={styles.amountDisplay} cardRadius={12}>
                <AppText style={styles.amountDisplayText}>
                  {formatCurrency(parseFloat(amount) || 0)}
                </AppText>
              </GlowView>
              <Numpad onKey={handleNumpad} styles={styles} colors={colors} />

              <AppText style={styles.label}>Categoría</AppText>
              <View style={styles.categoryGrid}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryBadge, category === cat && styles.categoryBadgeSelected]}
                    onPress={() => setCategory(cat)}
                  >
                    <AppText
                      style={[styles.categoryBadgeText, category === cat && styles.whiteText]}
                    >
                      {cat}
                    </AppText>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.addCategoryBadge}
                  onPress={() => setShowCategoryAdd(!showCategoryAdd)}
                >
                  <Ionicons
                    name={showCategoryAdd ? "close" : "add"}
                    size={14}
                    color={colors.primary}
                  />
                  <AppText style={styles.addCategoryText}>Nueva</AppText>
                </TouchableOpacity>
              </View>

              {showCategoryAdd && (
                <View style={styles.newCatRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Nombre de categoría"
                    placeholderTextColor={colors.textSecondary}
                    value={newCatName}
                    onChangeText={setNewCatName}
                  />
                  <TouchableOpacity style={styles.newCatAdd} onPress={handleAddCategory}>
                    <Ionicons name="checkmark" size={22} color={colors.surface} />
                  </TouchableOpacity>
                </View>
              )}

              {isRecurring && !editingTx ? (
                <>
                  <AppText style={[styles.label, { marginTop: 4 }]}>Se repite cada</AppText>
                  <View style={styles.dateModeRow}>
                    {(["weekly", "monthly", "yearly"] as RecurringInterval[]).map((interval) => (
                      <TouchableOpacity
                        key={interval}
                        style={[styles.dateModeBtn, recInterval === interval && styles.dateModeBtnActive]}
                        onPress={() => setRecInterval(interval)}
                      >
                        <AppText style={[styles.dateModeBtnText, recInterval === interval && styles.whiteText]}>
                          {interval === "weekly" ? "Semana" : interval === "monthly" ? "Mes" : "Año"}
                        </AppText>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <RecurringSchedule
                    day={recDay}
                    onDay={setRecDay}
                    startMonth={recStartMonth}
                    onStartMonth={setRecStartMonth}
                    styles={styles}
                    colors={colors}
                  />

                  <AppText style={styles.recurPreview}>
                    {INTERVAL_LABELS[recInterval]} · próximo{" "}
                    {computeNextRecurrence(
                      recurringAnchorIso(recDay, recStartMonth),
                      recInterval
                    ).toLocaleDateString("es", { day: "numeric", month: "short" })}
                  </AppText>
                </>
              ) : (
                <>
                  {/* Selector de fecha */}
                  <AppText style={[styles.label, { marginTop: 4 }]}>Fecha</AppText>
                  <View style={styles.dateModeRow}>
                    <TouchableOpacity
                      style={[styles.dateModeBtn, dateMode === "auto" && styles.dateModeBtnActive]}
                      onPress={() => setDateMode("auto")}
                    >
                      <AppText style={[styles.dateModeBtnText, dateMode === "auto" && styles.whiteText]}>
                        Automático
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.dateModeBtn, dateMode === "manual" && styles.dateModeBtnActive]}
                      onPress={() => setDateMode("manual")}
                    >
                      <AppText style={[styles.dateModeBtnText, dateMode === "manual" && styles.whiteText]}>
                        Elegir día
                      </AppText>
                    </TouchableOpacity>
                  </View>

                  {dateMode === "manual" && (
                    <CalendarPicker selected={calDate} onSelect={setCalDate} />
                  )}
                </>
              )}

              {editingTx ? (
                <View style={styles.editActionsRow}>
                  <TouchableOpacity style={styles.editSaveButton} onPress={handleSave}>
                    <Ionicons name="checkmark-outline" size={18} color={colors.surface} />
                    <AppText style={styles.saveButtonText}>Guardar</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editDeleteButton}
                    onPress={() => handleDelete(editingTx.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                    <AppText style={styles.deleteButtonText}>Eliminar</AppText>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                  <Ionicons name="checkmark-outline" size={18} color={colors.surface} />
                  <AppText style={styles.saveButtonText}>
                    {isRecurring
                      ? (isExpense ? "Crear gasto recurrente" : "Crear ingreso recurrente")
                      : "Registrar"}
                  </AppText>
                </TouchableOpacity>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal de importaci\u00f3n autom\u00e1tica */}
      <Modal
        animationType="slide"
        transparent
        visible={importModalVisible}
        onRequestClose={closeImportModal}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.modalView, { maxHeight: "80%" }]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {importStep !== "menu" && (
                  <TouchableOpacity
                    onPress={() => {
                      setImportStep("menu");
                      setImportCount(null);
                      setImportError(null);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                )}
                <AppText style={styles.modalTitle}>
                  {importStep === "menu" ? "Importar movimientos" : "Flujo n8n"}
                </AppText>
              </View>
              <TouchableOpacity onPress={closeImportModal}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {importStep === "menu" && (
                <>
                  <TouchableOpacity
                    style={[styles.importOptionCard, glowStyle]}
                    onPress={() => { setImportStep("n8n"); setImportCount(null); setImportError(null); }}
                  >
                    <Ionicons name="git-network-outline" size={28} color={colors.primary} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <AppText style={styles.importOptionTitle}>Flujo n8n</AppText>
                      <AppText style={styles.importOptionDesc}>
                        Importa los movimientos pendientes desde el flujo de automatización
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.importOptionCard, glowStyle]}
                    onPress={() => { setImportModalVisible(false); setShowSmsImport(true); setSmsPermission("unknown"); setSmsList([]); setSelectedSms(new Set()); setImportError(null); }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.primary} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <AppText style={styles.importOptionTitle}>Leer SMS</AppText>
                      <AppText style={styles.importOptionDesc}>
                        Busca compras entre tus mensajes bancarios y elige cuáles registrar
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              )}

              {importStep === "n8n" && (
                <>
                  <AppText style={styles.importHint}>
                    Descarga los movimientos registrados en el flujo n8n y los agrega a Kiora.
                  </AppText>
                  {importCount !== null && (
                    <View style={[styles.importFeedback, { borderColor: colors.success }]}>
                      <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
                      <AppText style={[styles.importFeedbackText, { color: colors.success }]}>
                        {importCount === 0
                          ? "No hay movimientos pendientes"
                          : `${importCount} movimiento${importCount === 1 ? "" : "s"} importado${importCount === 1 ? "" : "s"}`}
                      </AppText>
                    </View>
                  )}
                  {importError !== null && (
                    <View style={[styles.importFeedback, { borderColor: colors.error }]}>
                      <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
                      <AppText style={[styles.importFeedbackText, { color: colors.error }]}>
                        {importError}
                      </AppText>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[styles.saveButton, importLoading && { opacity: 0.6 }]}
                    onPress={handleSyncN8n}
                    disabled={importLoading}
                  >
                    <AppText style={styles.saveButtonText}>
                      {importLoading ? "Sincronizando..." : "Sincronizar ahora"}
                    </AppText>
                  </TouchableOpacity>
                </>
              )}

            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Lista de movimientos recurrentes (gastos e ingresos) */}
      <Modal
        animationType="slide"
        transparent
        visible={recurListVisible}
        onRequestClose={() => setRecurListVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.modalView, { maxHeight: "92%" }]}
          >
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Recurrentes</AppText>
              <TouchableOpacity onPress={() => setRecurListVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              {recurringExpenses.length === 0 ? (
                <View style={styles.smsFilterEmpty}>
                  <Ionicons name="repeat" size={32} color={colors.textSecondary} />
                  <AppText style={[styles.smsEmptyDesc, { marginTop: 10, marginBottom: 0 }]}>
                    No hay movimientos recurrentes. Se crean desde el + eligiendo
                    la opción recurrente del tipo deseado.
                  </AppText>
                </View>
              ) : (
                <View style={styles.smsListWrap}>
                  {recurringExpenses.map((item) => {
                    const next = nextPreviewDate(item);
                    const isIncome = item.type === "income";
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.recurCard, glowStyle]}
                        onPress={() => {
                          setRecurListVisible(false);
                          openRecurEdit(item);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.recurIconWrap}>
                          <Ionicons name="repeat" size={16} color={isIncome ? colors.success : colors.error} />
                        </View>
                        <View style={styles.recurContent}>
                          <AppText style={styles.recurTitle} numberOfLines={1}>
                            {item.description}
                          </AppText>
                          <AppText style={styles.recurMeta} numberOfLines={1}>
                            {isIncome ? "Ingreso" : "Gasto"} · {INTERVAL_LABELS[item.interval]} · próximo{" "}
                            {next.toLocaleDateString("es", { day: "numeric", month: "short" })}
                          </AppText>
                        </View>
                        <AppText style={[styles.recurAmount, { color: isIncome ? colors.success : colors.error }]} numberOfLines={1}>
                          {isIncome ? "+" : "-"}{formatCurrency(item.amount)}
                        </AppText>
                        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal de movimiento recurrente (edición) */}
      <Modal
        animationType="slide"
        transparent
        visible={recurModalVisible}
        onRequestClose={closeRecurModal}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[styles.modalView, { maxHeight: "92%" }]}
          >
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>
                {editingRecur
                  ? (recType === "expense" ? "Editar gasto recurrente" : "Editar ingreso recurrente")
                  : (recType === "expense" ? "Nuevo gasto recurrente" : "Nuevo ingreso recurrente")}
              </AppText>
              <TouchableOpacity onPress={closeRecurModal}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {/* Selector gasto/ingreso del recurrente */}
              <View style={styles.typeSelector}>
                <TouchableOpacity
                  style={[styles.typeButton, recType === "expense" && styles.expenseBg]}
                  onPress={() => { setRecType("expense"); setRecCategory(""); }}
                >
                  <AppText style={[styles.typeButtonText, recType === "expense" && styles.whiteText]}>
                    Gasto
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeButton, recType === "income" && styles.incomeBg]}
                  onPress={() => { setRecType("income"); setRecCategory(""); }}
                >
                  <AppText style={[styles.typeButtonText, recType === "income" && styles.whiteText]}>
                    Ingreso
                  </AppText>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.input}
                placeholder={recType === "expense" ? "Concepto del gasto" : "Concepto del ingreso"}
                placeholderTextColor={colors.textSecondary}
                value={recTitle}
                onChangeText={setRecTitle}
                returnKeyType="next"
              />

              {/* Monto con teclado numérico */}
              <GlowView style={styles.amountDisplay} cardRadius={12}>
                <AppText style={styles.amountDisplayText}>
                  {formatCurrency(parseFloat(recAmount) || 0)}
                </AppText>
              </GlowView>
              <Numpad onKey={handleRecNumpad} styles={styles} colors={colors} />

              <AppText style={styles.label}>Categoría</AppText>
              <View style={styles.categoryGrid}>
                {(recType === "expense" ? expenseCategories : incomeCategories).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryBadge, recCategory === cat && styles.categoryBadgeSelected]}
                    onPress={() => setRecCategory(cat)}
                  >
                    <AppText
                      style={[styles.categoryBadgeText, recCategory === cat && styles.whiteText]}
                    >
                      {cat}
                    </AppText>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.addCategoryBadge}
                  onPress={() => setShowCategoryAdd(!showCategoryAdd)}
                >
                  <Ionicons
                    name={showCategoryAdd ? "close" : "add"}
                    size={14}
                    color={colors.primary}
                  />
                  <AppText style={styles.addCategoryText}>Nueva</AppText>
                </TouchableOpacity>
              </View>

              {showCategoryAdd && (
                <View style={styles.newCatRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Nombre de categoría"
                    placeholderTextColor={colors.textSecondary}
                    value={newCatName}
                    onChangeText={setNewCatName}
                  />
                  <TouchableOpacity style={styles.newCatAdd} onPress={handleAddRecurCategory}>
                    <Ionicons name="checkmark" size={22} color={colors.surface} />
                  </TouchableOpacity>
                </View>
              )}

              <AppText style={[styles.label, { marginTop: 4 }]}>Se repite cada</AppText>
              <View style={styles.dateModeRow}>
                {(["weekly", "monthly", "yearly"] as RecurringInterval[]).map((interval) => (
                  <TouchableOpacity
                    key={interval}
                    style={[styles.dateModeBtn, recInterval === interval && styles.dateModeBtnActive]}
                    onPress={() => setRecInterval(interval)}
                  >
                    <AppText style={[styles.dateModeBtnText, recInterval === interval && styles.whiteText]}>
                      {interval === "weekly" ? "Semana" : interval === "monthly" ? "Mes" : "Año"}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>

              <RecurringSchedule
                day={recDay}
                onDay={setRecDay}
                startMonth={recStartMonth}
                onStartMonth={setRecStartMonth}
                styles={styles}
                colors={colors}
              />

              <AppText style={styles.recurPreview}>
                {INTERVAL_LABELS[recInterval]} · próximo{" "}
                {computeNextRecurrence(
                  recurringAnchorIso(recDay, recStartMonth),
                  recInterval
                ).toLocaleDateString("es", { day: "numeric", month: "short" })}
              </AppText>

              {editingRecur ? (
                <View style={styles.editActionsRow}>
                  <TouchableOpacity style={styles.editSaveButton} onPress={handleSaveRecurring}>
                    <Ionicons name="checkmark-outline" size={18} color={colors.surface} />
                    <AppText style={styles.saveButtonText}>Guardar</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editDeleteButton}
                    onPress={handleDeleteRecurring}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                    <AppText style={styles.deleteButtonText}>Eliminar</AppText>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.saveButton} onPress={handleSaveRecurring}>
                  <Ionicons name="checkmark-outline" size={18} color={colors.surface} />
                  <AppText style={styles.saveButtonText}>
                    {recType === "expense" ? "Crear gasto recurrente" : "Crear ingreso recurrente"}
                  </AppText>
                </TouchableOpacity>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
        </>
      )}
    </View>
  );
}

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
      padding: 16,
    },

    // Period card
    periodCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: 24,
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
    },
    page: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 4,
    },
    xLabels: {
      flexDirection: "row",
      marginTop: 4,
      marginBottom: 4,
    },
    xLabelCell: {
      flex: 1,
      alignItems: "center",
    },
    xLabel: {
      fontSize: 9,
      color: colors.textSecondary,
    },
    statsRow: {
      flexDirection: "row",
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginTop: 8,
    },
    statItem: {
      flex: 1,
      minWidth: 0,
    },
    statItemCenter: {},
    statItemRight: {},
    statLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    statValue: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    incomeColor: {
      color: colors.chartPositive || colors.success,
    },
    expenseColor: {
      color: colors.chartNegative || colors.error,
    },
    textCenter: {
      textAlign: "center" as const,
    },
    textRight: {
      textAlign: "right" as const,
    },
    chartRow: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
    },
    monthNav: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginBottom: 8,
    },
    monthNavLabel: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.textPrimary,
    },
    legend: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    legendDotThin: {
      width: 8,
      height: 3,
      borderRadius: 1.5,
    },
    legendText: {
      fontSize: 11,
      color: colors.textSecondary,
      marginRight: 8,
    },

    // Transactions
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.textPrimary,
    },

    // FAB
    fab: {
      position: "absolute",
      right: 20,
      bottom: 28,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: "center",
      alignItems: "center",
    },

    // Modal
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    // Overlay para importacion SMS (fuera del Modal RN para evitar
    // conflicto con PermissionsAndroid en New Architecture).
    smsOverlayHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    smsOverlayTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    smsScroll: {
      padding: 16,
      paddingBottom: 40,
      flexGrow: 1,
    },
    smsEmptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
      paddingHorizontal: 16,
    },
    smsEmptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    smsEmptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.textPrimary,
      marginBottom: 8,
      textAlign: "center",
    },
    smsEmptyDesc: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 24,
      paddingHorizontal: 12,
    },
    smsStartButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 28,
    },
    smsStartButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.surface,
    },
    smsResultHeader: {
      marginBottom: 16,
    },
    smsResultCount: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    smsResultSub: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    smsFilterRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 14,
    },
    smsFilterChip: {
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    smsFilterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    smsFilterText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    smsFilterTextActive: {
      color: colors.surface,
    },
    smsFilterEmpty: {
      paddingVertical: 28,
      alignItems: "center",
    },
    smsListWrap: {
      gap: 10,
      marginBottom: 20,
    },
    smsCardDate: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    smsAddButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
    },
    smsAddButtonText: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.surface,
    },
    modalView: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "90%",
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "bold",
      color: colors.textPrimary,
    },
    modalScroll: {
      padding: 16,
      paddingBottom: 32,
    },

    // Form
    kindGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginBottom: 16,
    },
    kindGridItem: {
      flexBasis: "48%",
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: 14,
      paddingHorizontal: 8,
    },
    kindGridItemActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    kindGridLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textPrimary,
      textAlign: "center",
    },
    typeSelector: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 4,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    typeButton: {
      flex: 1,
      paddingVertical: 10,
      alignItems: "center",
      borderRadius: 8,
    },
    typeButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    expenseBg: {
      backgroundColor: colors.error,
    },
    incomeBg: {
      backgroundColor: colors.success,
    },
    whiteText: {
      color: colors.surface,
    },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: 8,
    },
    categoryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16,
    },
    categoryBadge: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    categoryBadgeSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    categoryBadgeText: {
      fontSize: 12,
      color: colors.textPrimary,
    },
    addCategoryBadge: {
      flexDirection: "row",
      alignItems: "center",
      borderColor: colors.primary,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 12,
      gap: 4,
    },
    addCategoryText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "500",
    },
    newCatRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 16,
    },
    newCatAdd: {
      backgroundColor: colors.success,
      borderRadius: 10,
      width: 48,
      justifyContent: "center",
      alignItems: "center",
    },
    saveButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
      marginTop: 8,
    },
    saveButtonText: {
      color: colors.surface,
      fontSize: 16,
      fontWeight: "700",
    },
    editActionsRow: {
      flexDirection: "row",
      gap: 12,
      marginTop: 8,
    },
    editSaveButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      padding: 16,
    },
    editDeleteButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: "transparent",
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.error,
      padding: 16,
    },
    deleteButtonText: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.error,
    },

    // Date mode selector
    dateModeRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 4,
    },
    dateModeBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: "center",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    dateModeBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dateModeBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },

    // Amount display
    amountDisplay: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: "center",
      marginBottom: 10,
    },
    amountDisplayText: {
      fontSize: 36,
      fontWeight: "700",
      color: colors.textPrimary,
      letterSpacing: -0.5,
    },

    // Numpad
    numpad: {
      gap: 6,
      marginBottom: 16,
    },
    numpadRow: {
      flexDirection: "row",
      gap: 6,
    },
    numpadKey: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    numpadKeyText: {
      fontSize: 20,
      fontWeight: "600",
      color: colors.textPrimary,
    },

    // Section row
    sectionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    sectionRowActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    savingsToggleWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    savingsColor: {
      color: colors.success,
    },
    importButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 20,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    importButtonText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "600",
    },

    // Gastos recurrentes
    recurCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      gap: 10,
    },
    recurIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.primary + "40",
      backgroundColor: colors.primary + "10",
      alignItems: "center",
      justifyContent: "center",
    },
    recurContent: {
      flex: 1,
      minWidth: 0,
    },
    recurTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    recurMeta: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    recurAmount: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.error,
      flexShrink: 1,
    },
    recurPreview: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.primary,
      textAlign: "center",
      marginTop: 12,
      marginBottom: 4,
    },
    dayGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    dayChip: {
      width: 34,
      height: 30,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    dayChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayChipText: {
      fontSize: 12,
      color: colors.textPrimary,
    },
    startMonthRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    startMonthLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textPrimary,
    },

    // Import modal
    importOptionCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    importOptionTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.textPrimary,
      marginBottom: 3,
    },
    importOptionDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    importHint: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 16,
      lineHeight: 20,
    },
    importFeedback: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginBottom: 12,
    },
    importFeedbackText: {
      fontSize: 14,
      flex: 1,
      color: colors.textPrimary,
    },
    smsCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 14,
      gap: 14,
    },
    smsCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "10",
    },
    smsCardAmount: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.error,
    },
    smsCardDesc: {
      fontSize: 13,
      color: colors.textPrimary,
      marginTop: 2,
    },
    smsCardMeta: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    smsCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    smsCheckboxSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },

  });
}
