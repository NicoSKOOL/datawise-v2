import type { SVGProps } from 'react';

interface SpiderIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function SpiderIcon({ size = 24, className, ...props }: SpiderIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      {...props}
    >
      {/* === Abdomen (large round bottom) === */}
      <rect x="13" y="16" width="6" height="1" />
      <rect x="12" y="17" width="8" height="1" />
      <rect x="11" y="18" width="10" height="1" />
      <rect x="11" y="19" width="10" height="1" />
      <rect x="11" y="20" width="10" height="1" />
      <rect x="11" y="21" width="10" height="1" />
      <rect x="12" y="22" width="8" height="1" />
      <rect x="13" y="23" width="6" height="1" />
      <rect x="14" y="24" width="4" height="1" />

      {/* === Head (smaller, on top) === */}
      <rect x="14" y="11" width="4" height="1" />
      <rect x="13" y="12" width="6" height="1" />
      <rect x="13" y="13" width="6" height="1" />
      <rect x="13" y="14" width="6" height="1" />
      <rect x="14" y="15" width="4" height="1" />

      {/* === Eyes (white pixels) === */}
      <rect x="14" y="12" width="1" height="1" fill="white" />
      <rect x="17" y="12" width="1" height="1" fill="white" />
      {/* Pupils */}
      <rect x="14" y="13" width="1" height="1" opacity="0.4" />
      <rect x="17" y="13" width="1" height="1" opacity="0.4" />

      {/* === Chelicerae (fangs) === */}
      <rect x="14" y="15" width="1" height="1" opacity="0.7" />
      <rect x="17" y="15" width="1" height="1" opacity="0.7" />

      {/* === Left legs (4 pairs, angled with joints) === */}
      {/* Leg 1 (top) - goes up and out */}
      <rect x="11" y="13" width="2" height="1" />
      <rect x="9" y="12" width="2" height="1" />
      <rect x="7" y="11" width="2" height="1" />
      <rect x="5" y="10" width="2" height="1" />
      <rect x="4" y="8" width="1" height="2" />
      <rect x="3" y="7" width="1" height="1" />

      {/* Leg 2 */}
      <rect x="11" y="15" width="2" height="1" />
      <rect x="9" y="14" width="2" height="1" />
      <rect x="7" y="13" width="2" height="1" />
      <rect x="5" y="13" width="2" height="1" />
      <rect x="4" y="14" width="1" height="2" />
      <rect x="3" y="16" width="1" height="1" />

      {/* Leg 3 */}
      <rect x="11" y="18" width="1" height="1" />
      <rect x="9" y="18" width="2" height="1" />
      <rect x="7" y="19" width="2" height="1" />
      <rect x="5" y="20" width="2" height="1" />
      <rect x="4" y="21" width="1" height="2" />
      <rect x="3" y="23" width="1" height="1" />

      {/* Leg 4 (bottom) */}
      <rect x="11" y="20" width="1" height="1" />
      <rect x="9" y="21" width="2" height="1" />
      <rect x="7" y="22" width="2" height="1" />
      <rect x="5" y="23" width="2" height="1" />
      <rect x="4" y="24" width="1" height="2" />
      <rect x="3" y="26" width="1" height="1" />

      {/* === Right legs (mirrored) === */}
      {/* Leg 1 (top) */}
      <rect x="19" y="13" width="2" height="1" />
      <rect x="21" y="12" width="2" height="1" />
      <rect x="23" y="11" width="2" height="1" />
      <rect x="25" y="10" width="2" height="1" />
      <rect x="27" y="8" width="1" height="2" />
      <rect x="28" y="7" width="1" height="1" />

      {/* Leg 2 */}
      <rect x="19" y="15" width="2" height="1" />
      <rect x="21" y="14" width="2" height="1" />
      <rect x="23" y="13" width="2" height="1" />
      <rect x="25" y="13" width="2" height="1" />
      <rect x="27" y="14" width="1" height="2" />
      <rect x="28" y="16" width="1" height="1" />

      {/* Leg 3 */}
      <rect x="20" y="18" width="1" height="1" />
      <rect x="21" y="18" width="2" height="1" />
      <rect x="23" y="19" width="2" height="1" />
      <rect x="25" y="20" width="2" height="1" />
      <rect x="27" y="21" width="1" height="2" />
      <rect x="28" y="23" width="1" height="1" />

      {/* Leg 4 (bottom) */}
      <rect x="20" y="20" width="1" height="1" />
      <rect x="21" y="21" width="2" height="1" />
      <rect x="23" y="22" width="2" height="1" />
      <rect x="25" y="23" width="2" height="1" />
      <rect x="27" y="24" width="1" height="2" />
      <rect x="28" y="26" width="1" height="1" />

      {/* === Abdomen markings (subtle) === */}
      <rect x="15" y="19" width="2" height="1" opacity="0.2" />
      <rect x="14" y="21" width="4" height="1" opacity="0.15" />
    </svg>
  );
}
