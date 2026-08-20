import { useState } from "react";
import { Modal, TouchableOpacity, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppText from "./AppText";
import { useTheme, ThemeColors } from "../../lib/theme";

type Section = {
  title: string;
  lines: string[];
};

type Props = {
  title: string;
  lines: string[];
  // Bloques "tipo y alcance": subtítulo con la explicación de la lógica
  // detrás de funciones con reglas no obvias (recurrentes, puntos, cuotas).
  sections?: Section[];
};

// Botón de sugerencia del header: abre un modal inferior con las pistas de
// uso de la pantalla actual. El contenido es estático, por eso el modal
// vive dentro del propio botón.
export default function HintSheet({ title, lines, sections }: Props) {
  const colors = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={styles.button}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                <AppText style={styles.title}>{title}</AppText>
              </View>
              <TouchableOpacity
                onPress={() => setVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.lines}>
              {lines.map((line, i) => (
                <View key={i} style={styles.lineRow}>
                  <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                  <AppText style={styles.lineText}>{line}</AppText>
                </View>
              ))}
              {sections?.map((section) => (
                <View key={section.title} style={styles.section}>
                  <AppText style={styles.sectionTitle}>{section.title}</AppText>
                  {section.lines.map((line, i) => (
                    <View key={i} style={styles.lineRow}>
                      <View style={[styles.bullet, { backgroundColor: colors.border }]} />
                      <AppText style={styles.lineText}>{line}</AppText>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function getStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: {
      padding: 6,
      marginRight: 14,
    },
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0, 0, 0, 0.45)",
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: colors.border,
      padding: 20,
      paddingTop: 10,
    },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 10,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    headerTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: "700",
      color: colors.textPrimary,
    },
    lines: {
      gap: 12,
    },
    lineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    bullet: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      marginTop: 7,
    },
    lineText: {
      flex: 1,
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    section: {
      gap: 12,
      marginTop: 6,
    },
    sectionTitle: {
      fontSize: 11.5,
      fontWeight: "700",
      color: colors.primary,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    },
  });
}