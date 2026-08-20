import React, { useMemo, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AppText from "./AppText";
import { useTheme } from "../../lib/theme";

export const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type CalendarPickerProps = {
  selected: Date;
  onSelect: (d: Date) => void;
  // Cuando es false no permite navegar ni elegir días futuros (vista de
  // balances). En metas se deja true para fechas límite futuras.
  allowFuture?: boolean;
  // Fecha mínima seleccionable: los días anteriores quedan deshabilitados.
  // Usado en metas de ahorro, donde la fecha límite no puede caer en la
  // misma semana/mes en curso.
  minDate?: Date;
};

// Calendario mensual para elegir un día. Con allowFuture=false no permite
// seleccionar fechas futuras (comportamiento original de balances).
export function CalendarPicker({ selected, onSelect, allowFuture = false, minDate }: CalendarPickerProps) {
  const colors = useTheme();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // La vista inicial se ancla en la fecha ya elegida si es válida, y si no
  // (o es anterior al mínimo) en la primera fecha seleccionable: así nunca
  // se abre en un mes donde todo el rango está deshabilitado.
  const initialAnchor = useMemo(() => {
    const sel = new Date(selected);
    sel.setHours(0, 0, 0, 0);
    if (minDate) {
      const min = new Date(minDate);
      min.setHours(0, 0, 0, 0);
      if (sel >= min) return sel;
      return min;
    }
    return sel;
  }, [selected, minDate]);
  const [viewYear, setViewYear] = useState(initialAnchor.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialAnchor.getMonth());
  const min = useMemo(() => {
    if (!minDate) return null;
    const d = new Date(minDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [minDate]);

  const DOW = ["L", "M", "X", "J", "V", "S", "D"];
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  // getDay() devuelve 0=Dom, 1=Lun... Para que el calendario arranque
  // en lunes, se transforma con (firstDow + 6) % 7: domingo (0) → 6,
  // lunes (1) → 0, etc. Los null del inicio son celdas vacias antes del dia 1.
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const offset = (firstDow + 6) % 7;

  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  function isFuture(day: number): boolean {
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    return d > today;
  }
  // Un día queda deshabilitado si es anterior a la fecha mínima (minDate).
  function isBeforeMin(day: number): boolean {
    if (!min) return false;
    const d = new Date(viewYear, viewMonth, day);
    d.setHours(0, 0, 0, 0);
    return d < min;
  }
  const isDisabled = (day: number): boolean =>
    (!allowFuture && isFuture(day)) || isBeforeMin(day);
  function isSelected(day: number): boolean {
    return (
      selected.getFullYear() === viewYear &&
      selected.getMonth() === viewMonth &&
      selected.getDate() === day
    );
  }
  function isToday(day: number): boolean {
    return (
      today.getFullYear() === viewYear &&
      today.getMonth() === viewMonth &&
      today.getDate() === day
    );
  }
  function prevCal() {
    // No dejar navegar a meses anteriores al mínimo: quedarían enteros
    // deshabilitados (minDate) o futuros bloqueados (allowFuture=false).
    if (min && viewYear <= min.getFullYear() && viewMonth <= min.getMonth()) return;
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextCal() {
    if (!allowFuture && viewYear === today.getFullYear() && viewMonth === today.getMonth()) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }
  function selectDay(day: number) {
    if (isDisabled(day)) return;
    onSelect(new Date(viewYear, viewMonth, day, 12, 0, 0));
  }

  const canGoNext = allowFuture || !(viewYear === today.getFullYear() && viewMonth === today.getMonth());

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginTop: 8, backgroundColor: colors.background }}>
      {/* Cabecera mes/año */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <TouchableOpacity onPress={prevCal} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <AppText style={{ fontSize: 14, fontWeight: "600", color: colors.textPrimary }}>
          {MONTHS_ES[viewMonth]} {viewYear}
        </AppText>
        <TouchableOpacity onPress={nextCal} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }} disabled={!canGoNext}>
          <Ionicons name="chevron-forward" size={18} color={canGoNext ? colors.textPrimary : colors.border} />
        </TouchableOpacity>
      </View>

      {/* Días de la semana */}
      <View style={{ flexDirection: "row", marginBottom: 2 }}>
        {DOW.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center", paddingBottom: 4 }}>
            <AppText disableHorizontalPadding style={{ fontSize: 11, fontWeight: "600", color: colors.textSecondary }}>
              {d}
            </AppText>
          </View>
        ))}
      </View>

      {/* Grilla de días */}
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row" }}>
          {row.map((day, ci) =>
            day ? (
              <TouchableOpacity
                key={ci}
                activeOpacity={0.7}
                disabled={isDisabled(day)}
                onPress={() => selectDay(day)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: isSelected(day) ? colors.primary : "transparent",
                  opacity: isDisabled(day) ? 0.4 : 1,
                }}
              >
                <AppText
                  disableHorizontalPadding
                  style={{
                    fontSize: 13,
                    fontWeight: isToday(day) && !isSelected(day) ? "700" : "400",
                    color: isSelected(day)
                      ? colors.surface
                      : isDisabled(day)
                      ? colors.border
                      : isToday(day)
                      ? colors.primary
                      : colors.textPrimary,
                  }}
                >
                  {day}
                </AppText>
              </TouchableOpacity>
            ) : (
              <View key={ci} style={{ flex: 1 }} />
            )
          )}
        </View>
      ))}
    </View>
  );
}