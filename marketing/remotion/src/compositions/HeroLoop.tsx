import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { brand } from '../brand';
import { BrandLogo } from '../components/BrandLogo';
import { Card } from '../components/Card';
import { CountUp } from '../components/CountUp';
import { BarFill } from '../components/BarFill';

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame % 240, [0, 120, 240], [0.25, 0.45, 0.25]);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 800px at 50% 45%, ${brand.bgElevated} 0%, ${brand.bg} 70%)`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(600px 400px at 50% 55%, rgba(0,101,61,${pulse}) 0%, rgba(0,0,0,0) 70%)`,
        }}
      />
      <GridBackdrop />
    </AbsoluteFill>
  );
};

const GridBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 240], [0, 48]);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `
          linear-gradient(${brand.border} 1px, transparent 1px),
          linear-gradient(90deg, ${brand.border} 1px, transparent 1px)
        `,
        backgroundSize: '48px 48px',
        backgroundPosition: `${drift}px ${drift}px`,
        maskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        WebkitMaskImage:
          'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        opacity: 0.6,
      }}
    />
  );
};

const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame, fps, config: { damping: 14 } });
  const glow = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: appear,
        transform: `scale(${0.92 + appear * 0.08})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${brand.forestGlow} 0%, rgba(0,0,0,0) 65%)`,
          opacity: glow,
          filter: 'blur(40px)',
        }}
      />
      <BrandLogo size={180} />
    </AbsoluteFill>
  );
};

type KPI = { label: string; value: number; prefix?: string; suffix?: string; decimals?: number };

const kpis: KPI[] = [
  { label: 'Keywords tracked', value: 1247 },
  { label: 'Visibility lift', value: 23, suffix: '%', prefix: '↑ ' },
  { label: 'Traffic value', value: 4.2, prefix: '$', suffix: 'k', decimals: 1 },
];

const SceneKpis: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: 36,
        flexDirection: 'row',
      }}
    >
      {kpis.map((kpi, i) => {
        const delay = i * 5;
        const enter = spring({
          frame: frame - delay,
          fps,
          config: { damping: 18, stiffness: 120 },
        });
        const translate = interpolate(enter, [0, 1], [60, 0]);
        return (
          <div
            key={kpi.label}
            style={{
              opacity: enter,
              transform: `translateY(${translate}px)`,
            }}
          >
            <Card width={340} padding={32}>
              <div
                style={{
                  fontSize: 18,
                  color: brand.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: 1.4,
                  fontWeight: 600,
                }}
              >
                {kpi.label}
              </div>
              <div
                style={{
                  fontFamily: brand.fontHead,
                  fontSize: 68,
                  fontWeight: 800,
                  color: brand.text,
                  lineHeight: 1,
                  letterSpacing: -2,
                }}
              >
                <CountUp
                  from={0}
                  to={kpi.value}
                  startFrame={delay}
                  durationInFrames={40}
                  prefix={kpi.prefix}
                  suffix={kpi.suffix}
                  decimals={kpi.decimals ?? 0}
                />
              </div>
              <div
                style={{
                  marginTop: 8,
                  height: 6,
                  background: 'rgba(245,247,246,0.06)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${interpolate(frame - delay, [0, 40], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`,
                    background: `linear-gradient(90deg, ${brand.forest}, ${brand.forestLight})`,
                  }}
                />
              </div>
            </Card>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

type Row = { keyword: string; volume: number; difficulty: number };

const keywordRows: Row[] = [
  { keyword: 'seo tools', volume: 90500, difficulty: 78 },
  { keyword: 'keyword research', volume: 49500, difficulty: 72 },
  { keyword: 'rank tracker', volume: 22000, difficulty: 61 },
  { keyword: 'competitor analysis', volume: 18100, difficulty: 58 },
  { keyword: 'ai seo assistant', volume: 6600, difficulty: 34 },
];

const SceneKeywords: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <Card width={1120} padding={36}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: brand.fontHead,
              fontSize: 30,
              fontWeight: 700,
              color: brand.text,
            }}
          >
            Keyword Research
          </div>
          <div
            style={{
              fontSize: 16,
              color: brand.textMuted,
              fontWeight: 600,
            }}
          >
            5 of 1,247 results
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 0.8fr 1.4fr',
            gap: 10,
            fontSize: 14,
            color: brand.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 1.2,
            fontWeight: 600,
            paddingBottom: 10,
            borderBottom: `1px solid ${brand.border}`,
          }}
        >
          <span>Keyword</span>
          <span>Volume</span>
          <span>Difficulty</span>
        </div>
        {keywordRows.map((row, i) => {
          const delay = i * 6;
          const enter = spring({
            frame: frame - delay,
            fps,
            config: { damping: 16 },
          });
          return (
            <div
              key={row.keyword}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 0.8fr 1.4fr',
                gap: 10,
                alignItems: 'center',
                padding: '16px 0',
                borderBottom: `1px solid ${brand.border}`,
                opacity: enter,
                transform: `translateX(${interpolate(enter, [0, 1], [-24, 0])}px)`,
              }}
            >
              <span
                style={{
                  fontFamily: brand.fontBody,
                  fontSize: 22,
                  color: brand.text,
                  fontWeight: 500,
                }}
              >
                {row.keyword}
              </span>
              <span
                style={{
                  fontFamily: brand.fontHead,
                  fontSize: 22,
                  color: brand.text,
                  fontWeight: 700,
                }}
              >
                <CountUp
                  to={row.volume}
                  startFrame={delay}
                  durationInFrames={20}
                />
              </span>
              <BarFill
                width={420}
                height={12}
                percent={row.difficulty}
                startFrame={delay + 4}
                durationInFrames={22}
              />
            </div>
          );
        })}
      </Card>
    </AbsoluteFill>
  );
};

const rankPoints = [62, 48, 41, 34, 22, 14, 8];

const SceneRankChart: React.FC = () => {
  const frame = useCurrentFrame();
  const chartWidth = 1040;
  const chartHeight = 360;
  const xStep = chartWidth / (rankPoints.length - 1);
  const maxRank = 70;
  const points = rankPoints
    .map((r, i) => `${i * xStep},${(r / maxRank) * chartHeight}`)
    .join(' ');
  const draw = interpolate(frame, [0, 45], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const pathLength = 2000;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <Card width={1180} padding={40}>
        <div
          style={{
            fontFamily: brand.fontHead,
            fontSize: 30,
            fontWeight: 700,
            color: brand.text,
            marginBottom: 6,
          }}
        >
          Rank Tracking
        </div>
        <div
          style={{
            fontSize: 18,
            color: brand.textMuted,
            marginBottom: 20,
          }}
        >
          &ldquo;seo tools&rdquo; &middot; last 7 weeks
        </div>
        <svg width={chartWidth} height={chartHeight + 60}>
          <defs>
            <linearGradient id="rank-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={brand.forestLight} />
              <stop offset="1" stopColor="#4ade80" />
            </linearGradient>
            <linearGradient id="rank-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(34,197,94,0.35)" />
              <stop offset="1" stopColor="rgba(34,197,94,0)" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={0}
              x2={chartWidth}
              y1={(chartHeight / 3) * i + 20}
              y2={(chartHeight / 3) * i + 20}
              stroke={brand.border}
              strokeDasharray="4 6"
            />
          ))}
          <polyline
            fill="none"
            stroke="url(#rank-line)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
            transform="translate(0, 20)"
            strokeDasharray={pathLength}
            strokeDashoffset={(1 - draw) * pathLength}
          />
          <polygon
            fill="url(#rank-fill)"
            points={`0,${chartHeight + 20} ${points} ${chartWidth},${chartHeight + 20}`}
            transform="translate(0, 0)"
            opacity={draw}
          />
          {rankPoints.map((r, i) => {
            const appear = interpolate(
              frame,
              [i * 5 + 6, i * 5 + 18],
              [0, 1],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
            return (
              <circle
                key={i}
                cx={i * xStep}
                cy={(r / maxRank) * chartHeight + 20}
                r={8}
                fill={brand.bg}
                stroke={brand.forestLight}
                strokeWidth={3}
                opacity={appear}
              />
            );
          })}
        </svg>
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            fontFamily: brand.fontBody,
            fontSize: 20,
            color: brand.text,
          }}
        >
          <span
            style={{
              background: 'rgba(34,197,94,0.15)',
              color: '#4ade80',
              padding: '6px 14px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            ↑ 54 positions
          </span>
          <span style={{ color: brand.textMuted }}>
            #62 → #8 in 7 weeks
          </span>
        </div>
      </Card>
    </AbsoluteFill>
  );
};

const SceneTagline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 18 },
  });
  const exit = interpolate(frame, [20, 30], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        opacity: enter * exit,
      }}
    >
      <div
        style={{
          fontFamily: brand.fontHead,
          fontSize: 96,
          fontWeight: 800,
          color: brand.text,
          textAlign: 'center',
          letterSpacing: -3,
          lineHeight: 1.02,
          transform: `translateY(${interpolate(enter, [0, 1], [24, 0])}px)`,
        }}
      >
        See every ranking.
        <br />
        <span style={{ color: brand.forestLight }}>Beat every competitor.</span>
      </div>
    </AbsoluteFill>
  );
};

export const HeroLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const loopFade = interpolate(frame, [230, 240], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: brand.bg, opacity: loopFade }}>
      <Background />
      <Sequence from={0} durationInFrames={30}>
        <SceneIntro />
      </Sequence>
      <Sequence from={30} durationInFrames={60}>
        <SceneKpis />
      </Sequence>
      <Sequence from={90} durationInFrames={60}>
        <SceneKeywords />
      </Sequence>
      <Sequence from={150} durationInFrames={60}>
        <SceneRankChart />
      </Sequence>
      <Sequence from={210} durationInFrames={30}>
        <SceneTagline />
      </Sequence>
    </AbsoluteFill>
  );
};
