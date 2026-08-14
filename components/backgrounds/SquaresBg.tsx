import { View } from "react-native";
import { ThemeColors } from "../../lib/theme";

export default function SquaresBg({ colors }: { colors: ThemeColors }) {
  const c = colors.primary;
  const boost = colors.figureOpacity;
  const boostOpacity = (v: number) => Math.min(1, v * boost);


  const squares = [
    { top: "3%", left: "4%", size: 50, opacity: boostOpacity(0.06), rotate: "15deg", filled: true },
    { top: "2%", right: "12%", size: 40, opacity: boostOpacity(0.08), rotate: "-10deg", filled: false, borderW: 2 },
    { top: "14%", left: "25%", size: 28, opacity: boostOpacity(0.1), rotate: "45deg", filled: true },
    { top: "10%", right: "4%", size: 55, opacity: boostOpacity(0.06), rotate: "30deg", filled: false, borderW: 2.5 },
    { top: "28%", left: "6%", size: 35, opacity: boostOpacity(0.08), rotate: "-20deg", filled: true },
    { top: "32%", left: "38%", size: 22, opacity: boostOpacity(0.12), rotate: "60deg", filled: false, borderW: 2 },
    { top: "25%", right: "8%", size: 45, opacity: boostOpacity(0.07), rotate: "5deg", filled: true },
    { top: "45%", left: "3%", size: 48, opacity: boostOpacity(0.07), rotate: "-35deg", filled: false, borderW: 2.5 },
    { top: "50%", left: "30%", size: 30, opacity: boostOpacity(0.09), rotate: "25deg", filled: true },
    { top: "42%", right: "5%", size: 38, opacity: boostOpacity(0.08), rotate: "-15deg", filled: false, borderW: 2 },
    { top: "62%", left: "8%", size: 42, opacity: boostOpacity(0.07), rotate: "40deg", filled: true },
    { top: "68%", left: "35%", size: 26, opacity: boostOpacity(0.11), rotate: "-8deg", filled: false, borderW: 2 },
    { top: "58%", right: "10%", size: 52, opacity: boostOpacity(0.06), rotate: "18deg", filled: true },
    { top: "78%", left: "4%", size: 34, opacity: boostOpacity(0.08), rotate: "-25deg", filled: true },
    { top: "82%", left: "28%", size: 44, opacity: boostOpacity(0.07), rotate: "55deg", filled: false, borderW: 2.5 },
    { top: "74%", right: "6%", size: 28, opacity: boostOpacity(0.1), rotate: "-5deg", filled: true },
    { top: "90%", left: "15%", size: 36, opacity: boostOpacity(0.08), rotate: "35deg", filled: false, borderW: 2 },
    { top: "86%", right: "15%", size: 32, opacity: boostOpacity(0.09), rotate: "-30deg", filled: true },
  ];

  return (
    <>
      {squares.map((sq, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            top: sq.top as any,
            left: sq.left as any,
            right: sq.right as any,
            width: sq.size,
            height: sq.size,
            opacity: sq.opacity,
            backgroundColor: sq.filled ? c : "transparent",
            borderWidth: sq.filled ? 0 : (sq as any).borderW || 2,
            borderColor: sq.filled ? undefined : c,
            borderRadius: sq.size * 0.15,
            transform: [{ rotate: sq.rotate }],
          }}
        />
      ))}
    </>
  );
}
