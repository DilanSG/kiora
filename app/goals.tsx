import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Modal,
  ScrollView,
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

// Pantalla de Metas: tarjetas mínimas con mapa mental tipo canvas al tocar cada tarjeta.
export default function GoalsScreen() {
  const colors = useTheme();
  const styles = getStyles(colors);

  const {
    goals,
    userPoints,
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
  const [ptsModalVisible, setPtsModalVisible] = useState(false);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(`${date}T00:00:00`).getTime())) {
      showAlert("Atención", "Indica la fecha límite de la alcancía (YYYY-MM-DD).");
      return;
    }
    try {
      let created: Goal | null;
      if (potMode === "free") {
        created = await createGoal(title, potDesc.trim() || undefined, date, "pot", undefined, undefined, totalAmount);
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
      // Mismo esquema que la alcancía: fecha límite y, si es por periodos,
      // el número de aportes se deriva de la frecuencia y la fecha.
      const date = objetoLimitDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(`${date}T00:00:00`).getTime())) {
        showAlert("Atención", "Indica la fecha para tenerlo ahorrado.");
        return;
      }
      try {
        const created =
          objetoMode === "free"
            ? await createGoal(title, undefined, date, "savings", undefined, undefined, total)
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
          `"${goal.title}" completada · +50 puntos`,
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
        <TouchableOpacity onPress={() => setPtsModalVisible(true)} activeOpacity={0.7}>
          <View style={styles.pointsBadge}>
            <Ionicons name="star" size={13} color={colors.warning} />
            <AppText style={styles.pointsText}>{userPoints} pts</AppText>
          </View>
        </TouchableOpacity>
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
                  <DateField
                    label="Fecha para tenerlo ahorrado"
                    date={objetoLimitDate}
                    onChange={setObjetoLimitDate}
                  />
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
                    <AppText style={[styles.label, { color: colors.textSecondary }]}>
                      Añadirás aportes cuando quieras hasta alcanzar el valor del objeto.
                    </AppText>
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
                    <View style={{ paddingVertical: 8 }}>
                      <AppText style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}>
                        Pago por fecha:{" "}
                        <AppText style={{ fontWeight: "700", color: colors.textPrimary }}>
                          {formatCurrency((parseAmountInput(objetoTotal) ?? 0) / parseInt(objetoInstallments))}
                        </AppText>
                      </AppText>
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

              <DateField
                label="Fecha para tenerlo ahorrado"
                date={potDate}
                onChange={setPotDate}
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
                <AppText style={[styles.label, { color: colors.textSecondary }]}>
                  Añadirás aportes cuando quieras hasta alcanzar el monto deseado.
                </AppText>
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

      {/* Modal: explicación de puntos */}
      <Modal visible={ptsModalVisible} transparent animationType="fade" onRequestClose={() => setPtsModalVisible(false)}>
        <View style={styles.ptsOverlay}>
          <GlowView style={styles.ptsCard} cardRadius={12}>
            <View style={styles.ptsHeader}>
              <AppText style={styles.ptsTitle}>¿Qué son los puntos?</AppText>
              <TouchableOpacity onPress={() => setPtsModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <AppText style={styles.ptsDesc}>
              Los puntos son una recompensa por completar metas. Se pueden usar en la tienda de temas
              para personalizar la apariencia de la app.
            </AppText>

            <View style={styles.ptsDivider} />

            <AppText style={styles.ptsSubtitle}>Cómo ganar puntos</AppText>

            <View style={styles.ptsRow}>
              <View style={[styles.ptsIconWrap, { backgroundColor: colors.primary + "18" }]}>
                <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
              </View>
              <View style={styles.ptsRowText}>
                <AppText style={styles.ptsRowTitle}>Completar un paso</AppText>
                <AppText style={styles.ptsRowDesc}>+5 puntos por cada paso completado</AppText>
              </View>
            </View>

            <View style={styles.ptsRow}>
              <View style={[styles.ptsIconWrap, { backgroundColor: colors.success + "18" }]}>
                <Ionicons name="trophy-outline" size={18} color={colors.success} />
              </View>
              <View style={styles.ptsRowText}>
                <AppText style={styles.ptsRowTitle}>Completar una meta</AppText>
                <AppText style={styles.ptsRowDesc}>+50 puntos al finalizar la meta completa</AppText>
              </View>
            </View>

            <View style={styles.ptsDivider} />

            <AppText style={styles.ptsSubtitle}>Cómo gastar puntos</AppText>

            <View style={styles.ptsRow}>
              <View style={[styles.ptsIconWrap, { backgroundColor: colors.warning + "18" }]}>
                <Ionicons name="color-palette-outline" size={18} color={colors.warning} />
              </View>
              <View style={styles.ptsRowText}>
                <AppText style={styles.ptsRowTitle}>Tienda de temas</AppText>
                <AppText style={styles.ptsRowDesc}>Canjea 100 puntos por un tema nuevo en Ajustes → Personalización</AppText>
              </View>
            </View>

            <TouchableOpacity style={styles.ptsBtn} onPress={() => setPtsModalVisible(false)}>
              <AppText style={styles.ptsBtnText}>Entendido</AppText>
            </TouchableOpacity>
          </GlowView>
        </View>
      </Modal>
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
  const styles = getStyles(colors);
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
  const isSavings = liveGoal.type === "savings";
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

  // Modal de aporte (alcancía libre)
  const [contributionVisible, setContributionVisible] = useState(false);
  const [contributionAmount, setContributionAmount] = useState("");

  const createdLabel = useMemo(
    () => formatLongDate(liveGoal.createdAt),
    [liveGoal.createdAt]
  );

  // Tutorial de uso tipo coach-marks: spotlight sobre cada parte del detalle.
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [tutorialReady, setTutorialReady] = useState(false);
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
    if (rect) {
      setTutorialReady(true);
    } else {
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
      setTutorialReady(true);
    },
    [storeTutorialRect]
  );

  const tutorialRectForKey = useCallback(
    (key: string): Rect | null => tutorialRects[key] ?? null,
    [tutorialRects]
  );

  const tutorialSteps = useMemo(() => {
    if (isPot || isFreeSavings) {
      if (potFree) {
        return [
          {
            key: "goal",
            title: "Tu meta",
            body: "Es el monto que se desea acumular. Al alcanzarlo, la meta se completará automáticamente.",
          },
          {
            key: "savings",
            title: "Tus aportes",
            body: "Cada pill representa un aporte realizado. Se resta del monto deseado y se muestra cuánto falta.",
          },
          {
            key: "add",
            title: "Añadir aporte",
            body: "El botón + de la barra superior registra cada aporte de ahorro.",
          },
          {
            key: "start",
            title: "El inicio",
            body: "La fecha en que comenzó el ahorro.",
          },
          {
            key: "close",
            title: "Cerrar",
            body: "La flecha cierra el detalle y vuelve a la lista de metas.",
          },
        ];
      }
      return [
        {
          key: "savings",
          title: "Tus aportes",
          body: "Cada pill representa el aporte de un periodo. Al tocarla se puede marcar como aportada o editar su monto.",
        },
        {
          key: "goal",
          title: "Tu meta",
          body: "Al cubrir todos los periodos, la meta se completará automáticamente.",
        },
        {
          key: "start",
          title: "El inicio",
          body: "Indica la fecha en que comenzó la alcancía.",
        },
        {
          key: "close",
          title: "Cerrar",
          body: "La flecha cierra el detalle y vuelve a la lista de metas.",
        },
      ];
    }
    if (isSavings) {
      return [
        {
          key: "savings",
          title: "Las cuotas",
          body: "Al tocar una cuota se muestran su monto y su fecha, y desde allí se puede marcar como pagada o editar.",
        },
        {
          key: "goal",
          title: "Tu meta",
          body: "Al completar todas las cuotas, la meta se completará automáticamente.",
        },
        {
          key: "start",
          title: "El inicio",
          body: "Indica la fecha en que comenzó el plan de ahorro.",
        },
        {
          key: "close",
          title: "Cerrar",
          body: "La flecha cierra el detalle y vuelve a la lista de metas.",
        },
      ];
    }
    return [
      {
        key: "goal",
        title: "Tu meta",
        body: "Es la meta que se está construyendo. Al completar todos los pasos, se toca para finalizarla.",
      },
      {
        key: "step",
        title: "Los pasos",
        body: "Tocar un paso permite marcarlo como completado (se solicita confirmación). Mantenerlo presionado permite ver o agregar una nota, exportarlo a Tareas o eliminarlo.",
      },
      {
        key: "add",
        title: "Añadir pasos",
        body: "Los botones + del mapa permiten añadir pasos intermedios entre el inicio y la meta.",
      },
      {
        key: "start",
        title: "El inicio",
        body: "Es el punto de partida del plan. Los primeros pasos aparecen cerca de aquí.",
      },
      {
        key: "close",
        title: "Cerrar",
        body: "La flecha cierra el detalle y vuelve a la lista de metas.",
      },
    ];
  }, [isSavings, isPot, isFreeSavings, potFree]);

  const openTutorial = () => {
    setTutorialIndex(0);
    setTutorialVisible(true);
  };

  // Cada paso del tutorial pide al canvas que centre y mida su pill. El
  // spotlight recién se muestra cuando esa medición llega (tutorialReady).
  // El botón de cerrar no es una pill: lo resuelve aquí con su rect propio.
  React.useEffect(() => {
    if (!tutorialVisible) return;
    const step = tutorialSteps[tutorialIndex];
    if (!step) {
      setTutorialVisible(false);
      return;
    }
    setTutorialReady(false);
    if (step.key === "close") {
      // WindowBox ya re-mide el botón (measureRequest); solo hay que esperar
      // su rect y mostrar el paso.
      let cancelled = false;
      let tries = 0;
      const tick = () => {
        if (cancelled) return;
        if (tutorialRectsRef.current.close) {
          setTutorialReady(true);
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
      // Las metas de ahorro se finalizan solas al terminar todo el ahorro:
      // aquí solo se informa, no se abre confirmación de finalización.
      triggerNotification("Termina todo el ahorro para completar la meta", "info");
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
      triggerNotification("Pago registrado · +5 puntos", "success");
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
      triggerNotification("Aporte añadido · +5 puntos", "success");
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
                triggerNotification("Este periodo venció: su aporte ya se repartió entre los restantes.", "info");
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
                    triggerNotification(isPot ? "Aporte registrado · +5 puntos" : "Pago registrado · +5 puntos", "success");
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
            colors={colors}
            styles={styles}
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
                      triggerNotification("Pago registrado · +5 puntos", "success");
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
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: colors.border, borderBottomWidth: 0, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === "ios" ? 40 : 24 }}>
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
        visible={tutorialVisible && tutorialReady}
        index={tutorialIndex}
        steps={tutorialSteps}
        rectForKey={tutorialRectForKey}
        onAdvance={() => setTutorialIndex((i) => Math.min(i + 1, tutorialSteps.length - 1))}
        onFinish={() => setTutorialVisible(false)}
      />
    </Modal>
  );
}

// ─── Fondo con gradiente y manchas ───────────────────────────────────────────

function DetailBackground({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, overflow: "hidden" }]} pointerEvents="none">
      {/* Diamante grande arriba a la derecha */}
      <View
        style={{
          position: "absolute",
          top: -60,
          right: -40,
          width: 180,
          height: 180,
          backgroundColor: colors.primary,
          opacity: 0.08,
          transform: [{ rotate: "45deg" }],
        }}
      />
      {/* Círculo con borde abajo a la izquierda */}
      <View
        style={{
          position: "absolute",
          bottom: -50,
          left: -50,
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 3,
          borderColor: colors.accentBlue,
          opacity: 0.12,
        }}
      />
      {/* Triángulo esquinado arriba a la izquierda */}
      <View
        style={{
          position: "absolute",
          top: 80,
          left: -30,
          width: 0,
          height: 0,
          borderLeftWidth: 80,
          borderRightWidth: 80,
          borderBottomWidth: 140,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: colors.success,
          opacity: 0.07,
          transform: [{ rotate: "-15deg" }],
        }}
      />
      {/* Círculo pequeño a la derecha */}
      <View
        style={{
          position: "absolute",
          bottom: 160,
          right: 30,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.warning,
          opacity: 0.1,
      }}
      />
      {/* Hexágono simulado abajo */}
      <View
        style={{
          position: "absolute",
          bottom: 40,
          right: "35%",
          width: 100,
          height: 100,
          borderRadius: 16,
          backgroundColor: colors.error,
          opacity: 0.06,
          transform: [{ rotate: "30deg" }],
        }}
      />
      {/* Anillos concéntricos en el centro-izquierda */}
      <View
        style={{
          position: "absolute",
          top: 280,
          left: 50,
          width: 80,
          height: 80,
          borderRadius: 40,
          borderWidth: 2,
          borderColor: colors.primary,
          opacity: 0.09,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 288,
          left: 58,
          width: 64,
          height: 64,
          borderRadius: 32,
          borderWidth: 1.5,
          borderColor: colors.primary,
          opacity: 0.06,
        }}
      />
      {/* Rombo pequeño centrado-derecha */}
      <View
        style={{
          position: "absolute",
          top: 440,
          left: 240,
          width: 50,
          height: 50,
          backgroundColor: colors.accentBlue,
          opacity: 0.07,
          transform: [{ rotate: "15deg" }],
        }}
      />
      {/* Línea decorativa en el centro */}
      <View
        style={{
          position: "absolute",
          top: 180,
          left: 290,
          width: 2,
          height: 120,
          borderRadius: 1,
          backgroundColor: colors.success,
          opacity: 0.08,
          transform: [{ rotate: "25deg" }],
        }}
      />
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
  colors: ThemeColors;
  styles: ReturnType<typeof getStyles>;
  savings?: SavingsConfig;
  pot?: PotCanvasConfig;
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
    colors,
    styles,
    savings,
    pot,
  } = props;

  const [size, setSize] = useState({ w: 0, h: 0 });
  const scrollRef = React.useRef<ScrollView>(null);
  // Marco del canvas en ventana: se mide junto con las pills para derivar
  // su posición dentro del contenido (el ScrollView no expone measureInWindow).
  const canvasRef = React.useRef<View>(null);

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
  }, [tutorialTargetKey, size.h, contentHeight, onTutorialTargetResolved]);

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

  const connectors = useMemo(() => buildConnectors(nodes, colors), [nodes, colors]);
  // El "+" de añadir aporte ya no vive en el canvas: para ahorro/alcancía
  // está en la barra superior del detalle y los aportes son las propias pills.
  const addButtons = useMemo(
    () => (isPot || isSavings) ? [] : buildAddButtons(nodes),
    [isPot, isSavings, nodes]
  );

  // Calcular fecha de cada pago según intervalo (ahorro o alcancía por periodos)
  const schedule = savings ?? (isPot && !potFree ? pot : undefined);
  const getPaymentDate = useCallback((index: number): string => {
    if (!schedule) return "";
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
  const topY = 36;
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
  const topY = 36;
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
  const topY = 36;
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

function buildConnectors(nodes: PlacedNode[], colors: ThemeColors): Connector[] {
  const out: Connector[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const nextStep = b.kind === "step" ? b.step : undefined;
    const isCompletedFlow = nextStep?.completed ?? (b.kind === "savings" ? b.completed : false);
    out.push({
      d: getCurvePath(a, b, i),
      color: isCompletedFlow ? colors.success : colors.textSecondary,
      // El primer trazo sale de la meta: ligeramente más suave para dar
      // jerarquía visual. El resto va a 0.55.
      opacity: a.kind === "goal" ? 0.5 : 0.55,
    });
  }
  return out;
}

type AddButton = { id: string; x: number; y: number; afterNodeIndex: number };

function buildAddButtons(nodes: PlacedNode[]): AddButton[] {
  const out: AddButton[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const mid = midpoint(a, b, i);
    out.push({
      id: `add-${i}`,
      x: mid.x,
      y: mid.y,
      afterNodeIndex: i,
    });
  }
  return out;
}

// Calcula el punto medio de la curva Bezier entre dos nodos, usado para
// posicionar los botones "+" en los gaps. Usa la formula del centroide
// de una curva cubica en t=0.5: (P0 + 3*P1 + 3*P2 + P3) / 8.
function midpoint(a: PlacedNode, b: PlacedNode, idx: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const cp = curveCP(a, dx, dy, len, idx);
  const mx = (a.x + 3 * cp.cpx1 + 3 * cp.cpx2 + b.x) / 8;
  const my = (a.y + 3 * cp.cpy1 + 3 * cp.cpy2 + b.y) / 8;
  return { x: mx, y: my };
}

function getCurvePath(a: PlacedNode, b: PlacedNode, idx: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const cp = curveCP(a, dx, dy, len, idx);
  return `M ${a.x} ${a.y} C ${cp.cpx1} ${cp.cpy1} ${cp.cpx2} ${cp.cpy2} ${b.x} ${b.y}`;
}

// Calcula puntos de control para curvas cubicas Bezier con curvatura
// perpendicular alternante (el signo de idx%2 inverte la direccion).
// Esto crea un flujo organico tipo mapa mental donde las curvas se
// abren hacia izquierda o derecha alternadamente, evitando que se
// superpongan visualmente. El parametro idx determina el sentido
// de la curvatura para cada par de nodos consecutivos.
function curveCP(
  a: PlacedNode, dx: number, dy: number, len: number, idx: number
) {
  const scale = Math.min(48, len * 0.16) * (idx % 2 === 0 ? 1 : -1);
  const perpX = -dy / len * scale;
  const perpY = dx / len * scale;
  return {
    cpx1: a.x + dx * 0.3 + perpX,
    cpy1: a.y + dy * 0.3 + perpY,
    cpx2: a.x + dx * 0.7 + perpX,
    cpy2: a.y + dy * 0.7 + perpY,
  };
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
  children,
}: {
  x: number;
  y: number;
  registerRef?: (node: View | null) => void;
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
              ? "Se completa al terminar todo el ahorro"
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
  const styles = getStyles(colors);

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
  const styles = getStyles(colors);

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
function DateField({ label, date, onChange }: { label: string; date: string; onChange: (d: string) => void }) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const [open, setOpen] = useState(false);
  const selected = date ? new Date(`${date}T12:00:00`) : new Date();

  return (
    <>
      <AppText style={styles.label}>{label}</AppText>
      <TouchableOpacity
        style={styles.dateFieldBtn}
        activeOpacity={0.7}
        onPress={() => setOpen((o) => !o)}
      >
        <Ionicons name="calendar-outline" size={16} color={colors.primary} />
        <AppText style={date ? styles.dateFieldText : styles.dateFieldPlaceholder}>
          {date
            ? new Date(`${date}T12:00:00`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })
            : "Poner fecha"}
        </AppText>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
      </TouchableOpacity>
      {open && (
        <CalendarPicker
          selected={selected}
          onSelect={(d) => {
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            onChange(iso);
            setOpen(false);
          }}
          allowFuture
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
}: {
  visible: boolean;
  index: number;
  steps: TutorialStepData[];
  rectForKey: (key: string) => Rect | null;
  onAdvance: () => void;
  onFinish: () => void;
}) {
  const colors = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const styles = getTutorialStyles(colors);
  const [cardH, setCardH] = useState(0);

  // El padre ya salta los pasos que no tienen elemento; aquí solo se toma el
  // paso indicado. Si el rect aún no llegó (el canvas está midiendo) se espera
  // sin cerrar: cerrar aquí rompería el avance entre pasos consecutivos.
  const step = visible ? steps[index] : undefined;
  const rect = step ? rectForKey(step.key) : null;

  // Red de seguridad: solo cierra si el índice quedó fuera del rango de pasos.
  React.useEffect(() => {
    if (visible && !step) onFinish();
  }, [visible, step, onFinish]);

  if (!visible || !step || !rect) return null;

  const isLast = index === steps.length - 1;
  const dim = "rgba(0,0,0,0.6)";
  const { x, y, w, h } = rect;
  const holes: ViewStyle[] = [
    // Arriba del objetivo
    { left: 0, top: 0, width: screenW, height: Math.max(0, y) },
    // Abajo del objetivo
    { left: 0, top: y + h, width: screenW, height: Math.max(0, screenH - y - h) },
    // Izquierda
    { left: 0, top: y, width: Math.max(0, x), height: h },
    // Derecha
    { left: x + w, top: y, width: Math.max(0, screenW - x - w), height: h },
  ];

  // La tarjeta se coloca en el lado con más espacio libre (arriba o abajo del
  // spotlight) para no taparlo ni quedar cortada por los bordes de pantalla.
  const GAP = 16;
  const cardHeight = cardH > 0 ? cardH : 200;
  const spaceBelow = screenH - (y + h) - GAP;
  const spaceAbove = y - GAP;
  const placeOnBottom = spaceBelow >= spaceAbove;
  const cardTop = clamp(
    placeOnBottom ? y + h + GAP : y - GAP - cardHeight,
    GAP,
    Math.max(GAP, screenH - cardHeight - GAP)
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      {holes.map((hole, i) => (
        <View key={i} style={[StyleSheet.absoluteFill, { backgroundColor: dim }, hole]} pointerEvents="none" />
      ))}
      {/* Marco de resaltado alrededor del objetivo */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: x - 4,
          top: y - 4,
          width: w + 8,
          height: h + 8,
          borderWidth: 2,
          borderColor: colors.surface,
          borderRadius: 16,
        }}
      />
      {/* Capturador de toques: avanzar al tocar cualquier parte */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onAdvance}
      />

      {/* Tarjeta explicativa: se ubica abajo o arriba según el espacio libre */}
      <View
        style={[styles.card, { position: "absolute", left: 16, right: 16, top: cardTop }]}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          if (height !== cardH) setCardH(height);
        }}
      >
        <AppText style={styles.progress} disableHorizontalPadding>
          Paso {index + 1} de {steps.length}
        </AppText>
        <AppText style={styles.title} disableHorizontalPadding>
          {step.title}
        </AppText>
        <AppText style={styles.body} disableHorizontalPadding>
          {step.body}
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
          <AppText style={styles.confirmReward}>+50 puntos</AppText>
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
  const styles = getStyles(colors);

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

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
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
    pointsBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    pointsText: {
      fontSize: 13,
      fontWeight: "600",
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
      bottom: 28,
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
      bottom: 20,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },

    // Modal crear
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
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
      fontSize: 17,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    modalScroll: {
      padding: 16,
      gap: 8,
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

    // Campo de fecha (abre el calendario al tocar)
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

    // Grid 1x3 del selector de tipo de meta
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

    // ─── Detalle / canvas ───
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

    // Pills
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

    // ─── Card flotante info paso ───
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
      backgroundColor: colors.surface + "F2",
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

    // ─── Modal crear paso ───
    stepModalView: {
      backgroundColor: colors.surface,
      margin: 24,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
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

    // ─── Modal confirmación / felicitación ───
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
      backgroundColor: colors.surface,
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

    // ─── Dashboard meta completada ───
    dashboardContent: {
      padding: 24,
      paddingTop: Platform.OS === "ios" ? 58 : 44,
      paddingBottom: 48,
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

    // Modal de puntos
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
      backgroundColor: colors.surface,
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

    // Guía de uso (GoalDetailModal)
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

    // Progreso de la alcancía en el detalle
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

    // Aviso de meta vencida (fecha límite pasada sin lograr el monto)
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

    // Notas vinculadas a paso (StepInfoCard)
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

    // Note viewer modal
    noteViewerOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "center",
      padding: 24,
    },
    noteViewerCard: {
      backgroundColor: colors.surface,
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
