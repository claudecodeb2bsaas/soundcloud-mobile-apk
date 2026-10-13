import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from 'react-native-svg';

let seq = 0;

interface Spot { cx: number; cy: number; r: number; turns: number }

// Цветные пятна кружат вокруг центра с разной скоростью и в разные стороны: цвета перетекают друг в друга
const SPOTS: Spot[] = [
  { cx: 66, cy: 50, r: 36, turns: 4 },
  { cx: 36, cy: 58, r: 32, turns: -3 },
  { cx: 50, cy: 31, r: 30, turns: 2 },
];

/**
 * Светящийся шар «Моей волны»: три цветных пятна с мягкими краями, кольцо-свечение и дыхание.
 * Всё крутится и масштабируется нативным драйвером, поэтому шар не нагружает JS. active ускоряет движение.
 */
export function WaveBlob({ colors, size, active = false }: { colors: readonly [string, string, string]; size: number; active?: boolean }) {
  const id = useRef(`wb${++seq}`).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: active ? 28000 : 60000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, active]);

  useEffect(() => {
    const half = active ? 900 : 2600;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, active]);

  const amount = active ? 0.1 : 0.04;
  const breathe = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + amount] });
  const turn = (turns: number) => spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${turns * 360}deg`] });
  const layer = { position: 'absolute' as const, width: size, height: size };

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[layer, { transform: [{ scale: breathe }] }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`${id}-halo`} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
              <Stop offset="0.35" stopColor={colors[0]} stopOpacity="0.34" />
              <Stop offset="1" stopColor={colors[0]} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={`url(#${id}-halo)`} />
        </Svg>
      </Animated.View>

      {SPOTS.map((spot, i) => (
        <Animated.View key={i} style={[layer, { transform: [{ rotate: turn(spot.turns) }, { scale: breathe }] }]}>
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id={`${id}-s${i}`} cx={spot.cx} cy={spot.cy} r={spot.r} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={colors[i]} stopOpacity="0.95" />
                <Stop offset="0.5" stopColor={colors[i]} stopOpacity="0.5" />
                <Stop offset="1" stopColor={colors[i]} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx={spot.cx} cy={spot.cy} r={spot.r} fill={`url(#${id}-s${i})`} />
          </Svg>
        </Animated.View>
      ))}

      <Animated.View style={[layer, { transform: [{ rotate: turn(-1) }] }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id={`${id}-ring`} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="0.5" stopColor={colors[1]} />
              <Stop offset="1" stopColor={colors[2]} />
            </LinearGradient>
          </Defs>
          <Circle cx="50" cy="50" r="38" stroke={`url(#${id}-ring)`} strokeWidth="9" strokeOpacity="0.1" fill="none" />
          <Circle cx="50" cy="50" r="38" stroke={`url(#${id}-ring)`} strokeWidth="4" strokeOpacity="0.22" fill="none" />
          <Circle cx="50" cy="50" r="38" stroke={`url(#${id}-ring)`} strokeWidth="1.1" strokeOpacity="0.9" fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}