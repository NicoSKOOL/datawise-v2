import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';

type CountUpProps = {
  from?: number;
  to: number;
  startFrame: number;
  durationInFrames: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  style?: React.CSSProperties;
};

const formatNumber = (n: number, decimals: number): string => {
  const fixed = n.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${withCommas}.${decPart}` : withCommas;
};

export const CountUp: React.FC<CountUpProps> = ({
  from = 0,
  to,
  startFrame,
  durationInFrames,
  prefix = '',
  suffix = '',
  decimals = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const value = interpolate(
    frame,
    [startFrame, startFrame + durationInFrames],
    [from, to],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    },
  );
  return (
    <span style={style}>
      {prefix}
      {formatNumber(value, decimals)}
      {suffix}
    </span>
  );
};
