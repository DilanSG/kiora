import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WishItem } from "../../../lib/storage/types";
import { useTheme, ThemeColors } from "../../../lib/theme";
import AppText from "../../ui/AppText";
import { formatCurrency } from "../../../lib/currency";

function resolveCategoryPresentation(rawCategory: string): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  const normalized = rawCategory.trim().toLowerCase();
  if (normalized.startsWith("obj")) return { label: "Objeto", icon: "cube-outline" };
  if (normalized.startsWith("conc")) return { label: "Concierto", icon: "musical-notes-outline" };
  if (normalized.startsWith("gust")) return { label: "Gusto / Antojo", icon: "ice-cream-outline" };
  if (normalized.startsWith("otr")) return { label: "Otro", icon: "star-outline" };
  return { label: rawCategory, icon: "pricetag-outline" };
}

type Props = {
  item: WishItem;
  onClose: () => void;
  onOpenLink: (url: string) => void;
  onChangeImage: () => Promise<void>;
};

export default function WishDetailModal({ item, onClose, onOpenLink, onChangeImage }: Props) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const category = resolveCategoryPresentation(item.category);
  const [pickingImage, setPickingImage] = useState(false);

  // Al tocar la foto se abre la galería; el padre persiste la imagen nueva y
  // actualiza el deseo, así que aquí solo se controla el estado de carga.
  const handlePickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      await onChangeImage();
    } finally {
      setPickingImage(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <AppText style={styles.headerTitle} numberOfLines={2} disableHorizontalPadding>
              {item.title}
            </AppText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {/* Imagen: al tocarla se elige una nueva foto */}
            {item.image ? (
              <TouchableOpacity
                style={styles.imageWrap}
                onPress={handlePickImage}
                disabled={pickingImage}
                activeOpacity={0.85}
              >
                <Image source={{ uri: item.image }} style={styles.image} resizeMode="cover" />
                <View style={styles.imageBadge}>
                  {pickingImage ? (
                    <ActivityIndicator size="small" color={colors.surface} />
                  ) : (
                    <Ionicons name="camera-outline" size={16} color={colors.surface} />
                  )}
                  <AppText style={styles.imageBadgeText} disableHorizontalPadding>
                    {pickingImage ? "Cambiando…" : "Cambiar foto"}
                  </AppText>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.imageFallback}
                onPress={handlePickImage}
                disabled={pickingImage}
                activeOpacity={0.85}
              >
                {pickingImage ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="add" size={34} color={colors.primary} />
                )}
                <AppText style={styles.imageFallbackText} disableHorizontalPadding>
                  {pickingImage ? "Cargando…" : "Agregar foto"}
                </AppText>
              </TouchableOpacity>
            )}

            {/* Precio: dato principal, va destacado bajo la imagen */}
            <View style={styles.priceRow}>
              <Ionicons name="pricetag-outline" size={20} color={item.amount !== undefined ? colors.success : colors.textSecondary} />
              <AppText
                style={[
                  styles.priceText,
                  item.amount === undefined && { color: colors.textSecondary, fontWeight: "500" },
                ]}
                disableHorizontalPadding
              >
                {item.amount !== undefined ? formatCurrency(item.amount) : "Precio no especificado"}
              </AppText>
            </View>

            {/* Ficha de datos: categoría y fecha en dos columnas; la
                descripción va debajo con un divisor para separarla */}
            <View style={styles.cardBody}>
              <View style={styles.metaRow}>
                <View style={styles.metaCell}>
                  <View style={styles.metaLabelRow}>
                    <Ionicons name={category.icon} size={14} color={colors.textSecondary} />
                    <AppText style={styles.metaLabel} disableHorizontalPadding>
                      Categoría
                    </AppText>
                  </View>
                  <AppText style={styles.metaValue} disableHorizontalPadding>
                    {category.label}
                  </AppText>
                </View>
                <View style={styles.metaCell}>
                  <View style={styles.metaLabelRow}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                    <AppText style={styles.metaLabel} disableHorizontalPadding>
                      Agregado
                    </AppText>
                  </View>
                  <AppText style={styles.metaValue} disableHorizontalPadding>
                    {new Date(item.createdAt).toLocaleDateString("es-ES", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </AppText>
                </View>
              </View>

              {item.description ? (
                <>
                  <View style={styles.divider} />
                  <AppText style={styles.sectionTitle} disableHorizontalPadding>
                    Descripción
                  </AppText>
                  <AppText style={styles.descText} disableHorizontalPadding>
                    {item.description}
                  </AppText>
                </>
              ) : null}
            </View>

            {/* Enlace al producto */}
            {item.link ? (
              <TouchableOpacity style={styles.linkRow} onPress={() => onOpenLink(item.link)}>
                <Ionicons name="link-outline" size={18} color={colors.primary} />
                <AppText style={styles.linkText} numberOfLines={2} disableHorizontalPadding>
                  {item.link}
                </AppText>
                <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
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
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 24,
      elevation: 10,
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
    image: {
      width: "100%",
      height: 180,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    imageWrap: {
      position: "relative",
      marginBottom: 16,
    },
    imageBadge: {
      position: "absolute",
      bottom: 8,
      right: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "rgba(0,0,0,0.6)",
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    imageBadgeText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.surface,
    },
    imageFallback: {
      width: "100%",
      height: 120,
      borderRadius: 12,
      marginBottom: 16,
      backgroundColor: colors.surface,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      gap: 8,
    },
    imageFallbackText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    priceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 14,
    },
    priceText: {
      fontSize: 24,
      fontWeight: "700",
      color: colors.success,
    },
    cardBody: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    metaCell: {
      flex: 1,
    },
    metaLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginBottom: 3,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    metaValue: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginTop: 12,
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    descText: {
      fontSize: 14,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.primary + "0C",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primary + "1A",
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 4,
    },
    linkText: {
      flex: 1,
      fontSize: 13,
      color: colors.primary,
    },
  });
