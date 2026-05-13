import React from 'react';
import { brand } from '../brand';

type BrandLogoProps = {
  size?: number;
  style?: React.CSSProperties;
};

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 96, style }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: size * 0.25,
        fontFamily: brand.fontHead,
        fontWeight: 800,
        color: brand.text,
        fontSize: size * 0.55,
        letterSpacing: -1.2,
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <defs>
          <linearGradient id="dw-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={brand.forestLight} />
            <stop offset="1" stopColor={brand.forest} />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#dw-grad)" />
        <path
          d="M30 68 L30 32 L46 32 C58 32 68 40 68 50 C68 60 58 68 46 68 Z"
          fill={brand.text}
        />
        <circle cx="72" cy="68" r="6" fill={brand.text} />
      </svg>
      <span>
        DataWise<span style={{ color: brand.forestLight }}>.</span>
      </span>
    </div>
  );
};
