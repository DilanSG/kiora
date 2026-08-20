import { useEffect, useRef } from "react";
import { StyleSheet, Animated, View, Easing, Dimensions } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Path } from "react-native-svg";
import { useTheme, ThemeColors, useActiveBackgroundId } from "../../lib/theme";
import BackgroundDecor from "../ui/BackgroundDecor";
import CirclesBg from "../backgrounds/CirclesBg";
import DotsBg from "../backgrounds/DotsBg";
import RingsBg from "../backgrounds/RingsBg";
import WavesBg from "../backgrounds/WavesBg";
import { LogoK } from "../brand/LogoK";

type Props = {
  onHidden: () => void;
};

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const ORBIT_R = 72;
const ORBIT_STROKE = 6;
const BALL_SIZE = 14;
// La K de la identidad llega al centro con la misma caída y rebote que tenía
// la antigua letra, manteniendo la órbita de fondo. El glifo real ocupa
// ~46% del canvas 1372, por eso el tamaño sube un poco para no verlo chico.
const BRAND_SIZE = 220;
const DURACION_ENTRADA = 700;
const DURACION_MANTENER = 750;
const DURACION_FADE = 380;

// Tamaño del canvas SVG: la hoja vive sobre un círculo de radio ORBIT_R
// centrado en el canvas, el mismo centro donde orbita la bolita.
const ORBIT_S = ORBIT_R * 2 + ORBIT_STROKE * 2;

// Anillo tipo navaja: sector de corona circular de grosor constante
// (radio exterior 75, interior 69, el centro en el radio 72 de la órbita).
// En cada corte del hueco el borde exterior e interior convergen en una
// punta V afilada sobre el radio de la órbita (extremos en 208°/152°).
// Arco exterior: sweep=1 (mayor por el lado derecho). Arco interior: debe
// recorrer el MISMO corredor derecho, y al ir desde el extremo inferior al
// superior su ángulo decrece por la zona brillante -> sweep=0 con large=1.
const BLADE_PATH =
  "M 14.4 44.2 L 10.4 45.6 A 75 75 0 1 1 10.4 113.4 L 14.4 111.8 L 18.5 112.9 A 69 69 0 1 0 18.5 43.1 L 14.4 44.2 Z";

// Los presets más aireados de la tienda se usan como "mezcla de todos"
// cuando el usuario no tiene fondo seleccionado (flat). Con solo 4 capas
// y opacidad baja el resultado queda limpio, sin saturación de figuras.
const MIXED_BG_COMPONENTS: React.ComponentType<{ colors: ThemeColors }>[] = [
  CirclesBg, RingsBg, DotsBg, WavesBg,
];

export default function AnimatedSplash({ onHidden }: Props) {
  const colors = useTheme();
  const styles = getStyles(colors);
  // El fondo del splash replica el fondo activo del usuario; sin fondo elegido
  // (flat) se muestra la mezcla de todos los presets.
  const activeBgId = useActiveBackgroundId();

  const containerOpacity = useRef(new Animated.Value(1)).current;
  const orbitAngle = useRef(new Animated.Value(0)).current;
  const brandFall = useRef(new Animated.Value(-240)).current;
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandScale = useRef(new Animated.Value(1.12)).current;
  // Escala de entrada de la órbita y zoom suave al desvanecer.
  const orbitScale = useRef(new Animated.Value(0.88)).current;
  const zoomOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const orbitAnim = Animated.timing(orbitAngle, {
      toValue: 1,
      duration: DURACION_ENTRADA + DURACION_MANTENER,
      easing: Easing.linear,
      useNativeDriver: true,
    });

    const brandAnim = Animated.parallel([
      Animated.timing(brandFall, {
        toValue: 0,
        duration: 550,
        easing: Easing.out(Easing.back(1.3)),
        useNativeDriver: true,
      }),
      Animated.timing(brandOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      // El logotipo llega grande y se asienta con un rebote suave.
      Animated.spring(brandScale, {
        toValue: 1,
        friction: 6,
        tension: 90,
        useNativeDriver: true,
      }),
    ]);

    Animated.parallel([
      orbitAnim,
      brandAnim,
      Animated.spring(orbitScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    const fadeTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(containerOpacity, {
          toValue: 0,
          duration: DURACION_FADE,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(zoomOut, {
          toValue: 1.06,
          duration: DURACION_FADE,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => onHidden());
    }, DURACION_ENTRADA + DURACION_MANTENER);

    return () => {
      clearTimeout(fadeTimer);
    };
  }, [onHidden, orbitAngle, brandFall, brandOpacity, containerOpacity, orbitScale, zoomOut, brandScale]);

  const spin = orbitAngle.interpolate({
    inputRange: [0, 1],
    outputRange: ["45deg", "405deg"],
  });

  // Angulo de la bolita: 45° + 360°*i. La zona del hueco (152°-208°, lado
  // izquierdo) debe coincidir con su desaparicion, con 10° de fundido a cada
  // lado para que no "parpadee" contra el anillo.
  const ballOpacity = orbitAngle.interpolate({
    inputRange: [0, 0.2694, 0.325, 0.425, 0.4806, 1],
    outputRange: [0.92, 0.92, 0, 0, 0.92, 0.92],
  });

  // Pulso de la bolita al pasar por la zona brillante (lado derecho, 0°).
  const ballScale = orbitAngle.interpolate({
    inputRange: [0, 0.82, 0.9, 1],
    outputRange: [1, 1, 1.4, 1],
  });

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity, transform: [{ scale: zoomOut }] }]}>
      {/* Fondo: el del usuario o, si no eligió ninguno, la mezcla de todos */}
      {activeBgId === "flat" ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {MIXED_BG_COMPONENTS.map((Bg, i) => (
            <View key={i} style={styles.mixLayer}>
              <Bg colors={colors} />
            </View>
          ))}
        </View>
      ) : (
        <BackgroundDecor colors={colors} screenVariant={0} />
      )}

      {/* Glow central */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SCREEN_W} height={SCREEN_H}>
          <Defs>
            <RadialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.07" />
              <Stop offset="30%" stopColor={colors.primary} stopOpacity="0.035" />
              <Stop offset="65%" stopColor={colors.primary} stopOpacity="0.014" />
              <Stop offset="100%" stopColor={colors.primary} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={SCREEN_W} height={SCREEN_H} fill="url(#centerGlow)" />
        </Svg>
      </View>

      {/* Orbita principal: anillo con hueco a la izq, brillo a la der. Todo
          el conjunto entra con escala de muelle para que no se sienta estático. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            alignItems: "center",
            justifyContent: "center",
            // 20% más grande: la órbita completa (anillo, aura y bolita) se
            // escala desde el centro manteniendo el spring de entrada.
            transform: [
              {
                scale: orbitScale.interpolate({
                  inputRange: [0.88, 1],
                  outputRange: [0.88 * 1.2, 1.2],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <Svg width={ORBIT_S} height={ORBIT_S}>
          <Defs>
            {/* Degradado del anillo: opacidad progresiva desde las puntas
                hasta el máximo en el lado derecho, sin saltos bruscos */}
            <LinearGradient id="orbitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.06" />
              <Stop offset="15%" stopColor={colors.primary} stopOpacity="0.1" />
              <Stop offset="35%" stopColor={colors.primary} stopOpacity="0.18" />
              <Stop offset="55%" stopColor={colors.primary} stopOpacity="0.32" />
              <Stop offset="75%" stopColor={colors.primary} stopOpacity="0.6" />
              <Stop offset="90%" stopColor={colors.primary} stopOpacity="0.88" />
              <Stop offset="100%" stopColor={colors.primary} stopOpacity="0.98" />
            </LinearGradient>
          </Defs>

          {/* Anillo tipo navaja relleno */}
          <Path
            d={BLADE_PATH}
            fill="url(#orbitGrad)"
          />
        </Svg>

        {/* Bolita orbitando sobre la orbita, con pulso y brillo especular */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ rotate: spin }],
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
          pointerEvents="none"
        >
          <Animated.View
            style={{
              width: BALL_SIZE,
              height: BALL_SIZE,
              borderRadius: BALL_SIZE / 2,
              backgroundColor: colors.primary,
              opacity: ballOpacity,
              transform: [{ translateY: -ORBIT_R }, { scale: ballScale }],
            }}
          >
            <View
              style={{
                position: "absolute",
                top: BALL_SIZE * 0.16,
                left: BALL_SIZE * 0.2,
                width: BALL_SIZE * 0.3,
                height: BALL_SIZE * 0.24,
                borderRadius: 99,
                backgroundColor: "rgba(255,255,255,0.55)",
              }}
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* La K de la identidad cayendo al centro de la órbita */}
      <Animated.View
        style={[
          styles.brandWrap,
          {
            opacity: brandOpacity,
            transform: [
              { translateY: brandFall },
              {
                scale: brandScale.interpolate({
                  inputRange: [1, 1.12],
                  outputRange: [1.2, 1.12 * 1.2],
                }),
              },
            ],
          },
        ]}
      >
        <LogoK size={BRAND_SIZE} />
      </Animated.View>
    </Animated.View>
  );
}

const getStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 99999,
    },
    mixLayer: {
      ...StyleSheet.absoluteFillObject,
      // Cada preset aporta su densidad, pero apilados deben quedar aireados.
      opacity: 0.3,
    },
    brandWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
  });

export { AnimatedSplash };