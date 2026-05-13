import React from 'react';
import { brand } from '../brand';

type CardProps = {
  width?: number | string;
  height?: number | string;
  padding?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

export const Card: React.FC<CardProps> = ({
  width = '100%',
  height = 'auto',
  padding = 28,
  style,
  children,
}) => {
  return (
    <div
      style={{
        width,
        height,
        padding,
        background: brand.surface,
        border: `1px solid ${brand.border}`,
        borderRadius: 18,
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        fontFamily: brand.fontBody,
        color: brand.text,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
