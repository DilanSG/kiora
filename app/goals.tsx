import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  ScrollView,
  Animated,
  LayoutChangeEvent,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { KeyboardAvoidingView } from "../components/ui/KeyboardAvoiding";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { useGoals } from "../hooks/useGoals";
import { useNotifications } from "../components/layout/NotificationContext";
import { useAlert } from "../components/ui/AlertModal";
import { useTheme, useThemeMode, ThemeColors, useGlow } from "../lib/theme";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import AppText from "../components/ui/AppText";
import EmptyState from "../components/ui/EmptyState";
import { Ionicons } from "@expo/vector-icons";
import { Goal, GoalStep, Note } from "../lib/storage/types";
import { addTask } from "../lib/storage/tasks";
import { getNotesForEntity, getGoalTutorialSeen, setGoalTutorialSeen } from "../lib/storage";
import { addNote as storageAddNote } from "../lib/storage/notes";
import NoteModal from "../components/features/notes/NoteModal";
import GlowView from "../components/ui/GlowView";
import { CalendarPicker } from "../components/ui/CalendarPicker";
import { formatCurrency, formatInput, formatNumber, parseAmountInput } from "../lib/currency";
import { useSafeBottom } from "../hooks/useSafeBottom";

export default function GoalsScreen() {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);

  const {
    goals,
    createGoal,
    addStepToGoal,
    removeStep,
    toggleStep,
    finalizeGoal,
    markInstallment,
    markInstallmentById,
    updateInstallment,
    deleteGoalId,
    reorderGoals,
    updateGoal,
    addPotContribution,
    redistributeMissedInstallments,
    error,
    setError,
  } = useGoals();
  const { triggerNotification } = useNotifications();
  const { showAlert } = useAlert();

  const [createVisible, setCreateVisible] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [potVisible, setPotVisible] = useState(false);
  const [potTitle, setPotTitle] = useState("");
  const [potDesc, setPotDesc] = useState("");
  const [potMode, setPotMode] = useState<"periodic" | "free">("periodic");
  const [potInterval, setPotInterval] = useState<"weekly" | "monthly">("monthly");
  const [potTotal, setPotTotal] = useState("");
  const [potDate, setPotDate] = useState("");
  const [pickerVisible, setPickerVisible] = useState(false);
  const [objetoVisible, setObjetoVisible] = useState(false);
  const [objetoType, setObjetoType] = useState<"savings" | "payment">("savings");
  const [objetoMode, setObjetoMode] = useState<"periodic" | "free">("periodic");
  const [objetoTitle, setObjetoTitle] = useState("");
  const [objetoTotal, setObjetoTotal] = useState("");
  const [objetoInstallments, setObjetoInstallments] = useState("");
  const [objetoInterval, setObjetoInterval] = useState<"weekly" | "monthly">("monthly");
  const [objetoLimitDate, setObjetoLimitDate] = useState("");

  const [detailGoal, setDetailGoal] = useState<Goal | null>(null);
  const [detailAutoTutorial, setDetailAutoTutorial] = useState(false);
  const [completedGoal, setCompletedGoal] = useState<Goal | null>(null);
  const [confirmGoal, setConfirmGoal] = useState<Goal | null>(null);
  const [actionMode, setActionMode] = useState<"edit" | "delete" | "move" | null>(null);
  const [movePick, setMovePick] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const handleEditSave = async () => {
    const title = editTitle.trim();
    if (!title || !editGoal) return;
    await updateGoal(editGoal.id, { title, description: editDesc.trim() || undefined });
    setEditGoal(null);
    triggerNotification("Meta actualizada", "success");
  };

  // Tras crear la primera meta (la guía nunca se mostró) se abre su detalle
  // con el tutorial activo; queda marcada como vista para no repetirse.
  const maybeAutoTutorial = async (created: Goal | null) => {
    if (!created) return;
    if (await getGoalTutorialSeen()) return;
    await setGoalTutorialSeen();
    setDetailAutoTutorial(true);
    setDetailGoal(created);
  };

  const handleSaveGoal = async () => {
    const title = goalTitle.trim();
    if (!title) {
      showAlert("Atención", "La meta necesita un título.");
      return;
    }
    try {
      const created = await createGoal(
        title,
        goalDesc.trim() || undefined,
        undefined,
        "objective"
      );
      triggerNotification("Meta creada", "success");
      setGoalTitle("");
      setGoalDesc("");
      setCreateVisible(false);
      await maybeAutoTutorial(created);
    } catch {
      showAlert("Error", "No se pudo guardar la meta.");
    }
  };

  // Alcancía: monto deseado + fecha límite, con aportes por periodos o libres.
  // En el modo por periodos el número de aportes se deriva de la fecha.
  const handleSavePot = async () => {
    const title = potTitle.trim();
    if (!title) {
      showAlert("Atención", "La alcancía necesita un nombre.");
      return;
    }
    const totalAmount = parseAmountInput(potTotal);
    if (!totalAmount || totalAmount <= 0) {
      showAlert("Atención", "Indica el monto deseado de la alcancía.");
      return;
    }
    const date = potDate.trim();
    const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(`${date}T00:00:00`).getTime());
    // En modo por periodos la fecha es obligatoria (de ella se derivan los
    // aportes); en modo libre es opcional y sin fecha no hay límite.
    if (potMode !== "free" && !hasDate) {
      showAlert("Atención", "Indica la fecha límite de la alcancía.");
      return;
    }
    try {
      let created: Goal | null;
      if (potMode === "free") {
        created = await createGoal(title, potDesc.trim() || undefined, hasDate ? date : undefined, "pot", undefined, undefined, totalAmount);
      } else {
        const periods = computePotPeriods(date, potInterval);
        created = await createGoal(title, potDesc.trim() || undefined, date, "pot", periods, potInterval, totalAmount);
      }
      triggerNotification("Alcancía creada", "success");
      setPotTitle("");
      setPotDesc("");
      setPotMode("periodic");
      setPotInterval("monthly");
      setPotTotal("");
      setPotDate("");
      setPotVisible(false);
      await maybeAutoTutorial(created);
    } catch {
      showAlert("Error", "No se pudo guardar la alcancía.");
    }
  };

  const handleSaveObjeto = async () => {
    const title = objetoTitle.trim();
    if (!title) {
      showAlert("Atención", "El objeto necesita un nombre.");
      return;
    }
    const total = parseAmountInput(objetoTotal);
    if (!total || total <= 0) {
      showAlert("Atención", "Indica el valor total del objeto.");
      return;
    }
    if (objetoType === "savings") {
      // La fecha es obligatoria solo en modo por periodos (de ella se
      // derivan los aportes); en modo libre es opcional y sin fecha la
      // meta no tiene límite.
      const date = objetoLimitDate.trim();
      const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(`${date}T00:00:00`).getTime());
      if (objetoMode !== "free" && !hasDate) {
        showAlert("Atención", "Indica la fecha para tenerlo ahorrado.");
        return;
      }
      try {
        const created =
          objetoMode === "free"
            ? await createGoal(title, undefined, hasDate ? date : undefined, "savings", undefined, undefined, total)
            : await createGoal(title, undefined, date, "savings", computePotPeriods(date, objetoInterval), objetoInterval, total);
        triggerNotification("Meta creada", "success");
        setObjetoVisible(false);
        setObjetoTitle("");
        setObjetoTotal("");
        setObjetoInstallments("");
        setObjetoInterval("monthly");
        setObjetoLimitDate("");
        setObjetoType("savings");
        await maybeAutoTutorial(created);
      } catch {
        showAlert("Error", "No se pudo guardar la meta.");
      }
      return;
    }
    const installments = parseInt(objetoInstallments, 10);
    if (!installments || installments < 1) {
      showAlert("Atención", "Indica la cantidad de cuotas.");
      return;
    }
    try {
      const created = await createGoal(
        title,
        undefined,
        undefined,
        "payment",
        installments,
        objetoInterval,
        total
      );
      triggerNotification("Meta creada", "success");
      setObjetoVisible(false);
      setObjetoTitle("");
      setObjetoTotal("");
      setObjetoInstallments("");
      setObjetoInterval("monthly");
      setObjetoLimitDate("");
      setObjetoType("savings");
      await maybeAutoTutorial(created);
    } catch {
      showAlert("Error", "No se pudo guardar la meta.");
    }
  };

  const handleConfirmComplete = async (goal: Goal) => {
    try {
      const transitioned = await finalizeGoal(goal.id);
      if (transitioned) {
        triggerNotification(
          `"${goal.title}" completada · +50 koins`,
          "success"
        );
      }
      setConfirmGoal(null);
      setDetailGoal(null);
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "No se pudo completar", "warning");
      setConfirmGoal(null);
    }
  };

  const handleDeleteGoal = (goal: Goal) => {
    showAlert("Eliminar meta", `¿Eliminar "${goal.title}" y todos sus pasos?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await deleteGoalId(goal.id);
          triggerNotification("Meta eliminada", "info");
          if (detailGoal?.id === goal.id) setDetailGoal(null);
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <BackgroundDecor colors={colors} screenVariant={0} />

      {/* Header */}
      <View style={styles.header}>
        <AppText style={styles.screenTitle}>Metas</AppText>
      </View>

      {error ? (
        <GlowView style={styles.errorBanner} cardRadius={12}>
          <AppText style={styles.errorText}>{error}</AppText>
          <TouchableOpacity onPress={() => setError(null)}>
            <Ionicons name="close" size={16} color={colors.error} />
          </TouchableOpacity>
        </GlowView>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {goals.length === 0 ? (
          <EmptyState
            icon="ribbon-outline"
            title="Aún no tienes metas"
            subtitle="Toca el botón + para crear la primera"
          />
        ) : (
          <>
            {actionMode !== null && (
              <AppText style={styles.actionHint}>
                {actionMode === "move" && !movePick
                  ? "Toca la primera meta para moverla"
                  : actionMode === "move" && movePick
                  ? "Toca la segunda meta para intercambiar el orden"
                  : actionMode === "edit"
                  ? "Toca la meta que deseas editar"
                  : "Toca la meta que deseas eliminar"}
              </AppText>
            )}
            <View style={styles.goalsList}>
              {goals.map((goal, index) => (
                <View
                  key={goal.id}
                  style={[
                    styles.cardWrap,
                    movePick === goal.id && styles.cardWrapPicked,
                  ]}
                >
                  <GoalCard
                    goal={goal} index={index}
                    onPress={async () => {
                      if (actionMode === "edit") {
                        setEditTitle(goal.title);
                        setEditDesc(goal.description || "");
                        setEditGoal(goal);
                        setActionMode(null);
                      } else if (actionMode === "delete") {
                        setActionMode(null);
                        setMovePick(null);
                        handleDeleteGoal(goal);
                      } else if (actionMode === "move") {
                        if (!movePick) setMovePick(goal.id);
                        else if (movePick === goal.id) setMovePick(null);
                        else {
                          await swapAndReorder(goals, movePick, goal.id, reorderGoals, setMovePick);
                        }
                      } else if (goal.status === "completed") {
                        setCompletedGoal(goal);
                      } else {
                        setDetailAutoTutorial(false);
                        setDetailGoal(goal);
                        // La alcancía por periodos reparte los aportes de los
                        // periodos vencidos sin pagar al abrir el detalle.
                        if (goal.type === "pot" && (goal.installments ?? 0) > 0) {
                          try {
                            const changed = await redistributeMissedInstallments(goal.id);
                            if (changed) {
                              triggerNotification(
                                "Un periodo venció sin pagarse: su aporte se repartió entre los restantes.",
                                "warning"
                              );
                            }
                          } catch {
                            // Si falla, la repartición ocurrirá la próxima vez.
                          }
                        }
                      }
                    }}
                    onLongPress={() => {
                      if (actionMode === null) setActionMode("edit");
                    }}
                    colors={colors} styles={styles}
                  />
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 96 }} />
      </ScrollView>

      {/* Floating action toolbar */}
      {actionMode !== null && (
        <View style={styles.floatingToolbar}>
          <TouchableOpacity
            style={[styles.floatingToolBtn, { backgroundColor: colors.primary }, actionMode === "edit" && styles.floatingToolActive]}
            onPress={() => { setActionMode("edit"); setMovePick(null); }}
          >
            <Ionicons name="pencil-outline" size={20} color={colors.surface} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingToolBtn, { backgroundColor: colors.error }, actionMode === "delete" && styles.floatingToolActive]}
            onPress={() => { setActionMode("delete"); setMovePick(null); }}
          >
            <Ionicons name="trash-outline" size={20} color={colors.surface} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingToolBtn, { backgroundColor: colors.warning }, actionMode === "move" && styles.floatingToolActive]}
            onPress={() => {
              if (actionMode === "move") { setActionMode(null); setMovePick(null); }
              else setActionMode("move");
            }}
          >
            <Ionicons name={actionMode === "move" ? "checkmark-outline" : "swap-vertical-outline"} size={20} color={colors.surface} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingToolBtn, { backgroundColor: colors.textSecondary }]}
            onPress={() => { setActionMode(null); setMovePick(null); }}
          >
            <Ionicons name="close" size={20} color={colors.surface} />
          </TouchableOpacity>
        </View>
      )}

      {/* FAB: abre selector de tipo de meta */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setPickerVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={colors.surface} />
      </TouchableOpacity>

      {/* Selector de tipo de meta (grid 1x3) */}
      <Modal
        visible={pickerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setPickerVisible(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerVisible(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <TouchableOpacity activeOpacity={1}>
              <View style={styles.modalHeader}>
                <AppText style={styles.modalTitle}>Nueva meta</AppText>
                <TouchableOpacity onPress={() => setPickerVisible(false)}>
                  <Ionicons name="close" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={styles.modalScroll}>
                <AppText style={styles.label}>¿Qué tipo de meta deseas crear?</AppText>
                <View style={styles.typeGrid}>
                  <TouchableOpacity
                    style={styles.typeGridItem}
                    onPress={() => {
                      setPickerVisible(false);
                      setGoalTitle("");
                      setGoalDesc("");
                      setCreateVisible(true);
                    }}
                  >
                    <Ionicons name="flag-outline" size={30} color={colors.primary} />
                    <AppText style={styles.typeGridLabel}>Meta de objetivo</AppText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.typeGridItem}
                    onPress={() => {
                      setPickerVisible(false);
                      setObjetoTitle("");
                      setObjetoTotal("");
                      setObjetoInstallments("");
                      setObjetoInterval("monthly");
                      setObjetoLimitDate("");
                      setObjetoType("savings");
                      setObjetoVisible(true);
                    }}
                  >
                    <Ionicons name="cube-outline" size={30} color={colors.primary} />
                    <AppText style={styles.typeGridLabel}>Meta de objeto</AppText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.typeGridItem}
                    onPress={() => {
                      setPickerVisible(false);
                      setPotTitle("");
                      setPotDesc("");
                      setPotMode("periodic");
                      setPotInterval("monthly");
                      setPotTotal("");
                      setPotDate("");
                      setPotVisible(true);
                    }}
                  >
                    <Ionicons name="cash-outline" size={30} color={colors.primary} />
                    <AppText style={styles.typeGridLabel}>Meta de ahorro</AppText>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* Modal: crear objeto (ahorro / crédito) */}
      <Modal
        visible={objetoVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setObjetoVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setObjetoVisible(false)}>
                <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <AppText style={styles.modalTitle}>Nuevo objeto</AppText>
              <TouchableOpacity onPress={() => setObjetoVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <AppText style={styles.label}>Nombre del objeto</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. PlayStation 5"
                placeholderTextColor={colors.textSecondary}
                value={objetoTitle}
                onChangeText={setObjetoTitle}
                returnKeyType="next"
              />

              <AppText style={styles.label}>Tipo</AppText>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                <TouchableOpacity
                  style={[styles.toggleBtn, objetoType === "savings" && styles.toggleBtnActive]}
                  onPress={() => setObjetoType("savings")}
                >
                  <AppText style={[styles.toggleBtnText, objetoType === "savings" && styles.toggleBtnTextActive]}>
                    Ahorro
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, objetoType === "payment" && styles.toggleBtnActive]}
                  onPress={() => setObjetoType("payment")}
                >
                  <AppText style={[styles.toggleBtnText, objetoType === "payment" && styles.toggleBtnTextActive]}>
                    Crédito
                  </AppText>
                </TouchableOpacity>
              </View>

              <AppText style={styles.label}>Valor total del objeto</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. 15.000"
                placeholderTextColor={colors.textSecondary}
                value={objetoTotal}
                onChangeText={(t) => setObjetoTotal(formatInput(t))}
                keyboardType="decimal-pad"
                returnKeyType="next"
              />

              {objetoType === "savings" ? (
                <>
                  <AppText style={styles.label}>¿Cómo ahorrarás?</AppText>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    <TouchableOpacity
                      style={[styles.toggleBtn, objetoMode === "periodic" && styles.toggleBtnActive]}
                      onPress={() => setObjetoMode("periodic")}
                    >
                      <AppText style={[styles.toggleBtnText, objetoMode === "periodic" && styles.toggleBtnTextActive]}>
                        Cada periodo
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toggleBtn, objetoMode === "free" && styles.toggleBtnActive]}
                      onPress={() => setObjetoMode("free")}
                    >
                      <AppText style={[styles.toggleBtnText, objetoMode === "free" && styles.toggleBtnTextActive]}>
                        Cuando tenga
                      </AppText>
                    </TouchableOpacity>
                  </View>
                  {objetoMode === "periodic" ? (
                    <>
                      {/* El periodo se elige primero: de él depende cuándo puede
                          empezar la fecha límite en el calendario. */}
                      <AppText style={styles.label}>Frecuencia de aportes</AppText>
                      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                        <TouchableOpacity
                          style={[styles.toggleBtn, objetoInterval === "weekly" && styles.toggleBtnActive]}
                          onPress={() => setObjetoInterval("weekly")}
                        >
                          <AppText style={[styles.toggleBtnText, objetoInterval === "weekly" && styles.toggleBtnTextActive]}>
                            Semanal
                          </AppText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.toggleBtn, objetoInterval === "monthly" && styles.toggleBtnActive]}
                          onPress={() => setObjetoInterval("monthly")}
                        >
                          <AppText style={[styles.toggleBtnText, objetoInterval === "monthly" && styles.toggleBtnTextActive]}>
                            Mensual
                          </AppText>
                        </TouchableOpacity>
                      </View>

                      {/* Fecha inicial del ahorro: es solo informativa y coincide
                          con el día en que se crea la meta. */}
                      <AppText style={styles.label}>
                        Inicia en:{" "}
                        {new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
                      </AppText>

                      {/* La fecha límite no puede caer en el periodo en curso:
                          semanal exige al menos 7 días, mensual al menos 30. */}
                      <DateField
                        label="Fecha para tenerlo ahorrado"
                        date={objetoLimitDate}
                        onChange={setObjetoLimitDate}
                        minDate={new Date(Date.now() + (objetoInterval === "weekly" ? 7 : 30) * 86400000)}
                      />
                      {(() => {
                        const total = parseAmountInput(objetoTotal);
                        const date = objetoLimitDate.trim();
                        const valid =
                          (total ?? 0) > 0 &&
                          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                          !isNaN(new Date(`${date}T00:00:00`).getTime());
                        if (!valid || !total) return null;
                        const periods = computePotPeriods(date, objetoInterval);
                        const amount = total / periods;
                        return (
                          <View style={{ paddingVertical: 8 }}>
                            <AppText style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}>
                              {periods} aporte{periods === 1 ? "" : "s"} de{" "}
                              <AppText style={{ fontWeight: "700", color: colors.textPrimary }}>
                                {formatCurrency(amount)}
                              </AppText>{" "}
                              cada {objetoInterval === "weekly" ? "semana" : "mes"} hasta la fecha
                            </AppText>
                          </View>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <AppText style={[styles.label, { color: colors.textSecondary }]}>
                        Añadirás aportes cuando quieras hasta alcanzar el valor del objeto.
                      </AppText>
                      {/* La fecha es opcional en modo libre: sin fecha la meta
                          no tiene límite y se va completando con los aportes. */}
                      <DateField
                        label="Fecha en la que quisiera tenerlo (opcional)"
                        date={objetoLimitDate}
                        onChange={setObjetoLimitDate}
                        optional
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  <AppText style={styles.label}>¿Cuántas cuotas?</AppText>
                  <TextInput
                    style={styles.input}
                    placeholder="Ej. 10"
                    placeholderTextColor={colors.textSecondary}
                    value={objetoInstallments}
                    onChangeText={setObjetoInstallments}
                    keyboardType="number-pad"
                    returnKeyType="next"
                  />
                  <AppText style={styles.label}>Intervalo entre pagos</AppText>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    <TouchableOpacity
                      style={[styles.toggleBtn, objetoInterval === "weekly" && styles.toggleBtnActive]}
                      onPress={() => setObjetoInterval("weekly")}
                    >
                      <AppText style={[styles.toggleBtnText, objetoInterval === "weekly" && styles.toggleBtnTextActive]}>
                        Semanal
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toggleBtn, objetoInterval === "monthly" && styles.toggleBtnActive]}
                      onPress={() => setObjetoInterval("monthly")}
                    >
                      <AppText style={[styles.toggleBtnText, objetoInterval === "monthly" && styles.toggleBtnTextActive]}>
                        Mensual
                      </AppText>
                    </TouchableOpacity>
                  </View>
                  {objetoTotal && objetoInstallments && (parseAmountInput(objetoTotal) ?? 0) > 0 && parseInt(objetoInstallments) > 0 && (
                    <View style={{ paddingVertical: 8, gap: 6 }}>
                      <AppText style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}>
                        Pago por fecha:{" "}
                        <AppText style={{ fontWeight: "700", color: colors.textPrimary }}>
                          {formatCurrency((parseAmountInput(objetoTotal) ?? 0) / parseInt(objetoInstallments))}
                        </AppText>
                      </AppText>
                      {/* Desglose de cuotas con su fecha de pago: la primera
                          arranca en el primer periodo tras la creación. */}
                      {Array.from({ length: Math.min(parseInt(objetoInstallments), 6) }, (_, i) => {
                        const days = objetoInterval === "weekly" ? 7 : 30;
                        const due = new Date(Date.now() + (i + 1) * days * 86400000);
                        return (
                          <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 }}>
                            <AppText style={{ fontSize: 13, color: colors.textSecondary }}>
                              Cuota {i + 1}
                            </AppText>
                            <AppText style={{ fontSize: 13, color: colors.textPrimary }}>
                              {due.toLocaleDateString("es", { day: "numeric", month: "short" })}
                            </AppText>
                          </View>
                        );
                      })}
                      {parseInt(objetoInstallments) > 6 && (
                        <AppText style={{ fontSize: 12, color: colors.textSecondary, textAlign: "center" }}>
                          + {parseInt(objetoInstallments) - 6} cuotas más
                        </AppText>
                      )}
                    </View>
                  )}
                </>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveObjeto}>
                <AppText style={styles.saveBtnText}>Crear meta</AppText>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal: crear alcancía (ahorro libre o por periodos) */}
      <Modal
        visible={potVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPotVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setPotVisible(false)}>
                <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <AppText style={styles.modalTitle}>Nueva alcancía</AppText>
              <TouchableOpacity onPress={() => setPotVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <AppText style={styles.label}>Nombre de la alcancía</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. Viaje a la playa"
                placeholderTextColor={colors.textSecondary}
                value={potTitle}
                onChangeText={setPotTitle}
                returnKeyType="next"
              />

              <AppText style={styles.label}>Descripción (opcional)</AppText>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
                placeholder="¿Para qué ahorras?"
                placeholderTextColor={colors.textSecondary}
                value={potDesc}
                onChangeText={setPotDesc}
                multiline
              />

              <AppText style={styles.label}>Monto deseado</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. 10.000"
                placeholderTextColor={colors.textSecondary}
                value={potTotal}
                onChangeText={(t) => setPotTotal(formatInput(t))}
                keyboardType="decimal-pad"
                returnKeyType="next"
              />

              <AppText style={styles.label}>¿Cómo ahorrarás?</AppText>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                <TouchableOpacity
                  style={[styles.toggleBtn, potMode === "periodic" && styles.toggleBtnActive]}
                  onPress={() => setPotMode("periodic")}
                >
                  <AppText style={[styles.toggleBtnText, potMode === "periodic" && styles.toggleBtnTextActive]}>
                    Cada periodo
                  </AppText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, potMode === "free" && styles.toggleBtnActive]}
                  onPress={() => setPotMode("free")}
                >
                  <AppText style={[styles.toggleBtnText, potMode === "free" && styles.toggleBtnTextActive]}>
                    Cuando tenga
                  </AppText>
                </TouchableOpacity>
              </View>

              {potMode === "periodic" ? (
                <>
                  <AppText style={styles.label}>Frecuencia de aportes</AppText>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                    <TouchableOpacity
                      style={[styles.toggleBtn, potInterval === "weekly" && styles.toggleBtnActive]}
                      onPress={() => setPotInterval("weekly")}
                    >
                      <AppText style={[styles.toggleBtnText, potInterval === "weekly" && styles.toggleBtnTextActive]}>
                        Semanal
                      </AppText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.toggleBtn, potInterval === "monthly" && styles.toggleBtnActive]}
                      onPress={() => setPotInterval("monthly")}
                    >
                      <AppText style={[styles.toggleBtnText, potInterval === "monthly" && styles.toggleBtnTextActive]}>
                        Mensual
                      </AppText>
                    </TouchableOpacity>
                  </View>
                  {/* La fecha es necesaria en modo por periodos: de ella se
                      derivan el número de aportes y el monto de cada uno. */}
                  <DateField
                    label="Fecha deseada para tener el ahorro"
                    date={potDate}
                    onChange={setPotDate}
                  />
                  {(() => {
                    const total = parseAmountInput(potTotal);
                    const date = potDate.trim();
                    const valid =
                      (total ?? 0) > 0 &&
                      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                      !isNaN(new Date(`${date}T00:00:00`).getTime());
                    if (!valid || !total) return null;
                    const periods = computePotPeriods(date, potInterval);
                    const amount = total / periods;
                    return (
                      <AppText style={[styles.label, { color: colors.textSecondary }]}>
                        {periods} aporte{periods === 1 ? "" : "s"} de {formatCurrency(amount)} cada {potInterval === "weekly" ? "semana" : "mes"} hasta la fecha
                      </AppText>
                    );
                  })()}
                </>
              ) : (
                <>
                  <AppText style={[styles.label, { color: colors.textSecondary }]}>
                    Añadirás aportes cuando quieras hasta alcanzar el monto deseado.
                  </AppText>
                  {/* La fecha es opcional en modo libre: sin fecha la alcancía
                      no tiene límite y se completa según los aportes. */}
                  <DateField
                    label="Fecha deseada para tener el ahorro (opcional)"
                    date={potDate}
                    onChange={setPotDate}
                    optional
                  />
                </>
              )}

              <TouchableOpacity style={styles.saveBtn} onPress={handleSavePot}>
                <AppText style={styles.saveBtnText}>Crear alcancía</AppText>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal: crear meta */}
      <Modal
        visible={createVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Nueva meta</AppText>
              <TouchableOpacity onPress={() => setCreateVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <AppText style={styles.label}>Título</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. Aprender italiano"
                placeholderTextColor={colors.textSecondary}
                value={goalTitle}
                onChangeText={setGoalTitle}
                returnKeyType="next"
              />
              <AppText style={styles.label}>Descripción (opcional)</AppText>
              <TextInput
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
                placeholder="¿Por qué te importa esta meta?"
                placeholderTextColor={colors.textSecondary}
                value={goalDesc}
                onChangeText={setGoalDesc}
                multiline
              />

              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveGoal}>
                <AppText style={styles.saveBtnText}>Crear meta</AppText>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal: editar meta */}
      <Modal
        visible={!!editGoal}
        animationType="slide"
        transparent
        onRequestClose={() => setEditGoal(null)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalView}
          >
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Editar meta</AppText>
              <TouchableOpacity onPress={() => setEditGoal(null)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
            >
              <AppText style={styles.label}>Título</AppText>
              <TextInput
                style={styles.input}
                placeholder="Título de la meta"
                placeholderTextColor={colors.textSecondary}
                value={editTitle}
                onChangeText={setEditTitle}
                returnKeyType="next"
              />
              <AppText style={styles.label}>Descripción</AppText>
              <TextInput
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
                placeholder="Descripción opcional"
                placeholderTextColor={colors.textSecondary}
                value={editDesc}
                onChangeText={setEditDesc}
                multiline
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handleEditSave}>
                <AppText style={styles.saveBtnText}>Guardar cambios</AppText>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal: detalle / mapa mental */}
      {detailGoal ? (
        <GoalDetailModal
          goal={detailGoal}
          goals={goals}
          addStepToGoal={addStepToGoal}
          removeStep={removeStep}
          toggleStep={toggleStep}
          markInstallment={markInstallment}
          markInstallmentById={markInstallmentById}
          updateInstallment={updateInstallment}
          addPotContribution={addPotContribution}
          onClose={() => setDetailGoal(null)}
          onRequestComplete={(g) => setConfirmGoal(g)}
          autoStartTutorial={detailAutoTutorial}
        />
      ) : null}

      {/* Modal: dashboard de meta completada */}
      {completedGoal ? (
        <CompletedGoalDashboard
          goal={completedGoal}
          onClose={() => setCompletedGoal(null)}
        />
      ) : null}

      {/* Modal: felicitación al completar */}
      {confirmGoal ? (
        <CompletionModal
          goal={confirmGoal}
          onConfirm={() => handleConfirmComplete(confirmGoal)}
          onCancel={() => setConfirmGoal(null)}
        />
      ) : null}

    </KeyboardAvoidingView>
  );
}

async function swapAndReorder(
  goals: Goal[], pickId: string, targetId: string,
  reorderFn: (ids: string[]) => Promise<void>,
  setPick: (id: string | null) => void,
) {
  const ids = goals.map(g => g.id);
  const fromIdx = ids.indexOf(pickId);
  const toIdx = ids.indexOf(targetId);
  const newIds = [...ids];
  newIds[fromIdx] = targetId;
  newIds[toIdx] = pickId;
  await reorderFn(newIds);
  setPick(null);
}


// ─── Card de meta ───────────────────────────────────────────────────────────

type GoalCardProps = {
  goal: Goal;
  index: number;
  onPress: () => void;
  onLongPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
};

function GoalCard({
  goal, index,
  onPress, onLongPress, colors, styles,
}: GoalCardProps) {
  const isCompleted = goal.status === "completed";
  const isIncomplete = goal.status === "incomplete";
  const isPot = goal.type === "pot";
  // Ahorro libre de una meta de objeto: sin periodos, funciona como la alcancía.
  const isFreeSavings = goal.type === "savings" && !(goal.installments ?? 0);
  const potFree = (isPot || isFreeSavings) && !(goal.installments ?? 0);
  const hasInstallments = (goal.type === "savings" && (goal.installments ?? 0) > 0) || goal.type === "payment";
  const typeLabel = goal.type === "savings" ? "Ahorro" : goal.type === "payment" ? "Pago" : goal.type === "pot" ? "Alcancía" : "En proceso";
  const statusLabel = isCompleted ? "Completada" : isIncomplete ? "Incompleta" : typeLabel;
  const statusColor = isCompleted ? colors.success : isIncomplete ? colors.error : goal.type === "savings" ? colors.primary : goal.type === "payment" ? colors.warning : goal.type === "pot" ? colors.success : colors.primary;
  const statusIcon: keyof typeof Ionicons.glyphMap = isCompleted
    ? "checkmark-circle"
    : isIncomplete
      ? "close-circle"
      : goal.type === "savings" ? "wallet-outline" : goal.type === "payment" ? "card-outline" : goal.type === "pot" ? "cash-outline" : "time-outline";
  const orderColors = [colors.warning, colors.textSecondary, colors.error];
  const orderColor = index < 3 ? orderColors[index] : undefined;
  const { glowStyle } = useGlow();
  const potMissedCount = isPot ? (goal.installmentList ?? []).filter((i) => i.missed).length : 0;
  const savingsProgress = hasInstallments && goal.installments
    ? (goal.completedInstallments ?? 0) / goal.installments
    : isPot && !potFree && goal.installments
      ? ((goal.completedInstallments ?? 0) + potMissedCount) / goal.installments
      : 0;
  const amountPerPayment = goal.totalAmount && goal.installments
    ? goal.totalAmount / goal.installments
    : 0;
  const potAccumulated = (isPot || isFreeSavings) ? (goal.contributions ?? []).reduce((s, c) => s + (c.amount ?? 0), 0) : 0;
  const potRemaining = (isPot || isFreeSavings) ? Math.max(0, (goal.totalAmount ?? 0) - potAccumulated) : 0;
  const potProgress = goal.totalAmount ? Math.min(1, potAccumulated / goal.totalAmount) : 0;

  return (
    <TouchableOpacity
      style={[
        styles.goalCard,
        isCompleted && styles.goalCardDone,
        glowStyle,
      ]}
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    >
      {/* Gradient accent top bar */}
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        colors={
          isCompleted
            ? [colors.success, colors.success + "40"]
            : isIncomplete
              ? [colors.error, colors.error + "40"]
              : [colors.primary, colors.primary + "40"]
        }
        style={styles.cardAccent}
      />

      <View style={styles.cardInner}>
        <View style={styles.goalCardTop}>
          <View style={[styles.orderBadge, { backgroundColor: (orderColor || colors.primary) + "20" }]}>
            <AppText style={[styles.goalOrderText, { color: orderColor || colors.primary }]}>
              #{index + 1}
            </AppText>
          </View>
          <View style={[styles.statusBadge, { borderColor: statusColor }]}>
            <Ionicons name={statusIcon} size={11} color={statusColor} />
            <AppText style={[styles.statusBadgeText, { color: statusColor }]}>
              {statusLabel}
            </AppText>
          </View>
        </View>

        {/* Decorative icon */}
        <View style={styles.cardIconWrap}>
          <LinearGradient
            colors={
              isCompleted
                ? [colors.success + "30", colors.success + "08"]
                : [colors.primary + "30", colors.primary + "08"]
            }
            style={styles.cardIconBg}
          >
            <Ionicons
              name={isCompleted ? "checkmark-done-outline" : goal.type === "savings" ? "wallet-outline" : goal.type === "payment" ? "card-outline" : goal.type === "pot" ? "cash-outline" : "flag-outline"}
              size={22}
              color={isCompleted ? colors.success : isIncomplete ? colors.error : colors.primary}
            />
          </LinearGradient>
        </View>

        {/* Title */}
        <AppText
          style={[styles.goalCardTitle, isCompleted && styles.goalCardTitleDone]}
          numberOfLines={2}
        >
          {goal.title.toUpperCase()}
        </AppText>

        {/* Description */}
        {goal.description ? (
          <AppText style={styles.goalCardDesc} numberOfLines={3}>
            {goal.description}
          </AppText>
        ) : null}

        {/* Step indicator or savings/payment progress */}
        {hasInstallments ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border }}>
                <View style={{ width: `${Math.round(savingsProgress * 100)}%` as any, height: 6, borderRadius: 3, backgroundColor: isCompleted ? colors.success : colors.primary }} />
              </View>
              <AppText style={{ fontSize: 11, fontWeight: "700", color: colors.textSecondary }}>
                {goal.completedInstallments ?? 0}/{goal.installments}
              </AppText>
            </View>
            <AppText style={{ fontSize: 10, color: colors.textSecondary }}>
              {goal.interval === "weekly" ? "Semanal" : "Mensual"} · {goal.installments} {goal.installments === 1 ? "pago" : "pagos"}
              {amountPerPayment > 0 ? ` · ${formatCurrency(amountPerPayment)} c/u` : ""}
            </AppText>
          </View>
        ) : potFree ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border }}>
                <View style={{ width: `${Math.round(potProgress * 100)}%` as any, height: 6, borderRadius: 3, backgroundColor: isIncomplete ? colors.error : colors.success }} />
              </View>
              <AppText style={{ fontSize: 11, fontWeight: "700", color: colors.textSecondary }}>
                {formatCurrency(potAccumulated)}/{formatCurrency(goal.totalAmount ?? 0)}
              </AppText>
            </View>
            <AppText style={{ fontSize: 10, color: colors.textSecondary }}>
              {potRemaining > 0 ? `Faltan ${formatCurrency(potRemaining)}` : "¡Monto alcanzado!"}
            </AppText>
          </View>
        ) : isPot ? (
          <View style={{ gap: 4, marginTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border }}>
                <View style={{ width: `${Math.round(savingsProgress * 100)}%` as any, height: 6, borderRadius: 3, backgroundColor: isCompleted ? colors.success : colors.primary }} />
              </View>
              <AppText style={{ fontSize: 11, fontWeight: "700", color: colors.textSecondary }}>
                {goal.completedInstallments ?? 0}/{goal.installments}
              </AppText>
            </View>
            <AppText style={{ fontSize: 10, color: colors.textSecondary }}>
              {goal.interval === "weekly" ? "Semanal" : "Mensual"} · {goal.installments} {goal.installments === 1 ? "periodo" : "periodos"}
              {amountPerPayment > 0 ? ` · ${formatCurrency(amountPerPayment)} c/u` : ""}
            </AppText>
          </View>
        ) : (
          <View style={styles.stepIndicator}>
            {goal.steps.map((step, i) => (
              <React.Fragment key={step.id}>
                <Ionicons
                  name={step.completed ? "checkmark-circle" : "ellipse-outline"}
                  size={16}
                  color={step.completed ? colors.primary : colors.border}
                />
                <View
                  style={[
                    styles.stepIndicatorLine,
                    { backgroundColor: step.completed ? colors.primary : colors.border },
                  ]}
                />
              </React.Fragment>
            ))}
            <Ionicons
              name={isCompleted ? "flag" : "flag-outline"}
              size={16}
              color={isCompleted ? colors.success : colors.border}
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Modal de detalle: mapa mental tipo canvas ───────────────────────────────

type GoalDetailModalProps = {
  goal: Goal;
  goals: Goal[];
  onClose: () => void;
  onRequestComplete: (goal: Goal) => void;
  addStepToGoal: (goalId: string, title: string, insertAfterIndex: number, description?: string) => Promise<void>;
  removeStep: (stepId: string, goalId: string) => Promise<void>;
  toggleStep: (stepId: string, goalId: string) => Promise<void>;
  markInstallment: (goalId: string) => Promise<void>;
  markInstallmentById: (installmentId: string, goalId: string) => Promise<void>;
  updateInstallment: (installmentId: string, updates: { amount?: number; dueDate?: string }) => Promise<void>;
  addPotContribution: (goalId: string, amount: number) => Promise<void>;
  autoStartTutorial?: boolean;
};

function GoalDetailModal({ goal, goals, onClose, onRequestComplete, addStepToGoal, removeStep, toggleStep, markInstallment, markInstallmentById, updateInstallment, addPotContribution, autoStartTutorial }: GoalDetailModalProps) {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);
  const { triggerNotification } = useNotifications();
  const { showAlert } = useAlert();

  const liveGoal = useMemo(
    () => goals.find((g) => g.id === goal.id) ?? goal,
    [goals, goal]
  );

  const [addStepVisible, setAddStepVisible] = useState(false);
  const [addStepAfterIndex, setAddStepAfterIndex] = useState(-1);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [newStepDescription, setNewStepDescription] = useState("");
  const [selectedStep, setSelectedStep] = useState<GoalStep | null>(null);
  const [editInstallment, setEditInstallment] = useState<{ id: string; amount: number; dueDate: string } | null>(null);
  const [editInstallmentAmount, setEditInstallmentAmount] = useState("");
  const [editInstallmentDate, setEditInstallmentDate] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    index: number;
    amount: number;
    date: string;
    installmentId: string;
    onToggle: () => void;
    onEdit: () => void;
  } | null>(null);

  // Feedback visual al exportar a tareas: el botón se vuelve check durante 1.5s.
  // Vive en el modal padre y se pasa como flag a cada StepPill.
  const [exportedStepId, setExportedStepId] = useState<string | null>(null);
  const exportTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
    };
  }, []);

  const steps = liveGoal.steps;
  const isCompleted = liveGoal.status === "completed";
  const isIncomplete = liveGoal.status === "incomplete";
  const isSavings = liveGoal.type === "savings" || liveGoal.type === "payment";
  const isPot = liveGoal.type === "pot";
  // Ahorro libre de una meta de objeto: sin periodos, misma mecánica que la alcancía.
  const isFreeSavings = isSavings && (liveGoal.installments ?? 0) === 0;
  const potPeriodic = isPot && (liveGoal.installments ?? 0) > 0;
  const potFree = (isPot || isFreeSavings) && (liveGoal.installments ?? 0) === 0;
  const allStepsCompleted =
    steps.length === 0 || steps.every((s) => s.completed);

  // Montos de la alcancía: en modo libre se suman los aportes; en modo por
  // periodos se suman los montos de las cuotas pagadas.
  const potAchieved = potFree
    ? (liveGoal.contributions ?? []).reduce((s, c) => s + (c.amount ?? 0), 0)
    : (liveGoal.installmentList ?? []).filter((i) => i.completed).reduce((s, i) => s + (i.amount ?? 0), 0);
  const potTotal = liveGoal.totalAmount ?? 0;
  const potRemaining = Math.max(0, potTotal - potAchieved);
  const potPct = potTotal > 0 ? Math.min(100, (potAchieved / potTotal) * 100) : 0;

  const [contributionVisible, setContributionVisible] = useState(false);
  const [contributionAmount, setContributionAmount] = useState("");

  const createdLabel = useMemo(
    () => formatLongDate(liveGoal.createdAt),
    [liveGoal.createdAt]
  );

  // Tutorial de uso tipo coach-marks: spotlight sobre cada parte del detalle.
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialIndex, setTutorialIndex] = useState(0);
  const [tutorialTargetKey, setTutorialTargetKey] = useState<string | null>(null);
  const [tutorialRects, setTutorialRects] = useState<Record<string, Rect>>({});

  // Guarda el rect en pantalla de un elemento señalado (mismo valor = sin re-render).
  const tutorialRectsRef = React.useRef<Record<string, Rect>>({});
  const storeTutorialRect = useCallback((key: string, rect: Rect) => {
    // Espejo mutable para leer rects sin depender del estado en efectos.
    tutorialRectsRef.current[key] = rect;
    setTutorialRects((prev) => {
      const prevRect = prev[key];
      if (prevRect && prevRect.x === rect.x && prevRect.y === rect.y && prevRect.w === rect.w && prevRect.h === rect.h) {
        return prev;
      }
      return { ...prev, [key]: rect };
    });
  }, []);

  // Resultado de la medición del canvas: guarda el rect y muestra el paso;
  // si la pill no existe (p. ej. "+" en metas sin pasos) avanza al siguiente.
  const handleTutorialTargetResolved = useCallback((key: string, rect: Rect | null) => {
    if (rect) storeTutorialRect(key, rect);
    if (!rect) {
      setTutorialIndex((i) => i + 1);
    }
  }, [storeTutorialRect]);

  const handleCloseRect = useCallback(
    (rect: Rect) => storeTutorialRect("close", rect),
    [storeTutorialRect]
  );

  // El "+" de añadir aporte vive en la barra de progreso (fuera del canvas):
  // se mide aquí y resuelve el paso "add" del tutorial sin depender del canvas.
  const handleAddRect = useCallback(
    (rect: Rect) => {
      storeTutorialRect("add", rect);
    },
    [storeTutorialRect]
  );

  const tutorialRectForKey = useCallback(
    (key: string): Rect | null => tutorialRects[key] ?? null,
    [tutorialRects]
  );

const tutorialSteps = useMemo(() => {
    // Los pasos recorren el mapa de abajo hacia arriba: se empieza por la
    // fecha inicial (start, abajo), se explica cómo añadir, luego se muestra
    // la pill (esperando a que exista si la meta está vacía), y se termina
    // en la meta (arriba) y en las acciones de la barra superior. El primer
    // paso combina el para qué del tipo de meta con su mecánica.
    const closeStep = {
      key: "close",
      title: "Cerrar",
      body: "La flecha cierra el detalle y vuelve a la lista de metas.",
    };
    if (isPot || isFreeSavings) {
      if (potFree) {
        // Alcancía libre / ahorro suelto: aportes voluntarios con el botón +.
        const hasPills = (liveGoal.contributions ?? []).length > 0;
        return [
          {
            key: "start",
            title: "Una alcancía sin compromisos",
            body: "Sirve para guardar cuando se puede, sin cuotas fijas ni fechas forzadas: tú decides cuánto y cuándo aportar, por eso crece en la medida en que vayas guardando. La fecha inicial solo marca desde cuándo empieza el ahorro.",
          },
          hasPills
            ? {
                key: "add",
                title: "Añadir aporte",
                body: "El botón + de la barra superior registra cada aporte, del monto que tú elijas en ese momento.",
              }
            : {
                key: "add",
                title: "Añadir tu primer aporte",
                body: "Todavía no hay aportes. El botón + de la barra superior crea la primera tarjeta de aporte, que se resta del monto deseado.",
              },
          {
            key: "savings",
            title: "Tus aportes",
            body: "Cada tarjeta es un aporte voluntario ya hecho: no hay cuotas programadas, así que depende de tu constancia. Se suma lo que se guarda y se muestra cuánto falta. Si aún no hay ninguna, añádela con el +.",
          },
          {
            key: "goal",
            title: "Tu meta",
            body: "Es el monto que se desea acumular. Al alcanzarlo con tus aportes, la meta se completará automáticamente.",
          },
          closeStep,
        ];
      }
      // Alcancía por periodos: aportes calculados hasta la fecha límite.
      return [
        {
          key: "start",
          title: "Una alcancía con ritmo",
          body: "Busca combinar constancia y flexibilidad: la app divide el ahorro en periodos (semanales o mensuales) y calcula cuánto aportar en cada uno para llegar a la fecha límite. Si un periodo vence sin aportar, su monto se reparte entre los restantes y nada se pierde.",
        },
        {
          key: "savings",
          title: "Tus aportes",
          body: "Cada tarjeta representa el aporte de un periodo. Al tocarla se puede marcar como aportada o editar su monto. Los periodos pasados sin aportar reparten su parte entre los que quedan, con un aviso.",
        },
        {
          key: "goal",
          title: "Tu meta",
          body: "Al cubrir todos los periodos, la meta se completará automáticamente.",
        },
        closeStep,
      ];
    }
    if (isSavings) {
      if (liveGoal.type === "payment") {
        // Crédito: pagos programados con fecha de vencimiento.
        return [
          {
            key: "start",
            title: "Pagar algo en cuotas",
            body: "Está pensada para financiar algo, como un crédito: en lugar de ahorrar, se salda una deuda, por eso cada cuota tiene su fecha de vencimiento y se marca como pagada una por una. El inicio indica cuándo comenzó el crédito, y los pagos suben hasta la última cuota.",
          },
          {
            key: "savings",
            title: "Los pagos",
            body: "Cada tarjeta es un pago con su fecha límite. Al tocarla se puede marcar como pagado o editar su monto y fecha. Como el objetivo es saldar la deuda, todas las cuotas deben quedar pagadas para completar la meta.",
          },
          {
            key: "goal",
            title: "Tu meta",
            body: "Al completar todos los pagos, la meta se completará automáticamente: el crédito queda saldado.",
          },
          closeStep,
        ];
      }
      // Ahorro de un objeto con cuotas programadas calculadas por la app.
      return [
        {
          key: "start",
          title: "Ahorrar con cuotas fijas",
          body: "Sirve para no tener que decidir cuánto guardar cada vez: la app divide el valor del objeto en cuotas iguales, calcula el aporte de cada periodo y la fecha en que lo tendrías ahorrado. La fecha inicial marca desde cuándo corren las cuotas, y van subiendo hasta la meta.",
        },
        {
          key: "savings",
          title: "Las cuotas",
          body: "Cada tarjeta es una cuota ya calculada por la app, con su monto y su fecha. Al tocarla se puede marcar como pagada o editar. El compromiso es por periodo, a diferencia de la alcancía libre.",
        },
        {
          key: "goal",
          title: "Tu meta",
          body: "Al completar todas las cuotas, la meta se completará automáticamente: ya juntaste el valor del objeto.",
        },
        closeStep,
      ];
    }
    // Objetivo con pasos: plan de acción que se completa acción por acción.
    const hasPills = steps.length > 0;
    return [
      {
        key: "start",
        title: "Un plan de acción en pasos",
        body: "Sirve para metas que no dependen solo de dinero: en lugar de cuotas, se compone de pasos, cada uno una tarea concreta que acerca a la meta (preparar algo, aprender, organizar). El inicio es el punto de partida del plan y la meta espera arriba.",
      },
      hasPills
        ? {
            key: "add",
            title: "Añadir pasos",
            body: "Los botones + del mapa permiten añadir pasos intermedios entre el inicio y la meta: cada paso nuevo es una tarea del plan.",
          }
        : {
            key: "add",
            title: "Añadir tu primer paso",
            body: "Todavía no hay pasos. Los botones + del mapa crean la primera tarjeta de paso, que se marca como completada al tocarla.",
          },
      {
        key: "step",
        title: "Los pasos",
        body: "Tocar un paso permite marcarlo como completado (se solicita confirmación). Mantenerlo presionado permite ver o agregar una nota, exportarlo a Tareas o eliminarlo. Se completa una acción a la vez, no montos. Si aún no hay ninguno, añádelo con el +.",
      },
      {
        key: "goal",
        title: "Tu meta",
        body: "Es la meta que se está construyendo. Al completar todos los pasos, se toca para finalizarla.",
      },
      closeStep,
    ];
  }, [isSavings, isPot, isFreeSavings, potFree, liveGoal.type, liveGoal.contributions, steps.length]);

  const openTutorial = () => {
    setTutorialIndex(0);
    setTutorialVisible(true);
  };

  // Pasos cuyo target aún no existe (meta vacía): la tarjeta se muestra sin
  // spotlight para esperar a que el usuario cree la primera pill con el +.
  const tutorialWaiting =
    potFree && (liveGoal.contributions ?? []).length === 0
      ? tutorialSteps[tutorialIndex]?.key === "savings"
      : !isSavings && !isPot && steps.length === 0
        ? tutorialSteps[tutorialIndex]?.key === "step"
        : false;

  // Cada paso del tutorial pide al canvas que centre y mida su pill. El
  // spotlight se ancla al rect del paso anterior hasta que llegue el nuevo
  // (el overlay anima la transición). El botón de cerrar no es una pill: lo
  // resuelve aquí con su rect propio.
  React.useEffect(() => {
    if (!tutorialVisible) return;
    const step = tutorialSteps[tutorialIndex];
    if (!step) {
      setTutorialVisible(false);
      return;
    }
    if (step.key === "close") {
      // WindowBox ya re-mide el botón (measureRequest); solo hay que esperar
      // su rect para que el spotlight pueda anclarse a él.
      let cancelled = false;
      let tries = 0;
      const tick = () => {
        if (cancelled) return;
        if (tutorialRectsRef.current.close) {
          return;
        }
        tries += 1;
        if (tries > 12) {
          setTutorialVisible(false);
          return;
        }
        setTimeout(tick, 150);
      };
      const timer = setTimeout(tick, 180);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    setTutorialTargetKey(step.key);
  }, [tutorialVisible, tutorialIndex, tutorialSteps]);

  // Primera creación: abre la guía automáticamente al montar el detalle.
  const autoStartRef = React.useRef(false);
  React.useEffect(() => {
    if (autoStartTutorial && !autoStartRef.current) {
      autoStartRef.current = true;
      openTutorial();
    }
  }, [autoStartTutorial]);

  const handleAddStepRequest = (afterNodeIndex: number) => {
    // El canvas invierte el orden de los pasos: la meta va arriba, el
    // nodo de inicio abajo, y los pasos se ordenan de ultimo a primero
    // de arriba hacia abajo. Por eso el indice visual se invierte:
    // afterNodeIndex=0 (gap tras la meta) corresponde a insertar al
    // final del array de pasos (steps.length-1), mientras que
    // afterNodeIndex=steps.length (gap tras el ultimo paso) corresponde
    // al inicio del array (insertAfterIndex=-1).
    const insertAfterIndex = steps.length - 1 - afterNodeIndex;
    setAddStepAfterIndex(insertAfterIndex);
    setNewStepTitle("");
    setNewStepDescription("");
    setAddStepVisible(true);
  };

  const handleConfirmAddStep = async () => {
    const title = newStepTitle.trim();
    if (!title) {
      setAddStepVisible(false);
      return;
    }
    const desc = newStepDescription.trim() || undefined;
    try {
      await addStepToGoal(liveGoal.id, title, addStepAfterIndex, desc);
      triggerNotification("Paso añadido", "success");
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "Error al añadir paso", "warning");
    }
    setAddStepVisible(false);
    setNewStepTitle("");
    setNewStepDescription("");
  };

  const handleToggle = async (step: GoalStep) => {
    if (step.completed) return;
    showAlert(
      "Completar paso",
      `¿Marcar "${step.title}" como completado? Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Completar",
          onPress: async () => {
            try {
              await toggleStep(step.id, liveGoal.id);
            } catch (err: unknown) {
              triggerNotification(err instanceof Error ? err.message : "Transición inválida", "warning");
            }
          },
        },
      ]
    );
  };

  const handleStepLongPress = (step: GoalStep) => {
    setSelectedStep(step);
  };

  const handleDeleteStep = async () => {
    if (!selectedStep) return;
    try {
      await removeStep(selectedStep.id, liveGoal.id);
      setSelectedStep(null);
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "No se puede eliminar", "warning");
    }
  };

  const handleExportToTask = (step: GoalStep) => {
    showAlert(
      "Exportar a tarea",
      `¿Añadir "${step.title}" a la lista de tareas?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Añadir",
          onPress: async () => {
            try {
              await addTask(step.title);
              triggerNotification(`"${step.title}" enviado a tareas`, "success");
              if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
              setExportedStepId(step.id);
              exportTimerRef.current = setTimeout(() => {
                setExportedStepId(null);
                exportTimerRef.current = null;
              }, 1500);
            } catch {
              triggerNotification("No se pudo exportar a tareas", "warning");
            }
          },
        },
      ]
    );
  };

  const handleGoalTap = () => {
    if (isCompleted) {
      triggerNotification("Esta meta ya está completada", "info");
      return;
    }
    if (isIncomplete) {
      triggerNotification("Esta meta venció sin completarse", "warning");
      return;
    }
    if (isSavings || isPot) {
      // Las metas de ahorro/pago se finalizan solas al terminar todo:
      // aquí solo se informa, no se abre confirmación de finalización.
      triggerNotification(
        liveGoal.type === "payment"
          ? "Termina todos los pagos para completar la meta"
          : "Termina todo el ahorro para completar la meta",
        "info"
      );
      return;
    }
    if (!allStepsCompleted) {
      triggerNotification(
        "Completa todos los pasos antes de finalizar",
        "warning"
      );
      return;
    }
    onRequestComplete(liveGoal);
  };

  const handleMarkInstallment = async () => {
    try {
      await markInstallment(liveGoal.id);
      triggerNotification("Pago registrado · +5 koins", "success");
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "Error al registrar pago", "warning");
    }
  };

  const handleOpenEditInstallment = (installmentId: string, currentAmount: number, currentDate: string) => {
    setEditInstallment({ id: installmentId, amount: currentAmount, dueDate: currentDate });
    setEditInstallmentAmount(formatNumber(currentAmount));
    setEditInstallmentDate(currentDate.split("T")[0]);
  };

  // El + de la alcancía libre abre el modal de aporte; el monto se descuenta
  // del monto deseado y se suma a la barra de progreso.
  const handleOpenContribution = () => {
    setContributionAmount("");
    setContributionVisible(true);
  };

  const handleConfirmContribution = async () => {
    const amount = parseAmountInput(contributionAmount);
    if (!amount || amount <= 0) {
      triggerNotification("Ingresa un monto válido.", "warning");
      return;
    }
    try {
      await addPotContribution(liveGoal.id, amount);
      triggerNotification("Aporte añadido · +5 koins", "success");
      setContributionVisible(false);
      setContributionAmount("");
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "Error al añadir aporte", "warning");
    }
  };

  const handleSaveEditInstallment = async () => {
    if (!editInstallment) return;
    const amount = parseAmountInput(editInstallmentAmount);
    if (!amount || amount <= 0) {
      triggerNotification("Ingresa un monto válido.", "warning");
      return;
    }
    const dateStr = editInstallmentDate;
    if (!dateStr) {
      triggerNotification("Ingresa una fecha.", "warning");
      return;
    }
    try {
      await updateInstallment(editInstallment.id, { amount, dueDate: new Date(dateStr).toISOString() });
      triggerNotification("Cuota actualizada", "success");
      setEditInstallment(null);
    } catch (err: unknown) {
      triggerNotification(err instanceof Error ? err.message : "Error al actualizar", "warning");
    }
  };

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
    >
      <View style={styles.detailContainer}>
        {/* Fondo con gradiente diagonal y manchas suaves */}
        <DetailBackground colors={colors} />
        <View style={styles.detailContentColumn}>
          {/* Top bar */}
          <View style={styles.detailTopBar}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText style={styles.detailTitle} numberOfLines={1}>
                {liveGoal.title}
              </AppText>
              {liveGoal.description ? (
                <AppText style={styles.detailDescription} numberOfLines={2}>
                  {liveGoal.description}
                </AppText>
              ) : null}
            </View>
            <WindowBox onRect={handleCloseRect} measureRequest={tutorialVisible ? tutorialIndex + 1 : 0} style={styles.detailCloseBtn}>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="chevron-down" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </WindowBox>
          </View>

          {/* Texto de guía de uso: abre el tutorial paso a paso */}
          <TouchableOpacity onPress={openTutorial} style={styles.detailHelpRow} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6 }}>
            <View style={styles.detailHelpIcon}>
              <Ionicons name="information-circle-outline" size={15} color={colors.primary} />
            </View>
            <AppText style={styles.detailHelpText} numberOfLines={1}>
              ¿Cómo funciona esta meta? Toca para ver la guía
            </AppText>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Meta vencida: la fecha límite pasó sin lograr el monto */}
          {isIncomplete ? (
            <View style={styles.incompleteBanner}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <AppText style={styles.incompleteBannerText} numberOfLines={2}>
                Meta incompleta: la fecha límite pasó sin alcanzar el monto.
              </AppText>
            </View>
          ) : null}

          {/* Barra de progreso de la alcancía (o ahorro libre de objeto): ahorrado vs monto deseado */}
          {isPot || isFreeSavings ? (
            <View style={styles.potProgressRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText style={styles.potProgressText} numberOfLines={1}>
                  Ahorrado {formatCurrency(potAchieved)} de {formatCurrency(potTotal)}
                  {potRemaining > 0 ? ` · faltan ${formatCurrency(potRemaining)}` : ""}
                </AppText>
                <View style={styles.potProgressBar}>
                  <View style={[styles.potProgressFill, { width: `${potPct}%` as any }]} />
                </View>
              </View>
              {potFree && !isCompleted && !isIncomplete ? (
                <WindowBox
                  onRect={handleAddRect}
                  measureRequest={tutorialVisible && tutorialSteps[tutorialIndex]?.key === "add" ? tutorialIndex + 1 : 0}
                  style={styles.contributionAddBtnWrap}
                >
                  <TouchableOpacity
                    onPress={handleOpenContribution}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    style={styles.contributionAddBtn}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add" size={22} color={colors.surface} />
                  </TouchableOpacity>
                </WindowBox>
              ) : null}
            </View>
          ) : null}

          {/* Canvas con nodos posicionados y curvas SVG */}
          <MindMapCanvas
            steps={steps}
            goalTitle={liveGoal.title}
            goalDescription={liveGoal.description}
            createdLabel={createdLabel}
            isCompleted={isCompleted}
            allStepsCompleted={
              isSavings && !potFree
                ? (liveGoal.completedInstallments ?? 0) >= (liveGoal.installments ?? 1)
                : potFree
                  ? potPct >= 100
                  : allStepsCompleted
            }
            onToggleStep={isSavings ? (isIncomplete ? undefined : () => handleMarkInstallment()) : handleToggle}
            onStepLongPress={isSavings || isPot ? undefined : handleStepLongPress}
            onExportToTask={isSavings || isPot ? undefined : handleExportToTask}
            onAddStepRequest={isSavings || isPot ? (potFree && !isIncomplete ? handleOpenContribution : undefined) : handleAddStepRequest}
            onGoalTap={handleGoalTap}
            onEditInstallment={isSavings || potPeriodic ? (isIncomplete ? undefined : handleOpenEditInstallment) : undefined}
            onSavingsPillPress={isSavings || potPeriodic ? (isIncomplete ? undefined : (idx, inst) => {
              const isDone = (liveGoal.completedInstallments ?? 0) > idx;
              if (isDone) {
                if (inst) handleOpenEditInstallment(inst.id, inst.amount, inst.dueDate);
                return;
              }
              if (inst?.missed) {
                triggerNotification(isPot ? "Este periodo venció: su aporte ya se repartió entre los restantes." : "Este pago venció: su monto ya se repartió entre los restantes.", "info");
                return;
              }
              setPendingAction({
                index: idx,
                amount: inst?.amount ?? 0,
                date: inst?.dueDate ?? "",
                installmentId: inst?.id ?? "",
                onToggle: () => {
                  setPendingAction(null);
                  if (inst) markInstallmentById(inst.id, liveGoal.id).then(() => {
                    triggerNotification(isPot ? "Aporte registrado · +5 koins" : "Pago registrado · +5 koins", "success");
                  }).catch((err: unknown) => {
                    triggerNotification(err instanceof Error ? err.message : "Error", "warning");
                  });
                },
                onEdit: () => {
                  setPendingAction(null);
                  if (inst) handleOpenEditInstallment(inst.id, inst.amount, inst.dueDate);
                },
              });
            }) : undefined}
            interactionLocked={tutorialVisible}
            tutorialTargetKey={tutorialTargetKey}
            onTutorialTargetResolved={handleTutorialTargetResolved}
            tutorialExternalKeys={potFree && !isCompleted && !isIncomplete ? ["add"] : undefined}
            tutorialWaitKeys={
              potFree && (liveGoal.contributions ?? []).length === 0
                ? ["savings"]
                : !isSavings && !isPot && steps.length === 0
                  ? ["step"]
                  : undefined
            }
            colors={colors}
            styles={styles}
            autoCompleteHint={
              liveGoal.type === "payment"
                ? "Se completa al terminar todos los pagos"
                : undefined
            }
            savings={isSavings && !isFreeSavings ? {
              installments: liveGoal.installments ?? 0,
              interval: liveGoal.interval ?? "monthly",
              completedInstallments: liveGoal.completedInstallments ?? 0,
              createdAt: liveGoal.createdAt,
              totalAmount: liveGoal.totalAmount,
              installmentList: liveGoal.installmentList?.map((inst) => ({
                id: inst.id,
                amount: inst.amount,
                dueDate: inst.dueDate,
                index: inst.index,
                completed: inst.completed,
              })),
            } : undefined}
            pot={isPot || isFreeSavings ? {
              mode: potFree ? "free" : "periodic",
              installments: liveGoal.installments ?? 0,
              interval: liveGoal.interval ?? "monthly",
              completedInstallments: liveGoal.completedInstallments ?? 0,
              missedCount: (liveGoal.installmentList ?? []).filter((i) => i.missed).length,
              totalAmount: liveGoal.totalAmount,
              createdAt: liveGoal.createdAt,
              contributionList: liveGoal.contributions?.map((c) => ({
                id: c.id,
                amount: c.amount,
                createdAt: c.createdAt,
              })) ?? [],
              installmentList: liveGoal.installmentList?.map((inst) => ({
                id: inst.id,
                amount: inst.amount,
                dueDate: inst.dueDate,
                completed: inst.completed,
                missed: !!inst.missed,
              })) ?? [],
            } : undefined}
          />
        </View>
      </View>

      {/* Modal para crear paso intermedio */}
      <AddStepModal
        visible={addStepVisible}
        title={newStepTitle}
        description={newStepDescription}
        onChangeTitle={setNewStepTitle}
        onChangeDescription={setNewStepDescription}
        onConfirm={handleConfirmAddStep}
        onCancel={() => {
          setAddStepVisible(false);
          setNewStepTitle("");
          setNewStepDescription("");
        }}
      />

      {/* Modal para añadir aporte a la alcancía libre */}
      <AddContributionModal
        visible={contributionVisible}
        amount={contributionAmount}
        onChangeAmount={setContributionAmount}
        onConfirm={handleConfirmContribution}
        onCancel={() => {
          setContributionVisible(false);
          setContributionAmount("");
        }}
      />

      {/* Modal: editar cuota individual */}
      <Modal
        visible={!!editInstallment}
        animationType="fade"
        transparent
        onRequestClose={() => setEditInstallment(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalView, { maxWidth: 340 }]}>
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>Editar cuota</AppText>
              <TouchableOpacity onPress={() => setEditInstallment(null)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16, gap: 12 }}>
              <AppText style={styles.label}>Monto</AppText>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={editInstallmentAmount}
                onChangeText={(t) => setEditInstallmentAmount(formatInput(t))}
                keyboardType="decimal-pad"
              />
              <DateField
                label="Fecha de pago"
                date={editInstallmentDate}
                onChange={setEditInstallmentDate}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveEditInstallment}>
                <AppText style={styles.saveBtnText}>Guardar cambios</AppText>
              </TouchableOpacity>
              {editInstallment && !liveGoal.installmentList?.find((i) => i.id === editInstallment.id)?.completed && !isCompleted && (
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.success }]}
                  onPress={async () => {
                    try {
                      await markInstallmentById(editInstallment.id, liveGoal.id);
                      setEditInstallment(null);
                      triggerNotification("Pago registrado · +5 koins", "success");
                    } catch (err: unknown) {
                      triggerNotification(err instanceof Error ? err.message : "Error al registrar pago", "warning");
                    }
                  }}
                >
                  <AppText style={[styles.saveBtnText, { color: colors.surface }]}>
                    Marcar como pagado
                  </AppText>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: acciones de cuota (más vistoso que un Alert nativo) */}
      <Modal
        visible={!!pendingAction}
        animationType="fade"
        transparent
        onRequestClose={() => setPendingAction(null)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}
          activeOpacity={1}
          onPress={() => setPendingAction(null)}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, borderBottomWidth: 0, paddingHorizontal: 20, paddingTop: 20, paddingBottom: (Platform.OS === "ios" ? 40 : 24) + bottomPad }}>
            {pendingAction && (
              <>
                <View style={{ alignItems: "center", marginBottom: 20 }}>
                  <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 }} />
                  <AppText style={{ fontSize: 17, fontWeight: "700", color: colors.textPrimary }}>
                    Cuota {pendingAction.index + 1}
                  </AppText>
                  <AppText style={{ fontSize: 14, color: colors.textSecondary, marginTop: 4 }}>
                    {formatCurrency(pendingAction.amount)} · {new Date(pendingAction.date).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
                  </AppText>
                </View>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    marginBottom: 10,
                  }}
                  activeOpacity={0.8}
                  onPress={pendingAction.onToggle}
                >
                  <Ionicons name="checkmark-circle-outline" size={20} color={colors.surface} />
                  <AppText style={{ color: colors.surface, fontSize: 15, fontWeight: "700" }}>
                    Marcar como pagado
                  </AppText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                  activeOpacity={0.8}
                  onPress={pendingAction.onEdit}
                >
                  <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                  <AppText style={{ color: colors.textPrimary, fontSize: 15, fontWeight: "600" }}>
                    Editar fecha / monto
                  </AppText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ paddingVertical: 12, alignItems: "center" }}
                  onPress={() => setPendingAction(null)}
                  activeOpacity={0.7}
                >
                  <AppText style={{ color: colors.textSecondary, fontSize: 15, fontWeight: "500" }}>
                    Cancelar
                  </AppText>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Card flotante con info del paso */}
      {selectedStep ? (
        <StepInfoCard
          step={selectedStep}
          onClose={() => setSelectedStep(null)}
          onDelete={handleDeleteStep}
          onExport={() => handleExportToTask(selectedStep)}
        />
      ) : null}

      {/* Tutorial de uso: spotlight + tarjeta inferir, avanza por pasos */}
      <TutorialOverlay
        visible={tutorialVisible}
        index={tutorialIndex}
        steps={tutorialSteps}
        rectForKey={tutorialRectForKey}
        onAdvance={() => setTutorialIndex((i) => Math.min(i + 1, tutorialSteps.length - 1))}
        onFinish={() => setTutorialVisible(false)}
        waiting={tutorialWaiting}
      />
    </Modal>
  );
}

// ─── Fondo con gradiente y manchas ───────────────────────────────────────────

function DetailBackground({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, overflow: "hidden" }]} pointerEvents="none">
      {/* El fondo usa las figuras que el usuario tenga seleccionadas en la
          tienda (con su movimiento), igual que en el resto de la app. */}
      <BackgroundDecor colors={colors} />
    </View>
  );
}

// ─── Canvas mental: nodos + curvas SVG ──────────────────────────────────────

type SavingsConfig = {
  installments: number;
  interval: "weekly" | "monthly";
  completedInstallments: number;
  createdAt: string;
  totalAmount?: number;
  installmentList?: { id: string; amount: number; dueDate: string; index: number; completed: boolean }[];
};

type PotCanvasConfig = {
  mode: "periodic" | "free";
  installments: number;
  interval: "weekly" | "monthly";
  completedInstallments: number;
  missedCount: number;
  totalAmount?: number;
  createdAt: string;
  contributionList?: { id: string; amount: number; createdAt: string }[];
  installmentList?: { id: string; amount: number; dueDate: string; completed: boolean; missed: boolean }[];
};

type CanvasProps = {
  steps: GoalStep[];
  goalTitle: string;
  goalDescription?: string;
  createdLabel: string;
  isCompleted: boolean;
  allStepsCompleted: boolean;
  onToggleStep?: (step: GoalStep) => void;
  onStepLongPress?: (step: GoalStep) => void;
  onExportToTask?: (step: GoalStep) => void;
  onAddStepRequest?: (afterNodeIndex: number) => void;
  onGoalTap: () => void;
  onEditInstallment?: (installmentId: string, currentAmount: number, currentDate: string) => void;
  onSavingsPillPress?: (index: number, installment?: { id: string; amount: number; dueDate: string; completed: boolean; missed?: boolean }) => void;
  interactionLocked?: boolean;
  // Clave del elemento que el tutorial quiere resaltar (goal/step/add/start/savings/close).
  // Al cambiar, el canvas hace scroll para centrar esa pill y la mide en pantalla.
  tutorialTargetKey?: string | null;
  // Avisa al padre con el rect final (o null si el elemento no existe).
  onTutorialTargetResolved?: (key: string, rect: Rect | null) => void;
  // Claves del tutorial que se miden fuera del canvas (p. ej. el + de
  // aporte de la alcancía libre, que vive en la barra superior): el canvas
  // no reportará "no existe" por ellas, las resuelve el padre.
  tutorialExternalKeys?: string[];
  // Claves de pills que aún no existen (meta vacía): el canvas espera a que
  // el usuario cree la primera pill con el + en vez de saltar el paso.
  tutorialWaitKeys?: string[];
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
  savings?: SavingsConfig;
  pot?: PotCanvasConfig;
  // Texto del hint de auto-completado del GoalPill (ahorro vs pago).
  autoCompleteHint?: string;
};

type PlacedNode = {
  id: string;
  kind: "start" | "step" | "goal" | "savings";
  x: number;
  y: number;
  step?: GoalStep;
  savingsIndex?: number;
  completed?: boolean;
};

function MindMapCanvas(props: CanvasProps) {
  const {
    steps,
    goalTitle,
    goalDescription,
    createdLabel,
    isCompleted,
    allStepsCompleted,
    onToggleStep,
    onStepLongPress,
    onExportToTask,
    onAddStepRequest,
    onGoalTap,
    onEditInstallment,
    onSavingsPillPress,
    interactionLocked,
    tutorialTargetKey,
    onTutorialTargetResolved,
    tutorialExternalKeys,
    tutorialWaitKeys,
    colors,
    styles,
    savings,
    pot,
    autoCompleteHint,
  } = props;

  const [size, setSize] = useState({ w: 0, h: 0 });
  const scrollRef = React.useRef<ScrollView>(null);
  // Marco del canvas en ventana: se mide junto con las pills para derivar
  // su posición dentro del contenido (el ScrollView no expone measureInWindow).
  const canvasRef = React.useRef<View>(null);

  // Tamaños reales de las tarjetas (por id): el midpoint de los "+" se calcula
  // sobre el tramo visible del trazo entre bordes, que depende de estas medidas.
  const [nodeSizes, setNodeSizes] = useState<Record<string, NodeSize>>({});
  const nodeSizesRef = React.useRef<Record<string, NodeSize>>({});
  const handleNodeSize = useCallback((id: string, w: number, h: number) => {
    const prev = nodeSizesRef.current[id];
    if (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5) return;
    nodeSizesRef.current[id] = { w, h };
    setNodeSizes({ ...nodeSizesRef.current });
  }, []);

  // Referencias a cada pill (por clave de tutorial) para medirlas a demanda.
  const pillRefs = React.useRef<Map<string, View>>(new Map());
  const registerPillRef = useCallback((key: string) => (node: View | null) => {
    if (node) {
      pillRefs.current.set(key, node);
    } else {
      pillRefs.current.delete(key);
    }
  }, []);

  // Offset de scroll actual del canvas: necesario para convertir una
  // posición medida en ventana a su equivalente dentro del contenido.
  const scrollOffsetRef = React.useRef(0);
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) {
      setSize({ w: width, h: height });
    }
  };

  const isSavings = savings !== undefined;
  const isPot = pot !== undefined;
  const potFree = isPot && pot.mode === "free";
  const nodeCount = isPot
    ? potFree
      ? (pot.contributionList?.length ?? 0) + 1
      : pot.installments
    : isSavings ? savings.installments : steps.length;

  // Altura dinámica del contenido: se estira para dar espacio a muchos pasos
  const STEP_SPACING = 130;
  const TOP_EXTRA = 100;
  const BOTTOM_EXTRA = 80;
  const contentHeight = useMemo(
    () => Math.max(size.h, TOP_EXTRA + nodeCount * STEP_SPACING + BOTTOM_EXTRA),
    [size.h, nodeCount]
  );

  // Medición por paso: cuando el tutorial pide un objetivo, centra esa pill
  // en el viewport del canvas con scroll animado y, una vez que el scroll
  // termina, la mide en coordenadas de ventana. Esto resuelve las metas con
  // muchos pasos: sus pills quedan bajo la línea de visión cuando el canvas
  // está arriba, así que primero se desplaza hacia ellas y recién se mide.
  // La posición en el contenido se deriva de las mediciones en ventana
  // (pill y canvas) más el offset de scroll actual, sin depender de eventos
  // de layout que solo ocurren mientras se abre el tutorial.
  React.useEffect(() => {
    if (!tutorialTargetKey) return;
    let cancelled = false;
    let tries = 0;

    const finishMeasure = (key: string) => {
      if (cancelled) return;
      const pill = pillRefs.current.get(key);
      if (!pill) {
        onTutorialTargetResolved?.(key, null);
        return;
      }
      pill.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        if (w > 0 && h > 0) {
          onTutorialTargetResolved?.(key, { x, y, w, h });
        } else {
          onTutorialTargetResolved?.(key, null);
        }
      });
    };

    const attempt = () => {
      if (cancelled) return;
      tries += 1;
      const key = tutorialTargetKey;
      const pill = pillRefs.current.get(key);
      const cv = canvasRef.current;
      const sv = scrollRef.current;
      if (!pill || !cv || !sv) {
        // La pill aún no montó/registró su ref: reintentar un momento antes
        // de declarar que no existe (p. ej. "+" en una meta sin pasos).
        if (tries > 6) {
          // Las pills de una meta vacía aún no existen: si el paso las espera
          // (tutorialWaitKeys), seguir reintentando hasta que el usuario cree
          // la primera con el + en vez de saltar el paso.
          if (tutorialWaitKeys?.includes(key)) {
            setTimeout(attempt, 300);
            return;
          }
          // Los objetivos externos al canvas los resuelve el padre (WindowBox);
          // si no se reportan aquí como inexistentes, el tutorial no salta el paso.
          if (!tutorialExternalKeys?.includes(key)) {
            onTutorialTargetResolved?.(key, null);
          }
          return;
        }
        setTimeout(attempt, 150);
        return;
      }
      cv.measureInWindow((_cx, cvY) => {
        if (cancelled) return;
        pill.measureInWindow((_px, py, pw, ph) => {
          if (cancelled) return;
          if (pw <= 0 || ph <= 0) {
            if (tries > 6) {
              if (tutorialWaitKeys?.includes(key)) {
                setTimeout(attempt, 300);
                return;
              }
              onTutorialTargetResolved?.(key, null);
            } else {
              setTimeout(attempt, 150);
            }
            return;
          }
          // Centro de la pill dentro del contenido del canvas.
          const contentCenterY = py - cvY + scrollOffsetRef.current + ph / 2;
          const maxScroll = Math.max(0, contentHeight - size.h);
          const targetY = clamp(contentCenterY - size.h / 2, 0, maxScroll);
          sv.scrollTo({ y: targetY, animated: true });
          // El scroll animado tarda ~300ms; medir después de que asiente.
          setTimeout(() => finishMeasure(key), 420);
        });
      });
    };

    const timer = setTimeout(attempt, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tutorialTargetKey, size.h, contentHeight, onTutorialTargetResolved, tutorialWaitKeys]);

  const nodes: PlacedNode[] = useMemo(
    () => isPot
      ? potFree
        ? computePotFreeLayout(size.w, contentHeight, pot.contributionList ?? [])
        : computeSavingsNodeLayout(size.w, contentHeight, pot.installments, pot.completedInstallments)
      : isSavings
        ? computeSavingsNodeLayout(size.w, contentHeight, savings.installments, savings.completedInstallments)
        : computeNodeLayout(size.w, contentHeight, steps),
    [size.w, contentHeight, steps, isSavings, isPot, potFree, pot?.installments, pot?.completedInstallments, pot?.contributionList, savings?.installments, savings?.completedInstallments]
  );

  const connectors = useMemo(() => buildConnectors(nodes, colors, nodeSizes), [nodes, colors, nodeSizes]);
  // El "+" de añadir aporte ya no vive en el canvas: para ahorro/alcancía
  // está en la barra superior del detalle y los aportes son las propias pills.
  const addButtons = useMemo(
    () => (isPot || isSavings) ? [] : buildAddButtons(nodes, nodeSizes),
    [isPot, isSavings, nodes, nodeSizes]
  );

  // Calcular fecha de cada pago según intervalo (ahorro o alcancía por periodos).
  // Si la cuota ya tiene fecha guardada (fue editada), se muestra esa.
  const schedule = savings ?? (isPot && !potFree ? pot : undefined);
  const getPaymentDate = useCallback((index: number): string => {
    if (!schedule) return "";
    const stored = schedule.installmentList?.[index]?.dueDate;
    if (stored && !isNaN(new Date(stored).getTime())) {
      return new Date(stored).toLocaleDateString("es", { day: "numeric", month: "short" });
    }
    const start = new Date(schedule.createdAt);
    const days = schedule.interval === "weekly" ? 7 : 30;
    const due = new Date(start.getTime() + (index + 1) * days * 86400000);
    return due.toLocaleDateString("es", { day: "numeric", month: "short" });
  }, [schedule]);

  // Una meta se puede finalizar cuando todo su contenido está cubierto: en
  // ahorro cuando todas las cuotas están pagadas, en la alcancía por periodos
  // cuando se cubrieron todos los periodos (incluye los no hechos, repartidos
  // entre los demás), en la alcancía libre cuando el monto deseado se alcanzó
  // y en objetivos cuando todos los pasos están completados.
  const canFinalize = useMemo(() => {
    if (isPot) {
      if (potFree) {
        const achieved = (pot.contributionList ?? []).reduce((s, c) => s + (c.amount ?? 0), 0);
        return achieved >= (pot.totalAmount ?? 0);
      }
      return (pot.completedInstallments + pot.missedCount) >= pot.installments;
    }
    if (isSavings) return savings.completedInstallments >= savings.installments;
    return allStepsCompleted;
  }, [isPot, potFree, pot, isSavings, savings, allStepsCompleted]);

  return (
    <View ref={canvasRef} collapsable={false} style={styles.canvas}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: size.w,
          height: contentHeight,
        }}
        onLayout={handleLayout}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={true}
        bounces={true}
        scrollEnabled={!interactionLocked}
      >
      {size.w > 0 && size.h > 0 ? (
        <>
          <Svg
            width={size.w}
            height={contentHeight}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            {connectors.map((c, i) => (
              <Path
                key={`c-${i}`}
                d={c.d}
                stroke={c.color}
                strokeWidth={2}
                fill="none"
                strokeOpacity={c.opacity}
                strokeLinecap="round"
              />
            ))}
          </Svg>

          {nodes.map((n) => (
            <PositionedNode
              key={n.id}
              x={n.x}
              y={n.y}
              onSize={(w, h) => handleNodeSize(n.id, w, h)}
              registerRef={registerPillRef(
                n.kind === "goal" ? "goal" : n.kind === "start" ? "start" : n.kind === "savings" ? "savings" : "step"
              )}
            >
              {n.kind === "start" ? (
                <StartPill label={`Inicio · ${createdLabel}`} colors={colors} styles={styles} />
              ) : n.kind === "savings" ? (
                isPot && potFree ? (
                  <PotContributionPill
                    index={n.savingsIndex ?? 0}
                    amount={pot.contributionList?.[n.savingsIndex ?? 0]?.amount ?? 0}
                    date={pot.contributionList?.[n.savingsIndex ?? 0]?.createdAt
                      ? new Date(pot.contributionList[n.savingsIndex ?? 0]!.createdAt).toLocaleDateString("es", { day: "numeric", month: "short" })
                      : ""}
                    colors={colors}
                    styles={styles}
                  />
                ) : (
                  <SavingsPill
                    index={n.savingsIndex ?? 0}
                    total={isSavings ? savings?.installments ?? 0 : pot?.installments ?? 0}
                    completed={n.savingsIndex !== undefined && n.savingsIndex < (isSavings ? savings?.completedInstallments ?? 0 : pot?.completedInstallments ?? 0)}
                    missed={isPot ? pot?.installmentList?.[n.savingsIndex ?? 0]?.missed : undefined}
                    potPeriod={isPot}
                    date={getPaymentDate(n.savingsIndex ?? 0)}
                    amount={isSavings
                      ? savings?.installmentList?.[n.savingsIndex ?? 0]?.amount ?? (savings?.totalAmount && savings.installments ? savings.totalAmount / savings.installments : 0)
                      : pot?.installmentList?.[n.savingsIndex ?? 0]?.amount ?? (pot?.totalAmount && pot.installments ? pot.totalAmount / pot.installments : 0)}
                    onAction={() => onSavingsPillPress?.(
                      n.savingsIndex ?? 0,
                      isSavings
                        ? savings?.installmentList?.[n.savingsIndex ?? 0]
                        : pot?.installmentList?.[n.savingsIndex ?? 0]
                    )}
                    isGoalCompleted={isCompleted}
                    colors={colors}
                    styles={styles}
                  />
                )
              ) : n.kind === "step" && n.step ? (
                <StepPill
                  step={n.step}
                  onToggle={() => onToggleStep?.(n.step!)}
                  onLongPress={() => onStepLongPress?.(n.step!)}
                  colors={colors}
                  styles={styles}
                />
              ) : (
                <GoalPill
                  title={goalTitle}
                  description={goalDescription}
                  isCompleted={isCompleted}
                  canFinalize={canFinalize && !isCompleted}
                  onTap={onGoalTap}
                  autoComplete={isSavings || isPot}
                  autoCompleteHint={autoCompleteHint}
                  colors={colors}
                  styles={styles}
                />
              )}
            </PositionedNode>
          ))}

          {addButtons.map((b) => (
            <PositionedNode
              key={b.id}
              x={b.x}
              y={b.y}
              registerRef={registerPillRef("add")}
            >
              <AddStepDot onPress={() => onAddStepRequest!(b.afterNodeIndex)} colors={colors} styles={styles} />
            </PositionedNode>
          ))}
        </>
      ) : null}
      </ScrollView>
    </View>
  );
}

function computeNodeLayout(
  width: number,
  height: number,
  steps: GoalStep[]
): PlacedNode[] {
  if (width <= 0 || height <= 0) return [];

  const cx = width / 2;
  const topY = 72;
  const bottomY = height - 40;
  const usableH = Math.max(0, bottomY - topY);

  // Mitades de ancho de cada tipo de pill. Deben coincidir con los maxWidth
  // definidos en los estilos de cada componente (step=200, goal=260, start=180).
  const STEP_HALF = 117; // (200 + 6 + 28) / 2
  const GOAL_HALF = 130; // 260 / 2
  const START_HALF = 90; // 180 / 2

  const nodes: PlacedNode[] = [];
  // Layout invertido: la meta principal va arriba, el nodo de inicio al fondo.
  // Esto crea un flujo visual ascendente que refleja la progresion logica
  // (los pasos de indice menor se completan primero y estan mas cerca del inicio).
  nodes.push({ id: "goal", kind: "goal", x: clampX(cx, width, GOAL_HALF), y: topY });

  if (steps.length === 0) {
    nodes.push({ id: "start", kind: "start", x: clampX(cx, width, START_HALF), y: bottomY });
    return nodes;
  }

  // Distribucion vertical proporcional al numero de pasos.
  // Step 0 (el que se completa primero, indice menor) va cerca del inicio (abajo).
  // Step N-1 (el ultimo en completarse) va cerca de la meta (arriba).
  // El zigzag horizontal alterna entre 30% y 70% del ancho con una leve
  // oscilacion sinusoidal para evitar que los pills se vean monotonos.
  for (let i = 0; i < steps.length; i += 1) {
    const y = topY + ((steps.length - i) * usableH) / (steps.length + 1);
    const baseFrac = i % 2 === 0 ? 0.3 : 0.7;
    const wave = 0.04 * Math.sin((i + 1) * 1.7);
    const xFrac = clamp(baseFrac + wave, 0.18, 0.82);
    const x = clampX(xFrac * width, width, STEP_HALF);
    nodes.push({ id: steps[i].id, kind: "step", x, y, step: steps[i] });
  }

  nodes.push({ id: "start", kind: "start", x: clampX(cx, width, START_HALF), y: bottomY });

  // Ordenar nodos por Y para que los conectores fluyan de forma monotónica
  // (de arriba a abajo) sin ir y volver. El orden del array determina cómo
  // se dibujan las líneas entre nodos; si no está ordenado por Y, las
  // curvas se cruzan y el diagrama se ve desordenado.
  nodes.sort((a, b) => a.y - b.y);

  return nodes;
}

// Layout para metas de ahorro: genera nodos de pago con zigzag horizontal,
// cada nodo representa un pago numerado en orden cronológico.
function computeSavingsNodeLayout(
  width: number,
  height: number,
  installments: number,
  completedInstallments: number
): PlacedNode[] {
  if (width <= 0 || height <= 0 || installments < 1) return [];

  const cx = width / 2;
  const topY = 72;
  const bottomY = height - 40;
  const usableH = Math.max(0, bottomY - topY);
  const STEP_HALF = 117;
  const GOAL_HALF = 130;
  const START_HALF = 90;

  const nodes: PlacedNode[] = [];
  nodes.push({ id: "goal", kind: "goal", x: clampX(cx, width, GOAL_HALF), y: topY });

  for (let i = 0; i < installments; i += 1) {
    const y = topY + ((installments - i) * usableH) / (installments + 1);
    const baseFrac = i % 2 === 0 ? 0.3 : 0.7;
    const wave = 0.04 * Math.sin((i + 1) * 1.7);
    const xFrac = clamp(baseFrac + wave, 0.18, 0.82);
    const x = clampX(xFrac * width, width, STEP_HALF);
    nodes.push({
      id: `payment-${i}`,
      kind: "savings",
      x,
      y,
      savingsIndex: i,
      completed: i < completedInstallments,
    });
  }

  nodes.push({ id: "start", kind: "start", x: clampX(cx, width, START_HALF), y: bottomY });
  nodes.sort((a, b) => a.y - b.y);
  return nodes;
}

// Layout para la alcancía libre: cada aporte es un nodo y el + siempre queda
// entre el último aporte y el inicio, así los aportes crecen hacia la meta.
function computePotFreeLayout(
  width: number,
  height: number,
  contributions: { id: string; amount: number; createdAt: string }[]
): PlacedNode[] {
  if (width <= 0 || height <= 0) return [];

  const cx = width / 2;
  const topY = 72;
  const bottomY = height - 40;
  const usableH = Math.max(0, bottomY - topY);
  const STEP_HALF = 117;
  const GOAL_HALF = 130;
  const START_HALF = 90;

  const nodes: PlacedNode[] = [];
  nodes.push({ id: "goal", kind: "goal", x: clampX(cx, width, GOAL_HALF), y: topY });

  const total = contributions.length;
  for (let i = 0; i < total; i += 1) {
    const y = topY + ((total - i) * usableH) / (total + 1);
    const baseFrac = i % 2 === 0 ? 0.3 : 0.7;
    const wave = 0.04 * Math.sin((i + 1) * 1.7);
    const xFrac = clamp(baseFrac + wave, 0.18, 0.82);
    const x = clampX(xFrac * width, width, STEP_HALF);
    nodes.push({ id: `contribution-${i}`, kind: "savings", x, y, savingsIndex: i });
  }

  nodes.push({ id: "start", kind: "start", x: clampX(cx, width, START_HALF), y: bottomY });
  nodes.sort((a, b) => a.y - b.y);
  return nodes;
}

// Centra un nodo de halfWidth `half` dentro del canvas; lo empuja hacia
// el centro si quedaría fuera de los bordes.
function clampX(x: number, width: number, half: number): number {
  return Math.max(half, Math.min(width - half, x));
}

// Calcula cuántos aportes entran desde hoy hasta una fecha límite según la
// frecuencia elegida (mínimo 1). Usada por el modo por periodos de la alcancía.
function computePotPeriods(targetDate: string, interval: "weekly" | "monthly"): number {
  const target = new Date(`${targetDate}T00:00:00`);
  const now = new Date();
  if (isNaN(target.getTime()) || target.getTime() <= now.getTime()) return 1;
  const diffDays = Math.floor((target.getTime() - now.getTime()) / 86400000);
  if (interval === "weekly") return Math.max(1, Math.ceil(diffDays / 7));
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  return Math.max(1, months + (target.getDate() >= now.getDate() ? 1 : 0));
}

type Connector = { d: string; color: string; opacity: number };

function buildConnectors(nodes: PlacedNode[], colors: ThemeColors, sizes: Record<string, NodeSize>): Connector[] {
  const out: Connector[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const nextStep = b.kind === "step" ? b.step : undefined;
    const isCompletedFlow = nextStep?.completed ?? (b.kind === "savings" ? b.completed : false);
    out.push({
      d: getCurvePath(a, b, sizes[a.id], sizes[b.id]),
      color: isCompletedFlow ? colors.success : colors.textSecondary,
      // El primer trazo sale de la meta: ligeramente más suave para dar
      // jerarquía visual. El resto va a 0.55.
      opacity: a.kind === "goal" ? 0.5 : 0.55,
    });
  }
  return out;
}

type AddButton = { id: string; x: number; y: number; afterNodeIndex: number };

type NodeSize = { w: number; h: number };

function buildAddButtons(nodes: PlacedNode[], sizes: Record<string, NodeSize>): AddButton[] {
  const out: AddButton[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const mid = visibleMidpoint(a, b, sizes[a.id], sizes[b.id]);
    out.push({
      id: `add-${i}`,
      x: mid.x,
      y: mid.y,
      afterNodeIndex: i,
    });
  }
  return out;
}

// Muestreo de la curva cúbica: cuantos más puntos, más exacto el midpoint.
const CURVE_SAMPLES = 28;

// Geometría compartida entre el trazo dibujado y el midpoint de los "+" para
// que ambos sigan exactamente la misma línea: tramo recto vertical que sale
// del centro de A (LEAD px fuera de su borde), Bézier en S con tangente
// vertical en ambos extremos (sale recta, barre hacia la otra tarjeta y entra
// recta) y tramo recto final hacia el centro de B.
type ConnectorGeom = {
  start: { x: number; y: number };
  leadA: { x: number; y: number };
  cp1: { x: number; y: number };
  cp2: { x: number; y: number };
  leadB: { x: number; y: number };
  end: { x: number; y: number };
};

const LEAD = 5;

// Altura estimada de una tarjeta sin medir (primer render): se corrige apenas
// llegan los onSize de los nodos.
const FALLBACK_HALF_H = 16;

function connectorGeom(
  a: PlacedNode,
  b: PlacedNode,
  sizeA?: NodeSize,
  sizeB?: NodeSize
): ConnectorGeom {
  const halfA = sizeA ? sizeA.h / 2 : FALLBACK_HALF_H;
  const halfB = sizeB ? sizeB.h / 2 : FALLBACK_HALF_H;
  // Si las tarjetas están tan juntas que los tramos rectos se cruzarían,
  // se encogen hasta el espacio disponible (borde a borde).
  const gap = b.y - halfB - a.y - halfA;
  const lead = Math.min(LEAD, Math.max(0, gap) / 2);
  const leadA = { x: a.x, y: a.y + halfA + lead };
  const leadB = { x: b.x, y: b.y - halfB - lead };
  // k = cuánto conserva la tangente vertical antes de girar: dominado por la
  // separación horizontal (zigzag) para que la S se note incluso cuando las
  // tarjetas están cerca verticalmente.
  const dz = Math.abs(b.x - a.x);
  const dy = Math.max(0, leadB.y - leadA.y);
  const k = clamp(Math.max(dz * 0.5, dy * 0.25), 10, 80);
  return {
    start: { x: a.x, y: a.y },
    leadA,
    cp1: { x: leadA.x, y: leadA.y + k },
    cp2: { x: leadB.x, y: leadB.y - k },
    leadB,
    end: { x: b.x, y: b.y },
  };
}

function curvePointGeom(g: ConnectorGeom, t: number) {
  const u = 1 - t;
  return {
    x: u * u * u * g.leadA.x + 3 * u * u * t * g.cp1.x + 3 * u * t * t * g.cp2.x + t * t * t * g.leadB.x,
    y: u * u * u * g.leadA.y + 3 * u * u * t * g.cp1.y + 3 * u * t * t * g.cp2.y + t * t * t * g.leadB.y,
  };
}

// Punto medio exacto de la porción visible del trazo entre dos tarjetas. No
// usa t=0.5 del Bézier (que se desvía de la mitad real cuando la curva es
// asimétrica): muestrea el trazo completo (rectos + curva), recorta el tramo
// que queda entre los bordes de ambas tarjetas y toma la mitad por longitud
// de arco. Si las tarjetas aún no se midieron, cae al midpoint del trazo
// completo.
function visibleMidpoint(
  a: PlacedNode,
  b: PlacedNode,
  sizeA?: NodeSize,
  sizeB?: NodeSize
): { x: number; y: number } {
  const g = connectorGeom(a, b, sizeA, sizeB);

  const pts: { x: number; y: number }[] = [g.start, g.leadA];
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    pts.push(curvePointGeom(g, i / CURVE_SAMPLES));
  }
  pts.push(g.leadB, g.end);

  // Con ambas tarjetas medidas se acota al tramo visible: desde que el trazo
  // sale del borde de A hasta que entra en el de B. Sin medidas (primer
  // render) se usa el trazo completo.
  let from = 0;
  let to = pts.length - 1;
  if (sizeA && sizeB) {
    const out = pts.findIndex((p) => Math.abs(p.x - a.x) > sizeA.w / 2 || Math.abs(p.y - a.y) > sizeA.h / 2);
    let inn = -1;
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      if (Math.abs(pts[i].x - b.x) > sizeB.w / 2 || Math.abs(pts[i].y - b.y) > sizeB.h / 2) {
        inn = i;
        break;
      }
    }
    if (out >= 0 && inn >= 0 && out < inn) {
      from = out;
      to = inn;
    }
  }

  // Longitud acumulada del tramo y punto en su mitad (interpolado).
  let total = 0;
  for (let i = from + 1; i <= to; i += 1) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  let acc = 0;
  for (let i = from + 1; i <= to; i += 1) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= total / 2 || i === to) {
      const k = total / 2 - acc;
      const f = seg > 0 ? k / seg : 0;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
      };
    }
    acc += seg;
  }
  return { x: (pts[from].x + pts[to].x) / 2, y: (pts[from].y + pts[to].y) / 2 };
}

function getCurvePath(a: PlacedNode, b: PlacedNode, sizeA?: NodeSize, sizeB?: NodeSize): string {
  const g = connectorGeom(a, b, sizeA, sizeB);
  return `M ${g.start.x} ${g.start.y} L ${g.leadA.x} ${g.leadA.y} C ${g.cp1.x} ${g.cp1.y} ${g.cp2.x} ${g.cp2.y} ${g.leadB.x} ${g.leadB.y} L ${g.end.x} ${g.end.y}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ─── Nodos posicionados (wrapper con auto-medición) ──────────────────────────

type Rect = { x: number; y: number; w: number; h: number };

function PositionedNode({
  x,
  y,
  registerRef,
  onSize,
  children,
}: {
  x: number;
  y: number;
  registerRef?: (node: View | null) => void;
  onSize?: (w: number, h: number) => void;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      ref={registerRef}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) {
          setSize({ w: width, h: height });
        }
        onSize?.(width, height);
      }}
      style={{
        position: "absolute",
        left: size.w > 0 ? x - size.w / 2 : -9999,
        top: size.h > 0 ? y - size.h / 2 : -9999,
        opacity: size.w > 0 && size.h > 0 ? 1 : 0,
      }}
      pointerEvents="box-none"
    >
      {children}
    </View>
  );
}

// ─── Tipos de nodo ───────────────────────────────────────────────────────────

function StartPill({
  label,
  colors,
  styles,
}: {
  label: string;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}) {
  return (
    <View style={styles.startPill}>
      <View style={[styles.startIcon, { backgroundColor: colors.surface, borderColor: colors.textSecondary }]}>
        <Ionicons name="play" size={14} color={colors.textSecondary} />
      </View>
      <AppText style={styles.startLabel}>
        {label}
      </AppText>
    </View>
  );
}

type StepPillProps = {
  step: GoalStep;
  onToggle: () => void;
  onLongPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
};

function StepPill({ step, onToggle, onLongPress, colors, styles }: StepPillProps) {
  const isDone = step.completed;
  return (
    <View style={styles.stepPillWrap}>
      <TouchableOpacity
        activeOpacity={isDone ? 1 : 0.85}
        onPress={isDone ? undefined : onToggle}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={[
          styles.stepPill,
          isDone ? styles.stepPillDone : styles.stepPillActive,
        ]}
      >
        <View style={styles.stepPillInner}>
          <View style={styles.stepPillHeaderRow}>
            <View
              style={[
                styles.stepDot,
                isDone
                  ? { backgroundColor: colors.success, borderColor: colors.success }
                  : { backgroundColor: colors.surface, borderColor: colors.primary },
              ]}
            >
              {isDone ? (
                <Ionicons name="checkmark" size={14} color={colors.surface} />
              ) : (
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: colors.primary,
                  }}
                />
              )}
            </View>
            <AppText
              style={[styles.stepText, isDone && styles.stepTextDone]}
            >
              {step.title}
            </AppText>
          </View>
          {step.description ? (
            <AppText style={styles.stepDescription} numberOfLines={4}>
              {step.description}
            </AppText>
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Nodo de ahorro/pago: representa una cuota individual. Al tocar delega la
// acción al padre mediante onAction para mostrar el menú contextual.
type SavingsPillProps = {
  index: number;
  total: number;
  completed: boolean;
  missed?: boolean;
  date: string;
  amount: number;
  potPeriod?: boolean;
  isGoalCompleted: boolean;
  onAction: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
};

function SavingsPill({ index, total, completed, missed, date, amount, potPeriod, isGoalCompleted, onAction, colors, styles }: SavingsPillProps) {
  return (
    <View style={styles.stepPillWrap}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onAction}
        style={[
          styles.stepPill,
          completed || missed ? styles.stepPillDone : styles.stepPillActive,
        ]}
      >
        <View style={styles.stepPillInner}>
          <View style={styles.stepPillHeaderRow}>
            <View
              style={[
                styles.stepDot,
                completed
                  ? { backgroundColor: colors.success, borderColor: colors.success }
                  : missed
                    ? { backgroundColor: colors.surface, borderColor: colors.error }
                    : { backgroundColor: colors.surface, borderColor: colors.primary },
              ]}
            >
              {completed ? (
                <Ionicons name="checkmark" size={14} color={colors.surface} />
              ) : missed ? (
                <Ionicons name="close" size={14} color={colors.error} />
              ) : (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} />
              )}
            </View>
            <AppText style={[styles.stepText, (completed || missed) && styles.stepTextDone]}>
              {formatCurrency(amount)}
            </AppText>
          </View>
          <AppText style={styles.stepDescription}>
            {missed
              ? "No hecho · repartido entre los restantes"
              : `${potPeriod ? "Periodo" : "Pago"} ${index + 1} · ${date}`}
          </AppText>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Pill de aporte de la alcancía libre: muestra el monto ahorrado y su fecha.
// No es pulsable: su añadido se hace desde el + del canvas.
function PotContributionPill({
  index,
  amount,
  date,
  colors,
  styles,
}: {
  index: number;
  amount: number;
  date: string;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}) {
  return (
    <View style={styles.stepPillWrap}>
      <View style={[styles.stepPill, styles.stepPillActive]}>
        <View style={styles.stepPillInner}>
          <View style={styles.stepPillHeaderRow}>
            <View
              style={[
                styles.stepDot,
                { backgroundColor: colors.surface, borderColor: colors.success },
              ]}
            >
              <Ionicons name="cash-outline" size={13} color={colors.success} />
            </View>
            <AppText style={styles.stepText}>
              {formatCurrency(amount)}
            </AppText>
          </View>
          <AppText style={styles.stepDescription}>
            Aporte {index + 1} · {date}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function GoalPill({
  title,
  description,
  isCompleted,
  canFinalize,
  onTap,
  autoComplete,
  autoCompleteHint = "Se completa al terminar todo el ahorro",
  colors,
  styles,
}: {
  title: string;
  description?: string;
  isCompleted: boolean;
  canFinalize: boolean;
  onTap: () => void;
  // Las metas de ahorro se completan solas al terminar todo el ahorro.
  autoComplete?: boolean;
  // Texto del hint de auto-completado (ahorro vs pago).
  autoCompleteHint?: string;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}) {
  const bg = isCompleted
    ? colors.success
    : canFinalize
    ? colors.primary
    : colors.border;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onTap}
      disabled={isCompleted}
      style={[
        styles.goalPill,
        { backgroundColor: bg, borderColor: bg },
      ]}
    >
      <View style={styles.goalPillInner}>
        <View style={styles.goalPillHeaderRow}>
          <Ionicons
            name={isCompleted ? "checkmark" : "flag"}
            size={20}
            color={colors.surface}
          />
          <AppText style={styles.goalPillText}>
            {title}
          </AppText>
        </View>
        {description ? (
          <AppText style={styles.goalPillDescription} numberOfLines={6}>
            {description}
          </AppText>
        ) : null}
        <AppText style={styles.goalPillHint}>
          {isCompleted
            ? "Completada"
            : autoComplete
            ? autoCompleteHint
            : canFinalize
              ? "Toca para finalizar"
              : "Bloqueada"}
        </AppText>
      </View>
    </TouchableOpacity>
  );
}

function AddStepDot({
  onPress,
  colors,
  styles,
}: {
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={[
        styles.addStepDot,
        {
          backgroundColor: colors.surface,
          borderColor: colors.primary,
        },
      ]}
    >
      <Ionicons name="add" size={11} color={colors.primary} />
    </TouchableOpacity>
  );
}

// ─── Modal para crear paso intermedio ───────────────────────────────────────

function AddStepModal({
  visible,
  title,
  description,
  onChangeTitle,
  onChangeDescription,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  description: string;
  onChangeTitle: (t: string) => void;
  onChangeDescription: (t: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.stepModalView}
        >
          <AppText style={styles.stepModalTitle}>Nuevo paso intermedio</AppText>
          <AppText style={styles.stepModalSubtitle}>
            Define un paso que te acerque a la meta. La descripción es opcional.
          </AppText>
          <TextInput
            autoFocus
            style={styles.input}
            placeholder="Título (obligatorio)"
            placeholderTextColor={colors.textSecondary}
            value={title}
            onChangeText={onChangeTitle}
            returnKeyType="next"
          />
          <TextInput
            style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
            placeholder="Descripción (opcional)"
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={onChangeDescription}
            multiline
            returnKeyType="done"
            onSubmitEditing={onConfirm}
          />
          <View style={styles.stepModalActions}>
            <TouchableOpacity
              style={[styles.stepModalBtn, { borderColor: colors.border }]}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <AppText style={[styles.stepModalBtnText, { color: colors.textSecondary }]}>
                Cancelar
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stepModalBtn, { backgroundColor: colors.primary }]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <AppText style={[styles.stepModalBtnText, { color: colors.surface }]}>
                Agregar
              </AppText>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Card flotante con info del paso ───────────────────────────────────────

function AddContributionModal({
  visible,
  amount,
  onChangeAmount,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  amount: string;
  onChangeAmount: (t: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.stepModalView}
        >
          <AppText style={styles.stepModalTitle}>Nuevo aporte</AppText>
          <AppText style={styles.stepModalSubtitle}>
            Registra cuánto se ahorró. Se descuenta del monto deseado de la meta.
          </AppText>
          <TextInput
            autoFocus
            style={styles.input}
            placeholder="Monto ahorrado"
            placeholderTextColor={colors.textSecondary}
            value={amount}
            onChangeText={(t) => onChangeAmount(formatInput(t))}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={onConfirm}
          />
          <View style={styles.stepModalActions}>
            <TouchableOpacity
              style={[styles.stepModalBtn, { borderColor: colors.border }]}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <AppText style={[styles.stepModalBtnText, { color: colors.textSecondary }]}>
                Cancelar
              </AppText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stepModalBtn, { backgroundColor: colors.primary }]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <AppText style={[styles.stepModalBtnText, { color: colors.surface }]}>
                Añadir
              </AppText>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// Campo de fecha con calendario: al tocar se abre el mismo selector mensual
// de la vista de balances y al elegir un día se cierra y fija la fecha (YYYY-MM-DD).
// Con optional=true se permite dejar la meta sin fecha límite.
function DateField({
  label,
  date,
  onChange,
  minDate,
  optional,
}: {
  label: string;
  date: string;
  onChange: (d: string) => void;
  minDate?: Date;
  optional?: boolean;
}) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const [open, setOpen] = useState(false);
  const selected = date ? new Date(`${date}T12:00:00`) : new Date();

  return (
    <>
      <AppText style={styles.label}>{label}</AppText>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TouchableOpacity
          style={[styles.dateFieldBtn, { flex: 1 }]}
          activeOpacity={0.7}
          onPress={() => setOpen((o) => !o)}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <AppText style={date ? styles.dateFieldText : styles.dateFieldPlaceholder}>
            {date
              ? new Date(`${date}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })
              : optional
              ? "Sin fecha"
              : "Poner fecha"}
          </AppText>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
        </TouchableOpacity>
        {optional && date ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => onChange("")}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 10,
              backgroundColor: colors.background,
            }}
          >
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open && (
        <CalendarPicker
          selected={selected}
          onSelect={(d) => {
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            onChange(iso);
            setOpen(false);
          }}
          allowFuture
          minDate={minDate}
        />
      )}
    </>
  );
}

function StepInfoCard({
  step,
  onClose,
  onDelete,
  onExport,
}: {
  step: GoalStep;
  onClose: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const isDone = step.completed;
  const { glowStyle } = useGlow();

  const [stepNotes, setStepNotes] = useState<Note[]>([]);
  const [stepNoteModalVisible, setStepNoteModalVisible] = useState(false);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  useEffect(() => {
    getNotesForEntity("goal_step", step.id).then(setStepNotes);
  }, [step.id]);

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.stepInfoOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <GlowView style={styles.stepInfoCard} cardRadius={12}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            {/* Close X button */}
            <TouchableOpacity
              onPress={onClose}
              style={styles.stepInfoCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>

            {/* Header with icon + title */}
            <View style={styles.stepInfoHeader}>
              <View
                style={[
                  styles.stepInfoDot,
                  isDone
                    ? { backgroundColor: colors.success, borderColor: colors.success }
                    : { backgroundColor: colors.surface, borderColor: colors.primary },
                ]}
              >
                {isDone ? (
                  <Ionicons name="checkmark" size={16} color={colors.surface} />
                ) : (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                )}
              </View>
              <AppText style={styles.stepInfoTitle}>{step.title}</AppText>
            </View>

            {/* Description */}
            {step.description ? (
              <View style={styles.stepInfoDescWrap}>
                <ScrollView
                  style={styles.stepInfoDescScroll}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <AppText style={styles.stepInfoDesc}>
                    {step.description}
                  </AppText>
                </ScrollView>
              </View>
            ) : null}

            {/* Linked notes */}
            <View style={styles.stepInfoNotesWrap}>
              <AppText style={styles.stepInfoNotesLabel}>Notas</AppText>
              {stepNotes.length === 0 ? (
                <AppText style={styles.stepInfoNotesEmpty}>Sin notas vinculadas</AppText>
              ) : (
                stepNotes.map((note) => (
                  <TouchableOpacity
                    key={note.id}
                    style={styles.linkedNoteRow}
                    onPress={() => setViewingNote(note)}
                    onLongPress={() => setEditingNote(note)}
                  >
                    <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                    <AppText style={styles.linkedNoteText} numberOfLines={1}>
                      {note.title || note.content.split("\n")[0]}
                    </AppText>
                  </TouchableOpacity>
                ))
              )}
              <TouchableOpacity
                style={styles.addLinkedNoteBtn}
                onPress={() => setStepNoteModalVisible(true)}
              >
                <Ionicons name="add-circle-outline" size={14} color={colors.primary} />
                <AppText style={styles.addLinkedNoteText}>Agregar nota</AppText>
              </TouchableOpacity>
            </View>

            {/* Actions row: export + delete */}
            <View style={styles.stepInfoActions}>
              {!isDone && (
                <>
                  <TouchableOpacity
                    style={styles.stepInfoExportBtn}
                    onPress={onExport}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="arrow-forward-circle-outline" size={16} color={colors.primary} />
                    <AppText style={styles.stepInfoExportText}>Exportar a tareas</AppText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.stepInfoDeleteBtn}
                    onPress={onDelete}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <AppText style={styles.stepInfoDeleteText}>Eliminar</AppText>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
        </GlowView>
      </TouchableOpacity>

      <NoteModal
        visible={stepNoteModalVisible || editingNote !== null}
        note={editingNote}
        prefillLinks={[{ entityType: "goal_step", entityId: step.id }]}
        onSave={async (data) => {
          if (editingNote) {
            const { updateNote, updateNoteLinks } = await import("../lib/storage/notes");
            await updateNote(editingNote.id, {
              title: data.title || null,
              content: data.content,
              pinned: data.pinned,
            });
            await updateNoteLinks(editingNote.id, data.links);
          } else {
            await storageAddNote(data.content, data.title || null, data.pinned, [
              ...data.links,
              { entityType: "goal_step" as const, entityId: step.id },
            ]);
          }
          const updated = await getNotesForEntity("goal_step", step.id);
          setStepNotes(updated);
          setEditingNote(null);
          setStepNoteModalVisible(false);
        }}
        onClose={() => { setEditingNote(null); setStepNoteModalVisible(false); }}
      />

      {/* Note viewer modal */}
      <Modal visible={viewingNote !== null} transparent animationType="fade" onRequestClose={() => setViewingNote(null)}>
        <TouchableOpacity style={styles.noteViewerOverlay} activeOpacity={1} onPress={() => setViewingNote(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.noteViewerCard, glowStyle]}>
            <View style={styles.noteViewerHeader}>
              <AppText style={styles.noteViewerTitle} numberOfLines={2}>
                {viewingNote?.title || "Sin título"}
              </AppText>
              <TouchableOpacity onPress={() => setViewingNote(null)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.noteViewerBody}>
              <AppText style={styles.noteViewerContent}>{viewingNote?.content}</AppText>
              <AppText style={styles.noteViewerDate}>
                {viewingNote ? new Date(viewingNote.createdAt).toLocaleDateString("es", {
                  day: "numeric", month: "long", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                }) : ""}
              </AppText>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}

// ─── Tutorial de uso (coach-marks) ─────────────────────────────────────────

// Mide su posición absoluta en pantalla y la reporta por onRect.
// collapsable=false evita que RN optimice la vista y pierda la medición.
function WindowBox({
  onRect,
  children,
  style,
  measureRequest,
}: {
  onRect: (rect: Rect) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  measureRequest?: number;
}) {
  const ref = React.useRef<View>(null);

  const measure = React.useCallback(() => {
    const node = ref.current;
    if (node) node.measureInWindow((x, y, w, h) => onRect({ x, y, w, h }));
  }, [onRect]);

  // Re-mide ante cambios de layout y cuando el padre pide una pasada nueva.
  React.useEffect(() => {
    if (measureRequest) {
      const timer = setTimeout(measure, 180);
      return () => clearTimeout(timer);
    }
  }, [measureRequest, measure]);

  return (
    <View ref={ref} collapsable={false} style={style} onLayout={measure}>
      {children}
    </View>
  );
}

type TutorialStepData = { key: string; title: string; body: string };

// Superposición tipo coach-marks: oscurece el fondo, deja un "hueco" de luz
// sobre el elemento explicado (4 rectángulos oscuros rodeándolo), bloquea
// cualquier toque que no sea suyo y muestra una tarjeta con título, texto,
// progreso y botones Siguiente/Saltar.
function TutorialOverlay({
  visible,
  index,
  steps,
  rectForKey,
  onAdvance,
  onFinish,
  waiting,
}: {
  visible: boolean;
  index: number;
  steps: TutorialStepData[];
  rectForKey: (key: string) => Rect | null;
  onAdvance: () => void;
  onFinish: () => void;
  // Paso sin spotlight: la pill aún no existe (meta vacía) y se espera a que
  // el usuario cree la primera; se muestra la tarjeta sin bloquear el +.
  waiting?: boolean;
}) {
  const colors = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const styles = getTutorialStyles(colors);
  const [cardH, setCardH] = useState(0);

  // El padre ya salta los pasos que no tienen elemento; aquí solo se toma el
  // paso indicado. Si el rect aún no llegó (el canvas está midiendo) se usa el
  // del paso anterior como ancla: así el hueco no desaparece de golpe entre
  // pasos consecutivos y se desliza hacia el nuevo objetivo cuando llega.
  const step = visible ? steps[index] : undefined;
  const prevStep = !step || index === 0 ? undefined : steps[index - 1];
  const rect = step ? (rectForKey(step.key) ?? (prevStep ? rectForKey(prevStep.key) : null)) : null;

  // La tarjeta es un paso "rezagado": muestra el paso anterior hasta que el
  // hueco aterrice en el nuevo objetivo (completion de la animación). Así el
  // contenido no cambia antes de que el spotlight se mueva. Al abrir el
  // tutorial se sincroniza de inmediato.
  const [cardIndex, setCardIndex] = useState(index);
  React.useEffect(() => {
    if (visible) setCardIndex(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const cardStep = steps[cardIndex] ?? step;
  const cardResolved = step ? !!rectForKey(step.key) : false;
  const targetIndexRef = React.useRef(index);

  // Red de seguridad: solo cierra si el índice quedó fuera del rango de pasos.
  React.useEffect(() => {
    if (visible && !step) onFinish();
  }, [visible, step, onFinish]);

  // Paso en espera (meta vacía): el hueco se queda anclado al rect anterior y
  // la tarjeta cambia ya (no hay movimiento que esperar).
  React.useEffect(() => {
    if (visible && waiting && cardIndex !== index) setCardIndex(index);
  }, [visible, waiting, index, cardIndex]);

  const isLast = cardIndex === steps.length - 1;
  const dim = "rgba(0,0,0,0.6)";
  // Aire alrededor del objetivo: el hueco y el marco son un poco más grandes
  // que la tarjeta medida para que el foco no quede pegado a sus bordes.
  const PAD = 10;
  const R = 18;
  // Hooks incondicionales (orden estable aunque el rect aún no exista).
  const hasRectNow = !!rect;
  const padRect = hasRectNow
    ? {
        sx: Math.max(0, rect.x - PAD),
        sy: Math.max(0, rect.y - PAD),
        sw: Math.min(screenW - Math.max(0, rect.x - PAD), rect.w + PAD * 2),
        sh: Math.min(screenH - Math.max(0, rect.y - PAD), rect.h + PAD * 2),
      }
    : { sx: 0, sy: 0, sw: 0, sh: 0 };

  // Transición fluida: cuando el objetivo cambia se anima la posición del
  // hueco (path SVG) y del marco mediante un listener que interpola frame a
  // frame entre el rect anterior y el nuevo.
  const anim = React.useRef(new Animated.Value(0)).current;
  const fromRef = React.useRef(padRect);
  const toRef = React.useRef(padRect);
  const frameRef = React.useRef(padRect);
  const hasRectRef = React.useRef(false);
  const [frame, setFrame] = React.useState(padRect);

  React.useEffect(() => {
    // Sin rect todavía (el canvas está midiendo el nuevo objetivo): se
    // conserva el último frame para no animar hacia la esquina (0,0).
    if (!hasRectNow) return;
    const next = padRect;
    // Primer rect (o reaparición tras un paso sin target): colocación
    // directa, sin animar desde el dummy (0,0).
    if (!hasRectRef.current) {
      hasRectRef.current = true;
      frameRef.current = next;
      setFrame(next);
      if (cardResolved) setCardIndex(index);
      return;
    }
    const prev = frameRef.current;
    if (Math.abs(next.sx - prev.sx) < 0.5 && Math.abs(next.sy - prev.sy) < 0.5 &&
        Math.abs(next.sw - prev.sw) < 0.5 && Math.abs(next.sh - prev.sh) < 0.5) {
      setFrame(next);
      // Sin movimiento: solo cambia el contenido si el objetivo propio ya
      // está medido (si no, es el ancla del paso anterior en transición).
      if (cardResolved) setCardIndex(index);
      return;
    }
    fromRef.current = prev;
    toRef.current = next;
    targetIndexRef.current = index;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 280, useNativeDriver: false }).start(({ finished }) => {
      // La tarjeta cambia cuando el hueco ya llegó al nuevo objetivo. Si la
      // animación terminó contra el ancla porque el rect propio aún no se
      // midió (clics rápidos), se espera a que llegue y reanime.
      if (!finished) return;
      const targetStep = steps[targetIndexRef.current];
      if (!targetStep || !rectForKey(targetStep.key)) return;
      setCardIndex(targetIndexRef.current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRectNow, padRect.sx, padRect.sy, padRect.sw, padRect.sh, index]);

  React.useEffect(() => {
    const id = anim.addListener(({ value }) => {
      const p = fromRef.current;
      const n = toRef.current;
      const f = {
        sx: p.sx + (n.sx - p.sx) * value,
        sy: p.sy + (n.sy - p.sy) * value,
        sw: p.sw + (n.sw - p.sw) * value,
        sh: p.sh + (n.sh - p.sh) * value,
      };
      frameRef.current = f;
      setFrame(f);
    });
    return () => anim.removeListener(id);
  }, [anim]);

  if (!visible || !step) return null;
  if (!rect) return null;

  const { sx, sy, sw, sh } = frame;
  // Hueco redondeado: pantalla completa + rectángulo interior con radio
  // (fillRule evenodd recorta el interior del oscurecido).
  const holePath = `M0,0 H${screenW} V${screenH} H0 Z M${sx + R},${sy} H${sx + sw - R} A${R},${R} 0 0 1 ${sx + sw},${sy + R} V${sy + sh - R} A${R},${R} 0 0 1 ${sx + sw - R},${sy + sh} H${sx + R} A${R},${R} 0 0 1 ${sx},${sy + sh - R} V${sy + R} A${R},${R} 0 0 1 ${sx + R},${sy} Z`;

  // La tarjeta se coloca en el lado con más espacio libre (arriba o abajo del
  // spotlight) para no taparlo ni quedar cortada por los bordes de pantalla.
  // Se usa el rect con aire (sy/sh) para que la tarjeta no invada el hueco.
  const GAP = 16;
  const cardHeight = cardH > 0 ? cardH : 200;
  const spaceBelow = screenH - (sy + sh) - GAP;
  const spaceAbove = sy - GAP;
  const placeOnBottom = spaceBelow >= spaceAbove;
  const cardTop = clamp(
    placeOnBottom ? sy + sh + GAP : sy - GAP - cardHeight,
    GAP,
    Math.max(GAP, screenH - cardHeight - GAP)
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      {/* Oscurecido con hueco redondeado alrededor del objetivo (SVG) */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width={screenW} height={screenH}>
        <Path d={holePath} fill={dim} fillRule="evenodd" />
      </Svg>
      {/* Marco de resaltado alrededor del hueco */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: sx,
          top: sy,
          width: sw,
          height: sh,
          borderWidth: 2,
          borderColor: colors.surface,
          borderRadius: R,
        }}
      />
      {/* Capturador de toques: avanzar al tocar cualquier parte. En espera se
          omite para no bloquear el + que crea la primera pill. */}
      {!waiting ? (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onAdvance}
        />
      ) : null}

      {/* Tarjeta explicativa: se ubica abajo o arriba según el espacio libre */}
      <View
        style={[styles.card, { position: "absolute", left: 16, right: 16, top: cardTop }]}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          if (height !== cardH) setCardH(height);
        }}
      >
        <AppText style={styles.progress} disableHorizontalPadding>
          Paso {cardIndex + 1} de {steps.length}
        </AppText>
        <AppText style={styles.title} disableHorizontalPadding>
          {cardStep.title}
        </AppText>
        <AppText style={styles.body} disableHorizontalPadding>
          {cardStep.body}
        </AppText>
        <View style={styles.actionsRow}>
          <TouchableOpacity onPress={onFinish} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
            <AppText style={styles.skipText} disableHorizontalPadding>
              Saltar
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.nextBtn} onPress={isLast ? onFinish : onAdvance} activeOpacity={0.8}>
            <AppText style={styles.nextText} disableHorizontalPadding>
              {isLast ? "Entendido" : "Siguiente"}
            </AppText>
            <Ionicons name={isLast ? "checkmark" : "arrow-forward"} size={16} color={colors.surface} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function getTutorialStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      zIndex: 300,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      gap: 4,
    },
    progress: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    title: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    body: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 19,
    },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 12,
    },
    skipText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    nextBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    nextText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.surface,
    },
  });
}

// ─── Modal de confirmación / felicitación ────────────────────────────────────

function CompletionModal({
  goal,
  onConfirm,
  onCancel,
}: {
  goal: Goal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const colors = useTheme();
  const styles = getStyles(colors);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmOverlay}>
        <GlowView style={styles.confirmCard} cardRadius={12}>
          <View style={[styles.confirmIconWrap, { backgroundColor: colors.primary }]}>
            <Ionicons name="trophy" size={36} color={colors.surface} />
          </View>
          <AppText style={styles.confirmTitle}>¡Felicidades!</AppText>
          <AppText style={styles.confirmBody}>
            Has alcanzado la meta{" "}
            <AppText style={styles.confirmHighlight}>“{goal.title}”</AppText>.
            Este logro es el resultado de tu disciplina, tu constancia y el
            esfuerzo que has sostenido paso a paso. Permítete reconocer el
            camino recorrido: cada uno de los pasos intermedios que completaste
            te trajo hasta aquí, y eso merece celebrarse.
          </AppText>
          <AppText style={styles.confirmReward}>+50 koins</AppText>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.confirmCancel} onPress={onCancel}>
              <AppText style={styles.confirmCancelText}>Cancelar</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmOk} onPress={onConfirm}>
              <AppText style={styles.confirmOkText}>Marcar como completada</AppText>
            </TouchableOpacity>
          </View>
        </GlowView>
      </View>
    </Modal>
  );
}

// ─── Dashboard de meta completada ───────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function CompletedGoalDashboard({
  goal,
  onClose,
}: {
  goal: Goal;
  onClose: () => void;
}) {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);

  const completedAt = goal.completedAt || goal.createdAt;
  const totalMs =
    new Date(completedAt).getTime() - new Date(goal.createdAt).getTime();

  let prevTime = new Date(goal.createdAt).getTime();
  const stepTimings = goal.steps.map((step) => {
    const unlocked = step.unlockedAt
      ? new Date(step.unlockedAt).getTime()
      : null;
    const durationMs = unlocked ? unlocked - prevTime : 0;
    if (unlocked) prevTime = unlocked;
    return { step, durationMs };
  });

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
    >
      <View style={styles.detailContainer}>
        <DetailBackground colors={colors} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.dashboardContent}
        >
          {/* Header */}
          <View style={styles.dashboardHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText style={styles.dashboardTitle}>{goal.title}</AppText>
              {goal.description ? (
                <AppText style={styles.dashboardDesc}>{goal.description}</AppText>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.detailCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={28} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Stats grid */}
          <View style={styles.dashboardStatsGrid}>
            <GlowView style={[styles.dashboardStatCard, { borderLeftColor: colors.success }]} cardRadius={12}>
              <Ionicons name="checkmark-done" size={22} color={colors.success} />
              <AppText style={styles.dashboardStatValue}>{goal.steps.length}</AppText>
              <AppText style={styles.dashboardStatLabel}>Pasos</AppText>
            </GlowView>
            <GlowView style={[styles.dashboardStatCard, { borderLeftColor: colors.primary }]} cardRadius={12}>
              <Ionicons name="time-outline" size={22} color={colors.primary} />
              <AppText style={styles.dashboardStatValue}>{formatDuration(totalMs)}</AppText>
              <AppText style={styles.dashboardStatLabel}>Duración total</AppText>
            </GlowView>
          </View>

          {/* Dates */}
          <GlowView style={styles.dashboardDatesCard} cardRadius={12}>
            <View style={styles.dashboardDateRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <AppText style={styles.dashboardDateText}>
                Creada: {formatLongDate(goal.createdAt)}
              </AppText>
            </View>
            <View style={styles.dashboardDateRow}>
              <Ionicons name="flag-outline" size={16} color={colors.textSecondary} />
              <AppText style={styles.dashboardDateText}>
                Completada: {formatLongDate(completedAt)}
              </AppText>
            </View>
          </GlowView>

          {/* Timeline */}
          <AppText style={styles.dashboardSectionTitle}>Línea de tiempo</AppText>
          {stepTimings.map(({ step, durationMs }, i) => (
            <View key={step.id} style={styles.timelineRow}>
              <View style={styles.timelineDot} />
              <GlowView style={styles.timelineContent} cardRadius={12}>
                <AppText style={styles.timelineStepTitle}>{step.title}</AppText>
                <AppText style={styles.timelineDuration}>
                  {i === 0
                    ? `Desde el inicio · ${formatDuration(durationMs)}`
                    : `${formatDuration(durationMs)} después del paso anterior`}
                </AppText>
              </GlowView>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

function getStyles(colors: ThemeColors, bottomPad = 0) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 80 + bottomPad,
    },

    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    screenTitle: {
      fontSize: 22,
      fontWeight: "bold",
      color: colors.textPrimary,
    },
    errorBanner: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.error,
      borderRadius: 10,
      padding: 12,
      marginHorizontal: 16,
      marginBottom: 8,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      flex: 1,
    },


    goalsList: {
      gap: 16,
    },
    cardWrap: {
      borderRadius: 20,
    },
    cardWrapPicked: {
      transform: [{ scale: 1.03 }],
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 22,
    },
    actionHint: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: "500",
      textAlign: "center",
      marginBottom: 14,
    },
    floatingToolbar: {
      position: "absolute",
      bottom: 28 + bottomPad,
      left: 0,
      right: 0,
      flexDirection: "row",
      justifyContent: "center",
      gap: 14,
    },
    floatingToolBtn: {
      width: 50,
      height: 50,
      borderRadius: 25,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    floatingToolActive: {
      transform: [{ scale: 1.18 }],
      borderWidth: 2.5,
      borderColor: colors.primary,
    },
    goalCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardAccent: {
      height: 4,
    },
    cardInner: {
      padding: 18,
    },
    goalCardDone: {},
    goalCardPicked: {
      transform: [{ scale: 1.03 }],
      borderWidth: 2,
      borderColor: colors.primary,
    },
    goalCardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    orderBadge: {
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    goalOrderText: {
      fontSize: 13,
      fontWeight: "800",
    },
    cardIconWrap: {
      alignItems: "center",
      marginBottom: 12,
      marginTop: 10,
    },
    cardIconBg: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    goalCardTitle: {
      fontSize: 17,
      fontWeight: "900",
      color: colors.textPrimary,
      textAlign: "center",
      marginBottom: 6,
      letterSpacing: 0.5,
    },
    goalCardTitleDone: {
      color: colors.success,
    },
    goalCardDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
      textAlign: "center",
      marginBottom: 10,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statusBadgeText: {
      fontSize: 10,
      fontWeight: "600",
    },
    stepIndicator: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 10,
    },
    stepIndicatorLine: {
      height: 2,
      flex: 1,
      marginHorizontal: 3,
    },

    fab: {
      position: "absolute",
      right: 20,
      bottom: 20 + bottomPad,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalView: {
      backgroundColor: colors.background,
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
      fontSize: 17,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    modalScroll: {
      padding: 16,
      gap: 8,
      paddingBottom: 24 + bottomPad,
    },
    label: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    toggleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      backgroundColor: colors.background,
    },
    toggleBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "14",
    },
    toggleBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    toggleBtnTextActive: {
      color: colors.primary,
    },

    dateFieldBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: colors.background,
    },
    dateFieldText: {
      flex: 1,
      fontSize: 14,
      color: colors.textPrimary,
    },
    dateFieldPlaceholder: {
      flex: 1,
      fontSize: 14,
      color: colors.textSecondary,
    },

    typeGrid: {
      flexDirection: "row",
      gap: 12,
    },
    typeGridItem: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 28,
      paddingHorizontal: 8,
      gap: 12,
    },
    typeGridLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textPrimary,
      textAlign: "center",
    },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 12,
    },
    saveBtnText: {
      color: colors.surface,
      fontSize: 14,
      fontWeight: "600",
    },
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

    detailContainer: {
      flex: 1,
    },
    detailContentColumn: {
      flex: 1,
    },
    detailTopBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: Platform.OS === "ios" ? 58 : 44,
      paddingBottom: 6,
    },
    detailTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    detailDescription: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
    },
    detailCloseBtn: {
      padding: 8,
    },
    canvas: {
      flex: 1,
    },
    blob: {
      position: "absolute",
    },

    // `maxWidth` en vez de `width`: el contenedor se encoje al contenido
    // (flex) y solo se estira hasta el límite cuando el texto es largo.
    startPill: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 24,
      paddingVertical: 8,
      paddingHorizontal: 14,
      gap: 8,
      maxWidth: 180,
    },
    startIcon: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
    },
    startLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: "500",
      textAlign: "center",
      maxWidth: 138, // 180 pill - 28 padding - 14 icon - gap
    },

    stepPillWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    stepPill: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 18,
      borderWidth: 1,
      maxWidth: 200,
    },
    stepPillInner: {
      gap: 4,
      alignItems: "center",
    },
    stepPillHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    stepPillActive: {
      backgroundColor: colors.surface,
      borderColor: colors.primary,
    },
    stepPillDone: {
      backgroundColor: colors.surface,
      borderColor: colors.success,
    },
    stepDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
    },
    stepText: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: "500",
      textAlign: "center",
      maxWidth: 146, // 200 pill - 24 padding - 22 dot - 8 gap
    },
    stepTextDone: {
      color: colors.success,
      textDecorationLine: "line-through",
    },
    stepDescription: {
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
      textAlign: "center",
      maxWidth: 176, // 200 - 24 padding
    },

    goalPill: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 20,
      borderWidth: 1,
      maxWidth: 260,
    },
    goalPillInner: {
      gap: 4,
      alignItems: "center",
    },
    goalPillHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    goalPillText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.surface,
      textAlign: "center",
      maxWidth: 198, // 260 pill - 32 padding - 20 icon - 10 gap
    },
    goalPillDescription: {
      fontSize: 12,
      color: colors.surface + "EB",
      lineHeight: 16,
      textAlign: "center",
      maxWidth: 228,
    },
    goalPillHint: {
      fontSize: 10,
      color: colors.surface + "D9",
      textAlign: "center",
      marginTop: 2,
    },

    stepInfoOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.35)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    stepInfoCard: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: colors.background + "F2",
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border + "80",
      padding: 24,
      paddingTop: 20,
    },
    stepInfoCloseBtn: {
      position: "absolute",
      top: -4,
      right: -4,
      zIndex: 10,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    stepInfoHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 16,
      paddingRight: 32,
    },
    stepInfoDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      flexShrink: 0,
    },
    stepInfoTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    stepInfoDescWrap: {
      backgroundColor: colors.background + "99",
      borderRadius: 14,
      padding: 4,
      marginBottom: 20,
    },
    stepInfoDescScroll: {
      maxHeight: 180,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    stepInfoDesc: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    stepInfoActions: {
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    stepInfoExportBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary + "40",
      backgroundColor: colors.primary + "0A",
    },
    stepInfoExportText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.primary,
    },
    stepInfoDeleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.error + "40",
      backgroundColor: "transparent",
    },
    stepInfoDeleteText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.error,
    },
    stepInfoBtnText: {
      fontSize: 14,
      fontWeight: "600",
    },

    addStepDot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
    },

    stepModalView: {
      backgroundColor: colors.background,
      margin: 24,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      paddingBottom: 20 + bottomPad,
      gap: 8,
    },
    stepModalTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    stepModalSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    stepModalActions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 8,
    },
    stepModalBtn: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 11,
      alignItems: "center",
    },
    stepModalBtnText: {
      fontSize: 14,
      fontWeight: "600",
    },

    confirmOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    confirmCard: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.background,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      alignItems: "center",
      gap: 12,
    },
    confirmIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    confirmTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    confirmBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: "center",
    },
    confirmHighlight: {
      color: colors.textPrimary,
      fontWeight: "600",
    },
    confirmReward: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.success,
      marginTop: 4,
    },
    confirmActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 12,
      width: "100%",
    },
    confirmCancel: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    confirmCancelText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: "600",
    },
    confirmOk: {
      flex: 1.4,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    confirmOkText: {
      color: colors.surface,
      fontSize: 14,
      fontWeight: "700",
    },

    dashboardContent: {
      padding: 24,
      paddingTop: Platform.OS === "ios" ? 58 : 44,
      paddingBottom: 48 + bottomPad,
    },
    dashboardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 24,
    },
    dashboardTitle: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.textPrimary,
      marginBottom: 4,
    },
    dashboardDesc: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 19,
    },
    dashboardStatsGrid: {
      flexDirection: "row",
      gap: 12,
      marginBottom: 16,
    },
    dashboardStatCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 4,
      padding: 16,
      alignItems: "center",
      gap: 6,
    },
    dashboardStatValue: {
      fontSize: 22,
      fontWeight: "800",
      color: colors.textPrimary,
    },
    dashboardStatLabel: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    dashboardDatesCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
      marginBottom: 24,
    },
    dashboardDateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    dashboardDateText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    dashboardSectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.textPrimary,
      marginBottom: 14,
    },
    timelineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
      marginBottom: 16,
    },
    timelineDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
      marginTop: 4,
    },
    timelineContent: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    timelineStepTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: 2,
    },
    timelineDuration: {
      fontSize: 12,
      color: colors.textSecondary,
    },

    ptsOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    ptsCard: {
      width: "100%",
      maxWidth: 360,
      backgroundColor: colors.background,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
    },
    ptsHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    ptsTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.textPrimary,
      flex: 1,
      marginRight: 8,
    },
    ptsDesc: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    ptsDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 14,
    },
    ptsSubtitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: 10,
    },
    ptsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    },
    ptsIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    ptsRowText: {
      flex: 1,
    },
    ptsRowTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    ptsRowDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 1,
    },
    ptsBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: "center",
      marginTop: 4,
    },
    ptsBtnText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.surface,
    },

    detailHelpRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    detailHelpIcon: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primary + "0C",
      alignItems: "center",
      justifyContent: "center",
    },
    detailHelpText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
    },

    potProgressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    potProgressText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    potProgressBar: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: "hidden",
    },
    potProgressFill: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    contributionAddBtnWrap: {
      borderRadius: 17,
    },
    contributionAddBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },

    incompleteBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginHorizontal: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.error + "40",
      backgroundColor: colors.error + "15",
    },
    incompleteBannerText: {
      flex: 1,
      fontSize: 11,
      fontWeight: "600",
      color: colors.error,
    },

    stepInfoNotesWrap: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    stepInfoNotesLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
      marginBottom: 4,
    },
    stepInfoNotesEmpty: {
      fontSize: 12,
      color: colors.textSecondary,
      fontStyle: "italic",
    },
    linkedNoteRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
    },
    linkedNoteText: {
      flex: 1,
      fontSize: 13,
      color: colors.textPrimary,
    },
    addLinkedNoteBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 6,
    },
    addLinkedNoteText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: "500",
    },

    noteViewerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      padding: 24,
    },
    noteViewerCard: {
      backgroundColor: colors.background,
      borderRadius: 16,
      maxHeight: "70%",
      borderWidth: 1,
      borderColor: colors.border,
    },
    noteViewerHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    noteViewerTitle: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
      flex: 1,
      marginRight: 12,
    },
    noteViewerBody: {
      padding: 16,
    },
    noteViewerContent: {
      fontSize: 15,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    noteViewerDate: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 16,
      textAlign: "right",
    },
  });
}
