import Svg, { Defs, LinearGradient, Stop, Path } from "react-native-svg";
import { useTheme } from "../../lib/theme";

type Props = {
  size: number;
  // Color único (modo monocromo) que ignora el tema. Sin él, el gradiente
  // se deriva del primary activo (modo claro/oscuro y variante equipada).
  color?: string;
};

// Las 4 cápsulas macizas del SVG limpio de la K (canvas 1372). Son siluetas
// unitarias sin agujeros internos, por eso no hacen falta fillRules. El
// relleno entero de cada una es el gradiente de marca; extraídas con el
// parser validado (cobertura 99.77% vs el SVG fuente) en coordenadas absolutas.
const PILL_A =
  "M 466.5 361 C 453.6 363.7 442.8 370.2 432 381.6 C 423.6 390.4 419 398.3 416.5 408 C 415.6 411.6 414.4 415 413.9 415.6 C 413.3 416.3 413 453.7 413.2 513.1 L 413.5 609.5 L 419.1 621 C 423.8 630.4 426.1 633.9 432.1 640.1 C 446.3 654.8 457.7 659.9 477.5 660.7 C 491.4 661.3 498.2 659.9 509.1 654.5 C 521.7 648.1 534.1 635.6 539.5 623.8 C 545 611.8 544.8 614.9 544.9 510.1 L 545 412.9 L 542 403.8 C 538.3 392.9 532.7 384.5 523.5 376.4 C 515.4 369.2 512.4 367.4 502.5 363.7 C 495.5 361.1 493 360.7 482.5 360.4 C 475.9 360.2 468.7 360.5 466.5 361";
const PILL_B =
  "M 880.5 360.6 C 873.9 361.6 861.7 366.4 856.2 370 C 852.9 372.2 829.7 394.8 801 423.7 C 757.8 467.3 744.9 480.5 729 497.7 C 727.1 499.8 723.5 503.3 721 505.5 C 716 510 624.7 602.8 604.9 623.6 C 591 638.2 586.6 645.2 582.9 658.5 C 581.1 665.2 580.8 668.2 581.2 678.4 C 582 697.6 586.9 708.6 600.7 722.2 C 611.9 733.2 620.8 737.9 634.3 740 C 649.8 742.5 665.5 739.6 678.8 731.8 C 683.1 729.4 717.6 695.4 815.6 597.5 C 943.7 469.5 946.9 466.3 950.4 459 C 957.8 443.5 959.6 428.9 956 412.6 C 952.4 396.3 943.7 383.4 929 372.5 C 917.2 363.8 908.9 360.9 894.5 360.5 C 888.5 360.3 882.2 360.4 880.5 360.6";
const PILL_C =
  "M 465.4 693.5 C 462 694.2 458.4 695.3 457.4 695.8 C 456.3 696.3 453 697.8 450 699.1 C 445.9 700.9 441.9 704 434.5 711.5 C 429 717 423.7 723.1 422.8 725 C 421.9 726.9 419.8 731.2 418.3 734.5 L 415.5 740.5 L 415.5 939.5 L 417.8 946.2 C 423.7 963.4 439 979.3 456.5 986.6 C 463.2 989.4 464.1 989.5 479.5 989.5 C 494.5 989.5 496 989.3 503.1 986.7 C 516.9 981.6 532.7 967 539 953.4 C 545.4 939.7 545.2 944.4 544.8 838.1 C 544.4 733.2 544.7 740.7 539.1 728.5 C 534.5 718.5 520.1 703.9 511 699.8 C 508.5 698.6 505.3 697.1 503.9 696.4 C 495.8 692.2 477.5 690.9 465.4 693.5";
const PILL_D =
  "M 749.3 723.5 C 732.1 728.2 714.4 743.5 705.9 761.1 C 697.9 777.6 698.4 801.6 707.1 818.4 C 708.8 821.7 711.6 826.3 713.4 828.6 C 715.3 831 747.5 863.9 785.1 901.8 C 830.7 947.8 855.2 971.6 858.5 973.6 C 861.2 975.1 867 977.7 871.3 979.2 C 878.3 981.7 880.5 982 891.3 982 C 905.7 981.9 909.9 981.1 920 976.3 C 926.1 973.4 929.4 970.9 937.5 962.6 C 949.3 950.8 954.1 942.1 956.7 928.7 C 958.4 919.6 958.1 904.7 956.2 902.8 C 955.5 902.1 955 899.9 955 897.9 C 955 895.5 953.5 891.2 950.8 885.8 C 945.9 876.4 943.1 873.5 852.7 782.3 C 814.4 743.7 803.9 733.6 799.4 731.3 C 796.4 729.8 792.5 727.7 790.7 726.8 C 782 722.3 760.4 720.5 749.3 723.5";

// Mezcla el primary con blanco para conseguir el segundo stop del gradiente
// sin depender de tonos fijos de marca. El ratio se mantiene en 0.38 para que
// el contraste entre stops se note en cualquier variante del tema.
function lighten(hex: string, ratio: number): string {
  const h = hex.replace("#", "");
  const to255 = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * ratio);
  const c = (v: number) => mix(to255(v)).toString(16).padStart(2, "0");
  return `#${c(0)}${c(2)}${c(4)}`;
}

export function LogoK({ size, color }: Props) {
  const colors = useTheme();
  const from = color ?? colors.primary;
  const to = color ?? lighten(colors.primary, 0.38);
  return (
    <Svg width={size} height={size} viewBox="0 0 1372 1372">
      <Defs>
        <LinearGradient id="kioraGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={from} />
          <Stop offset="100%" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Path d={PILL_A} fill={color ?? "url(#kioraGrad)"} />
      <Path d={PILL_B} fill={color ?? "url(#kioraGrad)"} />
      <Path d={PILL_C} fill={color ?? "url(#kioraGrad)"} />
      <Path d={PILL_D} fill={color ?? "url(#kioraGrad)"} />
    </Svg>
  );
}