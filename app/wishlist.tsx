import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Linking,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { KeyboardAvoidingView } from "../components/ui/KeyboardAvoiding";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, useGlow, ThemeColors } from "../lib/theme";
import { useWishlist } from "../hooks/useWishlist";
import { useAlert } from "../components/ui/AlertModal";
import { WishItem } from "../lib/storage/types";
import {
  deriveWishTitleFromLink,
  fetchLinkMetadata,
  normalizeWishlistLink,
  normalizeWishCategory,
  type LinkMetadata,
} from "../lib/storage";
import { WishCard } from "../components/features/wishlist/WishCard";
import WishDetailModal from "../components/features/wishlist/WishDetailModal";
import BackgroundDecor from "../components/ui/BackgroundDecor";
import EmptyState from "../components/ui/EmptyState";
import AppText from "../components/ui/AppText";
import { formatInput, formatNumber, parseAmountInput } from "../lib/currency";
import { useSafeBottom } from "../hooks/useSafeBottom";
import { launchImageLibraryAsync } from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Directory, File, Paths } from "expo-file-system";

// Carpeta local donde viven las imágenes subidas desde el celular. Vivir en
// documentDirectory (no en cache) garantiza que sobrevivan a la limpieza del
// sistema; la base guarda la ruta file:// como cualquier otra URI.
const WISH_IMAGE_DIR = "wishlist-images";

// Genera un nombre de archivo único sin depender de crypto.randomUUID (no
// garantizado en el runtime de React Native), igual esquema que generateId.
function newImageFileName(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}.jpg`;
}

// Re-encodea la imagen elegida a JPEG y la guarda en la carpeta local. El
// re-encode descarta metadatos EXIF (GPS, cámara, etc.): la app no guarda
// información del dispositivo de origen, solo la foto en sí.
// Cada paso degrada con gracia: si el re-encode falla se usa la foto
// original y si la copia falla se usa la URI del re-encode (en cache).
async function persistWishImage(sourceUri: string): Promise<string> {
  let processedUri = sourceUri;
  try {
    const processed = await manipulateAsync(
      sourceUri,
      [],
      { compress: 0.85, format: SaveFormat.JPEG }
    );
    processedUri = processed.uri;
  } catch (err) {
    console.error("persistWishImage: re-encode falló, uso la original", err);
  }

  try {
    const dir = new Directory(Paths.document, WISH_IMAGE_DIR);
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    const dest = new File(dir, newImageFileName());
    if (dest.exists) dest.delete();
    new File(processedUri).copy(dest);
    return dest.uri;
  } catch (err) {
    console.error("persistWishImage: copia falló, uso la URI procesada", err);
    return processedUri;
  }
}

// Borra una imagen local de la app si la URI guardada apunta a nuestra
// carpeta (las URLs remotas no se tocan, son del sitio del producto).
function removeLocalWishImage(uri: string | undefined | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.uri.startsWith(`${Paths.document.uri}${WISH_IMAGE_DIR}/`)) {
      if (f.exists) f.delete();
    }
  } catch {
    // URI malformada (p. ej. ya borrada): ignorar.
  }
}

type WishCategory = "objeto" | "concierto" | "gusto" | "otro";
const WISH_CATEGORIES = ["objeto", "concierto", "gusto", "otro"] as const;

const WISH_CATEGORY_LABELS: Record<WishCategory, string> = {
  objeto: "Objeto",
  concierto: "Concierto",
  gusto: "Gusto",
  otro: "Otro",
};

const WISH_CATEGORY_ICONS: Record<WishCategory, keyof typeof Ionicons.glyphMap> = {
  objeto: "cube-outline",
  concierto: "musical-notes-outline",
  gusto: "ice-cream-outline",
  otro: "star-outline",
};

// Sugiere una categoría a partir de texto o URL del deseo.
function inferWishCategory(text: string): WishCategory {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("ticket") ||
    normalized.includes("entrada") ||
    normalized.includes("concierto") ||
    normalized.includes("recital") ||
    normalized.includes("show") ||
    normalized.includes("festival")
  ) {
    return "concierto";
  }

  if (
    normalized.includes("comida") ||
    normalized.includes("restaurante") ||
    normalized.includes("café") ||
    normalized.includes("anticipo") ||
    normalized.includes("gusto") ||
    normalized.includes("brunch")
  ) {
    return "gusto";
  }

  return "objeto";
}

export default function WishlistScreen() {
  const colors = useTheme();
  const bottomPad = useSafeBottom();
  const styles = getStyles(colors, bottomPad);
  const { glowStyle } = useGlow();

  const { items, addWishItem, updateWishItem, deleteWishItem } = useWishlist();
  const { showAlert } = useAlert();
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const [linkInput, setLinkInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [imageInput, setImageInput] = useState("");
  const [categoryInput, setCategoryInput] = useState<WishCategory>("objeto");

  const [viewingItem, setViewingItem] = useState<WishItem | null>(null);
  const isEditing = editingItemId !== null;

  const resetForm = () => {
    setLinkInput("");
    setTitleInput("");
    setAmountInput("");
    setDescInput("");
    setImageInput("");
    setCategoryInput("objeto");
    setEditingItemId(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    resetForm();
  };

  const handleStartEdit = (item: WishItem) => {
    const rawCategory = normalizeWishCategory(item.category ?? "");
    const nextCategory = WISH_CATEGORIES.includes(rawCategory as WishCategory)
      ? (rawCategory as WishCategory)
      : "objeto";

    setEditingItemId(item.id);
    setLinkInput(item.link ?? "");
    setTitleInput(item.title);
    setAmountInput(item.amount !== undefined ? formatNumber(item.amount) : "");
    setDescInput(item.description ?? "");
    setImageInput(item.image ?? "");
    setCategoryInput(nextCategory);
    setModalVisible(true);
  };

  // Rellena los campos del formulario con los metadatos obtenidos del link,
  // pero solo si el usuario no ha escrito ya algo en ese campo. Esto permite
  // que la autodeteccion no pise datos ingresados manualmente.
  // Por ejemplo: si el usuario ya escribio un titulo, no se sobreescribe
  // aunque la pagina tenga un og:title diferente.
  const applyMetadataToForm = (
    normalizedUrl: string,
    metadata: LinkMetadata
  ): boolean => {
    let changed = false;

    let nextTitle = titleInput.trim();
    let nextDescription = descInput.trim();
    let nextImage = imageInput.trim();
    let nextAmount = amountInput.trim();

    if (metadata.title && !nextTitle) {
      nextTitle = metadata.title;
      setTitleInput(nextTitle);
      changed = true;
    }
    if (metadata.description && !nextDescription) {
      nextDescription = metadata.description;
      setDescInput(nextDescription);
      changed = true;
    }
    if (metadata.image && !nextImage) {
      nextImage = metadata.image;
      setImageInput(nextImage);
      changed = true;
    }
    if (metadata.price !== undefined && !nextAmount) {
      nextAmount = formatNumber(metadata.price);
      setAmountInput(nextAmount);
      changed = true;
    }

    const inferred = inferWishCategory(`${normalizedUrl} ${metadata.title ?? ""}`);
    if (categoryInput === "objeto" && inferred !== "objeto") {
      setCategoryInput(inferred);
      changed = true;
    }

    if (!nextTitle) {
      const fallbackTitle = deriveWishTitleFromLink(normalizedUrl);
      if (fallbackTitle) {
        nextTitle = fallbackTitle;
        setTitleInput(fallbackTitle);
        changed = true;
      }
    }

    return changed;
  };

  // Normaliza el texto pegado en enlace y completa metadatos al salir del input.
  const handleLinkInputBlur = async () => {
    const rawValue = linkInput.trim();
    if (!rawValue || loading) {
      return;
    }

    let normalizedUrl = "";
    try {
      normalizedUrl = normalizeWishlistLink(rawValue);
    } catch {
      return;
    }

    if (normalizedUrl !== linkInput) {
      setLinkInput(normalizedUrl);
    }

    if (titleInput.trim() && descInput.trim() && imageInput.trim() && amountInput.trim()) {
      return;
    }

    setLoading(true);
    try {
      const metadata = await fetchLinkMetadata(normalizedUrl);
      applyMetadataToForm(normalizedUrl, metadata);
    } finally {
      setLoading(false);
    }
  };

  const handleInspectLink = async () => {
    const rawUrl = linkInput.trim();
    if (!rawUrl) {
      showAlert("Enlace vacío", "Por favor ingresa un enlace para examinar.");
      return;
    }

    let normalizedUrl = "";
    try {
      normalizedUrl = normalizeWishlistLink(rawUrl);
      setLinkInput(normalizedUrl);
    } catch {
      showAlert("Enlace inválido", "Revisa el formato del enlace.");
      return;
    }

    setLoading(true);
    try {
      const metadata = await fetchLinkMetadata(normalizedUrl);
      const changed = applyMetadataToForm(normalizedUrl, metadata);

      if (!changed) {
        showAlert(
          "Sin datos automáticos",
          "No se encontraron metadatos completos para este enlace, pero puede guardarse igual."
        );
      }
    } catch {
      showAlert("Aviso", "No se pudieron precargar todos los detalles, pero pueden completarse manualmente.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItem = async () => {
    const rawLink = linkInput.trim();
    let normalizedLink = "";

    if (rawLink) {
      try {
        normalizedLink = normalizeWishlistLink(rawLink);
        setLinkInput(normalizedLink);
      } catch {
        showAlert("Enlace inválido", "Revisa el formato del enlace antes de guardar.");
        return;
      }
    }

    let finalTitle = titleInput.trim();
    let finalDescription = descInput.trim() || undefined;
    let finalImage = imageInput.trim() || undefined;
    let finalAmountInput = amountInput.trim();
    let finalCategory: WishCategory = categoryInput;

    // Si hay link pero faltan campos, intenta llenarlos con metadatos
    // automaticos de la pagina. Esto evita que el usuario tenga que
    // escribir titulo y descripcion manualmente si pego un link valido.
    if (normalizedLink && (!finalTitle || !finalDescription || !finalImage || !finalAmountInput)) {
      setLoading(true);
      try {
        const metadata = await fetchLinkMetadata(normalizedLink);

        // Solo rellena los campos que el usuario dejo vacios.
        if (!finalTitle && metadata.title) {
          finalTitle = metadata.title;
        }
        if (!finalDescription && metadata.description) {
          finalDescription = metadata.description;
        }
        if (!finalImage && metadata.image) {
          finalImage = metadata.image;
        }
        if (!finalAmountInput && metadata.price !== undefined) {
          finalAmountInput = formatNumber(metadata.price);
        }

        // Si la categoria sigue siendo "objeto" por defecto, intenta
        // inferirla del contexto (ej. si es un link a un concierto).
        if (finalCategory === "objeto") {
          finalCategory = inferWishCategory(`${normalizedLink} ${metadata.title ?? ""}`);
        }
      } finally {
        setLoading(false);
      }
    }

    // Si aun no hay titulo, genera uno desde el slug del enlace.
    if (!finalTitle && normalizedLink) {
      finalTitle = deriveWishTitleFromLink(normalizedLink);
    }

    if (!finalTitle) {
      showAlert("Falta información", "Escribir un título o agregar un enlace válido permite generar el título automáticamente.");
      return;
    }

    // Parsea el monto permitiendo coma o punto como separador decimal.
    let price: number | undefined;
    if (finalAmountInput) {
      price = parseAmountInput(finalAmountInput);
      if (price === undefined) {
        showAlert("Precio inválido", "Ingresa un valor numérico válido para el precio.");
        return;
      }
    }

    const payload = {
      title: finalTitle,
      link: normalizedLink || "",
      amount: price,
      description: finalDescription,
      image: finalImage,
      category: finalCategory,
    };

    if (editingItemId) {
      // Al editar, si el deseo tenía una imagen local y el formulario la
      // reemplazó (o la quitó), se borra el archivo que quedó huérfano.
      const prev = items.find((w) => w.id === editingItemId);
      if (prev?.image && prev.image !== finalImage) {
        removeLocalWishImage(prev.image);
      }
      await updateWishItem(editingItemId, payload);
    } else {
      await addWishItem(payload);
    }

    resetForm();
    setModalVisible(false);
  };

  const handleDeleteItem = (id: string) => {
    showAlert("Eliminar deseo", "¿Deseas quitar este elemento de tu lista?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          const target = items.find((w) => w.id === id);
          if (target) handleDeleteImageLocal(target);
          deleteWishItem(id);
        },
      },
    ]);
  };

  const handleOpenLink = async (url: string) => {
    if (!url) return;
    let formattedUrl = "";
    try {
      formattedUrl = normalizeWishlistLink(url);
    } catch {
      showAlert("Error", "El enlace guardado no tiene un formato válido.");
      return;
    }

    try {
      const supported = await Linking.canOpenURL(formattedUrl);
      if (supported) {
        await Linking.openURL(formattedUrl);
      } else {
        showAlert("Error", "No se puede abrir este enlace.");
      }
    } catch {
      showAlert("Error", "Ocurrió un problema al abrir el enlace.");
    }
  };

  // Abre la galería del celular, re-encodea la foto elegida (sin metadatos
  // EXIF) y la guarda en la carpeta local de imágenes del deseo.
  const handlePickImage = async () => {
    if (pickingImage) return;
    setPickingImage(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }
      const localUri = await persistWishImage(result.assets[0].uri);
      removeLocalWishImage(imageInput);
      setImageInput(localUri);
    } catch (err) {
      // El picker puede fallar por URI no leíble (content:// externo) o un
      // error del sistema; se loguea la causa real para diagnóstico.
      console.error("handlePickImage falló", err);
      showAlert("Error", "No se pudo cargar la imagen. Intenta de nuevo.");
    } finally {
      setPickingImage(false);
    }
  };

  // Quita la imagen del formulario y borra el archivo local si lo había.
  const handleRemoveImage = () => {
    removeLocalWishImage(imageInput);
    setImageInput("");
  };

  // Cambia la foto del deseo desde el modal de detalle: elige de la galería,
  // la persiste localmente y actualiza el item (y el estado local del modal).
  const handleChangeDetailImage = async () => {
    if (!viewingItem) return;
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri) {
        return;
      }
      const localUri = await persistWishImage(result.assets[0].uri);
      if (localUri === viewingItem.image) {
        return;
      }
      if (viewingItem.image) {
        removeLocalWishImage(viewingItem.image);
      }
      const updated = { ...viewingItem, image: localUri };
      await updateWishItem(viewingItem.id, {
        title: updated.title,
        link: updated.link,
        amount: updated.amount,
        description: updated.description,
        image: updated.image,
        category: updated.category,
      });
      setViewingItem(updated);
    } catch (err) {
      console.error("handleChangeDetailImage falló", err);
      showAlert("Error", "No se pudo cargar la imagen. Intenta de nuevo.");
    }
  };

  // Si la imagen guardada era local (subida desde el cel), borra el archivo.
  const handleDeleteImageLocal = (item: WishItem) => {
    removeLocalWishImage(item.image);
  };

  return (
    <View style={styles.container}>
      <BackgroundDecor colors={colors} screenVariant={4} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <WishCard
            item={item}
            onPress={(w) => setViewingItem(w)}
            onDelete={handleDeleteItem}
            onOpenLink={handleOpenLink}
            onEdit={handleStartEdit}
          />
        )}
        ListHeaderComponent={
          items.length > 0 ? (
            <AppText style={styles.editHint}>
              Mantener presionada una tarjeta permite editar el deseo.
            </AppText>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="star-outline"
            title="Tu lista de deseos está vacía"
            subtitle="Agrega cosas que deseas obtener o hacer"
          />
        }
        style={{ flex: 1 }}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 88 }]}
      />

      <TouchableOpacity
        style={[styles.favButton, { bottom: bottomPad + 20 }]}
        onPress={handleOpenCreateModal}
      >
        <Ionicons name="add" size={28} color={colors.surface} />
      </TouchableOpacity>

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={handleCloseModal}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalView}>
            <View style={styles.modalHeader}>
              <AppText style={styles.modalTitle}>{isEditing ? "Editar Deseo" : "Nuevo Deseo"}</AppText>
              <TouchableOpacity onPress={handleCloseModal}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
              <AppText style={styles.label}>Enlace o texto con enlace (Opcional)</AppText>
              <View style={styles.linkRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="https://tienda.com/producto"
                  placeholderTextColor={colors.textSecondary}
                  value={linkInput}
                  onChangeText={setLinkInput}
                  onBlur={handleLinkInputBlur}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.inspectButton} onPress={handleInspectLink} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator size="small" color={colors.surface} />
                  ) : (
                    <Ionicons name="search" size={20} color={colors.surface} />
                  )}
                </TouchableOpacity>
              </View>

              <AppText style={styles.label}>Título (Opcional con enlace)</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. Consola de videojuegos"
                placeholderTextColor={colors.textSecondary}
                value={titleInput}
                onChangeText={setTitleInput}
              />

              <AppText style={styles.label}>Precio</AppText>
              <TextInput
                style={styles.input}
                placeholder="Ej. 49.999"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                value={amountInput}
                onChangeText={(t) => setAmountInput(formatInput(t))}
              />

              <AppText style={styles.label}>Descripción</AppText>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Breve nota sobre este deseo"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
                value={descInput}
                onChangeText={setDescInput}
              />

              <AppText style={styles.label}>Categoría</AppText>
              <View style={styles.categoryList}>
                {WISH_CATEGORIES.map((cat) => {
                  const selected = categoryInput === cat;

                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryItem, selected && styles.categoryItemSelected, glowStyle]}
                      onPress={() => setCategoryInput(cat)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.categoryItemLeft}>
                        <Ionicons
                          name={WISH_CATEGORY_ICONS[cat]}
                          size={16}
                          color={selected ? colors.primary : colors.textSecondary}
                        />
                        <AppText
                          style={[styles.categoryItemText, selected && styles.categoryItemTextSelected]}
                          disableHorizontalPadding
                        >
                          {WISH_CATEGORY_LABELS[cat]}
                        </AppText>
                      </View>
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                        color={selected ? colors.primary : colors.border}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <AppText style={styles.label}>Imagen (Opcional)</AppText>
              <View style={styles.imageRow}>
                <TouchableOpacity
                  style={[styles.imagePickBtn, imageInput && styles.imagePickBtnActive]}
                  onPress={handlePickImage}
                  disabled={pickingImage}
                  activeOpacity={0.85}
                >
                  {pickingImage ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="image-outline" size={18} color={colors.primary} />
                  )}
                  <AppText style={styles.imagePickText} disableHorizontalPadding>
                    {pickingImage ? "Procesando…" : "Subir imagen"}
                  </AppText>
                </TouchableOpacity>
                <AppText style={styles.imageOrText} disableHorizontalPadding>
                  o pega el enlace de abajo
                </AppText>
              </View>
              <TextInput
                style={styles.input}
                placeholder="https://sitio.com/imagen.jpg"
                placeholderTextColor={colors.textSecondary}
                value={imageInput}
                onChangeText={setImageInput}
                editable={!pickingImage}
              />
              {imageInput ? (
                <View style={styles.imagePreviewRow}>
                  <Image source={{ uri: imageInput }} style={styles.imagePreview} resizeMode="cover" />
                  <TouchableOpacity style={styles.imageRemoveBtn} onPress={handleRemoveImage} activeOpacity={0.85}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <AppText style={styles.imageRemoveText} disableHorizontalPadding>
                      Quitar imagen
                    </AppText>
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity style={styles.saveButton} onPress={handleSaveItem}>
                <AppText style={styles.saveButtonText}>{isEditing ? "Guardar cambios" : "Guardar deseo"}</AppText>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {viewingItem && (
        <WishDetailModal
          item={viewingItem}
          onClose={() => setViewingItem(null)}
          onOpenLink={handleOpenLink}
          onChangeImage={handleChangeDetailImage}
        />
      )}
    </View>
  );
}

function getStyles(colors: ThemeColors, bottomPad = 0) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      padding: 16,
      paddingBottom: 88,
    },
    editHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    favButton: {
      position: "absolute",
      right: 20,
      bottom: 28,
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
      fontSize: 18,
      fontWeight: "bold",
      color: colors.textPrimary,
    },
    modalScroll: {
      padding: 16,
      paddingBottom: 16 + bottomPad,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.textPrimary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 16,
    },
    multiline: {
      minHeight: 80,
      textAlignVertical: "top",
    },
    linkRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 16,
    },
    inspectButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      width: 48,
      height: 48,
      justifyContent: "center",
      alignItems: "center",
    },
    categoryList: {
      gap: 8,
      marginBottom: 16,
    },
    categoryItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    categoryItemSelected: {
      backgroundColor: colors.surface,
      borderColor: colors.primary,
    },
    categoryItemLeft: {
      flexDirection: "row",
      alignItems: "center",
      flex: 1,
      marginRight: 12,
    },
    categoryItemText: {
      marginLeft: 8,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textPrimary,
      fontWeight: "500",
      flexShrink: 1,
      paddingRight: 4,
    },
    categoryItemTextSelected: {
      fontWeight: "600",
    },
    saveButton: {
      backgroundColor: colors.success,
      borderRadius: 12,
      padding: 14,
      alignItems: "center",
      marginTop: 8,
      marginBottom: 32,
    },
    saveButtonText: {
      color: colors.surface,
      fontSize: 16,
      fontWeight: "bold",
    },
    imageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 10,
    },
    imagePickBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    imagePickBtnActive: {
      borderColor: colors.primary,
    },
    imagePickText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.primary,
    },
    imageOrText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    imageLinkBtn: {
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    imageLinkText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    imagePreviewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 16,
    },
    imagePreview: {
      width: 64,
      height: 64,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    imageRemoveBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    imageRemoveText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.error,
    },
  });
}
