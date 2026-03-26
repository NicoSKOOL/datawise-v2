export interface Project {
  id: string;
  name: string;
  domain: string;
  keyword_count: number;
  location_code: number | null;
  created_at: string;
}

export interface TrackedKeyword {
  id: string;
  keyword: string;
  position: number | null;
  prev_position: number | null;
  rank_group: number | null;
  estimated_traffic: number | null;
  checked_at: string | null;
  location_code: number;
  language_code: string;
}

export interface HistoryEntry {
  position: number | null;
  checked_at: string;
}

export interface DistributionBuckets {
  top3: number;
  top10: number;
  top20: number;
  top50: number;
  above50: number;
  not_ranking: number;
}

export interface PeriodSnapshot {
  total_keywords: number;
  ranking_keywords: number;
  avg_position: number | null;
  estimated_traffic: number;
  distribution: DistributionBuckets;
  improved: number;
  declined: number;
  stable: number;
}

export interface TrendPoint {
  date: string;
  avg_position: number | null;
  top3: number;
  top10: number;
  top20: number;
  top50: number;
  above50: number;
}

export interface ProjectReport {
  current: PeriodSnapshot;
  previous: PeriodSnapshot;
  trend: TrendPoint[];
}

export interface TopMover {
  keyword: string;
  project_name: string;
  old_position: number | null;
  new_position: number | null;
  change: number;
}

export interface DashboardSummary {
  has_projects: boolean;
  total_keywords: number;
  avg_position: number | null;
  distribution: DistributionBuckets;
  top_movers: TopMover[];
  top_decliners: TopMover[];
}
