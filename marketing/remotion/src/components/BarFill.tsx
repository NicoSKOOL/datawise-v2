import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { brand } from '../brand';

type BarFillProps = {
  width: number;
  height?: number;
  percent: number;
  startFrame: number;
  durationInFrames?: number;
  color?: string;
  track?: string;
};

export const BarFill: React.FC<BarFillProps> = ({
  width,
  height = 10,
  percent,
  startFrame,
  durationInFrames = 20,
  color = brand.forestLight,
  track = 'rgba(245,247,246,0.08)',
}) => {
  const frame = useCurrentFrame();
  const fill = interpolate(
    frame,
    [startFrame, startFrame + durationInFrames],
    [0, percent],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    },
  );
  return (
    <div
      style={{
        width,
        height,
        background: track,
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${fill}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${brand.forest}, ${color})`,
          borderRadius: height / 2,
        }}
      />
    </div>
  );
};
