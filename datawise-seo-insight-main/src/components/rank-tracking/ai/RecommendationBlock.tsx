import type { AIRecommendation } from '@/lib/ai-tracking';

const PRIORITY_STYLES: Record<AIRecommendation['priority'], string> = {
  high: 'bg-red-500/20 text-red-100',
  medium: 'bg-amber-500/20 text-amber-100',
  low: 'bg-white/10 text-white/70',
};

export default function RecommendationBlock({ recommendation }: { recommendation: AIRecommendation }) {
  return (
    <div className="bg-[#005232] text-white rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-75">What to do</span>
        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${PRIORITY_STYLES[recommendation.priority]}`}>
          {recommendation.priority}
        </span>
      </div>
      <p className="font-bold text-sm">{recommendation.title}</p>
      <p className="text-sm leading-relaxed mt-1">{recommendation.body}</p>
    </div>
  );
}
