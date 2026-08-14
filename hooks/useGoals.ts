import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { Goal, GoalType } from "../lib/storage/types";
import {
  getGoals,
  addGoal,
  addGoalStep,
  deleteGoalStep,
  toggleGoalStep,
  completeGoal,
  deleteGoal as storageDeleteGoal,
  getUserPoints,
  reorderGoals as storageReorderGoals,
  updateGoal as storageUpdateGoal,
  markInstallment as storageMarkInstallment,
  markInstallmentById as storageMarkInstallmentById,
  updateGoalInstallment as storageUpdateGoalInstallment,
  addPotContribution as storageAddPotContribution,
  redistributeMissedInstallments as storageRedistributeMissedInstallments,
} from "../lib/storage";

// Hook para manejar el estado y la lógica de negocio de las Metas.
// Incluye el sistema de puntos del usuario. Retorna estado y funciones de interacción de Metas.
export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [userPoints, setUserPoints] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [data, pts] = await Promise.all([getGoals(), getUserPoints()]);
      setGoals(data);
      setUserPoints(pts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar las metas.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGoals();
    }, [loadGoals])
  );

  const createGoal = async (
    title: string,
    description?: string,
    targetDate?: string,
    goalType?: GoalType,
    installments?: number,
    interval?: "weekly" | "monthly",
    totalAmount?: number
  ): Promise<Goal | null> => {
    await addGoal(title, description, targetDate, goalType, installments, interval, totalAmount);
    const data = await getGoals();
    setGoals(data);
    // La meta recién creada es la de created_at más reciente; se devuelve
    // para poder abrir su detalle al instante (p. ej. con el tutorial).
    const created = [...data].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return created ?? null;
  };

  // Agrega un paso intermedio a una meta en la posición indicada.
  const addStepToGoal = async (
    goalId: string,
    title: string,
    insertAfterIndex: number,
    description?: string
  ) => {
    await addGoalStep(goalId, title, insertAfterIndex, description);
    await loadGoals();
  };

  // Elimina un paso de una meta.
  const removeStep = async (stepId: string, goalId: string) => {
    await deleteGoalStep(stepId, goalId);
    await loadGoals();
  };

  // Alterna el estado de un paso. Otorga 5 pts en la primera compleción.
  const toggleStep = async (stepId: string, goalId: string) => {
    try {
      setError(null);
      await toggleGoalStep(stepId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transición de paso inválida.");
      throw err;
    }
  };

  // Finaliza una meta. Devuelve `true` si la transición fue efectiva
  // (es decir, la meta pasó de activa a completada y se otorgaron 50 pts).
  const finalizeGoal = async (goalId: string): Promise<boolean> => {
    try {
      setError(null);
      const transitioned = await completeGoal(goalId);
      await loadGoals();
      return transitioned;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo completar la meta.");
      throw err;
    }
  };

  // Marca un pago como completado en una meta de ahorro.
  const markInstallment = async (goalId: string) => {
    try {
      setError(null);
      await storageMarkInstallment(goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo marcar el pago.");
      throw err;
    }
  };

  const updateInstallment = async (
    installmentId: string,
    updates: { amount?: number; dueDate?: string }
  ) => {
    await storageUpdateGoalInstallment(installmentId, updates);
    await loadGoals();
  };

  const markInstallmentById = async (installmentId: string, goalId: string) => {
    try {
      await storageMarkInstallmentById(installmentId, goalId);
      await loadGoals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo marcar el pago.");
      throw err;
    }
  };

  // Añade un aporte a una alcancía libre (modo "cuando tenga").
  const addPotContribution = async (goalId: string, amount: number) => {
    try {
      await storageAddPotContribution(goalId, amount);
      await loadGoals();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo añadir el aporte.");
      throw err;
    }
  };

  // Reparte los aportes de periodos vencidos sin pagar. Retorna true si hubo
  // al menos un periodo repartido (para notificar al usuario).
  const redistributeMissedInstallments = async (goalId: string): Promise<boolean> => {
    const changed = await storageRedistributeMissedInstallments(goalId);
    if (changed) await loadGoals();
    return changed;
  };

  // Reordena las metas. `orderedIds` debe contener todos los IDs en el nuevo orden.
  const reorderGoals = async (orderedIds: string[]) => {
    await storageReorderGoals(orderedIds);
    await loadGoals();
  };

  // Elimina una meta y todos sus pasos.
  const deleteGoalId = async (goalId: string) => {
    await storageDeleteGoal(goalId);
    await loadGoals();
  };

  // Actualiza el título y/o descripción de una meta.
  const updateGoal = async (id: string, updates: { title?: string; description?: string }) => {
    await storageUpdateGoal(id, updates);
    await loadGoals();
  };

  return {
    goals,
    userPoints,
    isLoading,
    error,
    setError,
    loadGoals,
    createGoal,
    addStepToGoal,
    removeStep,
    toggleStep,
    finalizeGoal,
    markInstallment,
    markInstallmentById,
    deleteGoalId,
    reorderGoals,
    updateGoal,
    updateInstallment,
    addPotContribution,
    redistributeMissedInstallments,
  };
}
