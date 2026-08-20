import React from "react";
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Transaction, RecurringInterval } from "../../../lib/storage/types";
import { useTheme, ThemeColors } from "../../../lib/theme";
import AppText from "../../ui/AppText";
import { formatCurrency } from "../../../lib/currency";

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  weekly: "cada semana",
  monthly: "cada mes",
  yearly: "cada año",
};

type Props = {
  item: Transaction;
  // Nombre e intervalo del recurrente padre (si el movimiento lo originó).
  recurringLabel?: string;
  recurringInterval?: RecurringInterval;
  onClose: () => void;
  onEdit: (item: Transaction) => void;
  onDelete: (id: string) => void;
};

// Formatea fecha ISO completa: "Jueves, 20 de agosto de 2026 · 14:30".
function formatFullDate(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${datePart} · ${h}:${m}`;
}

export default function TransactionDetailModal({
  item,
  recurringLabel,
  recurringInterval,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const isIncome = item.type === "income";
  const tint = isIncome
    ? colors.chartPositive || colors.success
    : colors.chartNegative || colors.error;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <AppText style={styles.headerTitle} disableHorizontalPadding>
              Detalle del movimiento
            </AppText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body}>
            <View style={styles.hero}>
              <View style={[styles.heroIcon, { borderColor: tint + "40", backgroundColor: tint + "12" }]}>
                <Ionicons
                  name={isIncome ? "arrow-up-circle-outline" : "arrow-down-circle-outline"}
                  size={34}
                  color={tint}
                />
              </View>
              <View style={styles.heroInfo}>
                <AppText style={[styles.heroKind, { color: tint }]} disableHorizontalPadding>
                  {isIncome ? "Ingreso" : "Gasto"}
                </AppText>
                <AppText style={[styles.heroAmount, { color: tint }]} disableHorizontalPadding>
                  {isIncome ? "+" : "-"}{formatCurrency(item.amount)}
                </AppText>
              </View>
            </View>

            {item.description ? (
              <View style={styles.section}>
                <View style={styles.row}>
                  <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
                  <AppText style={styles.rowText} disableHorizontalPadding>
                    {item.description}
                  </AppText>
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.row}>
                <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
                <AppText style={styles.rowText} disableHorizontalPadding>
                  {item.category}
                </AppText>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.row}>
                <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
                <AppText style={styles.rowText} disableHorizontalPadding>
                  {formatFullDate(item.date)}
                </AppText>
              </View>
            </View>

            {item.recurringId ? (
              <View style={styles.section}>
                <View style={styles.row}>
                  <Ionicons name="repeat" size={18} color={colors.primary} />
                  <AppText style={styles.rowText} disableHorizontalPadding>
                    {recurringLabel
                      ? `Generado por "${recurringLabel}"${recurringInterval ? ` (${INTERVAL_LABELS[recurringInterval]})` : ""}`
                      : "Movimiento recurrente automatizado"}
                  </AppText>
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                onPress={() => onEdit(item)}
                activeOpacity={0.7}
              >
                <AppText style={styles.actionText} disableHorizontalPadding>
                  Editar
                </AppText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={() => onDelete(item.id)}
                activeOpacity={0.7}
              >
                <AppText style={[styles.actionText, { color: colors.error }]} disableHorizontalPadding>
                  Eliminar
                </AppText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      maxHeight: "80%",
      backgroundColor: colors.background,
      borderRadius: 20,
      paddingTop: 20,
      paddingHorizontal: 20,
      paddingBottom: Platform.OS === "ios" ? 24 : 20,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      fontSize: 20,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    body: {
      flexGrow: 0,
    },
    hero: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginBottom: 16,
    },
    heroIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 1,
    },
    heroInfo: {
      flex: 1,
      gap: 2,
    },
    heroKind: {
      fontSize: 13,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    heroAmount: {
      fontSize: 26,
      fontWeight: "700",
    },
    section: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: 12,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    rowText: {
      flex: 1,
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 20,
    },
    actions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 20,
    },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 10,
      paddingVertical: 12,
    },
    deleteBtn: {
      borderWidth: 1,
      borderColor: colors.error + "40",
      backgroundColor: colors.error + "0D",
    },
    actionText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.surface,
    },
  });