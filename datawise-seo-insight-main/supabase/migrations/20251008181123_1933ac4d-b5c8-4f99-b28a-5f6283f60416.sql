-- Create tracked_keywords table
CREATE TABLE IF NOT EXISTS public.tracked_keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.seo_projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  search_engine TEXT NOT NULL DEFAULT 'google',
  location_code INTEGER NOT NULL DEFAULT 2840,
  language_code TEXT NOT NULL DEFAULT 'en',
  device TEXT NOT NULL DEFAULT 'desktop',
  is_active BOOLEAN NOT NULL DEFAULT true,
  target_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, keyword, location_code, language_code, device)
);

-- Create rank_tracking_history table
CREATE TABLE IF NOT EXISTS public.rank_tracking_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tracked_keyword_id UUID NOT NULL REFERENCES public.tracked_keywords(id) ON DELETE CASCADE,
  check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  rank_absolute INTEGER,
  rank_group TEXT,
  previous_rank_absolute INTEGER,
  url TEXT,
  search_volume INTEGER,
  cpc DECIMAL(10, 2),
  competition DECIMAL(5, 4),
  estimated_traffic INTEGER DEFAULT 0,
  serp_item_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create rank_tracking_schedules table
CREATE TABLE IF NOT EXISTS public.rank_tracking_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.seo_projects(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL,
  custom_cron TEXT,
  next_run_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_run_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create rank_tracking_snapshots table
CREATE TABLE IF NOT EXISTS public.rank_tracking_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.seo_projects(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_keywords INTEGER DEFAULT 0,
  avg_position DECIMAL(10, 2),
  visibility_score DECIMAL(10, 2) DEFAULT 0,
  keywords_in_top_3 INTEGER DEFAULT 0,
  keywords_in_top_10 INTEGER DEFAULT 0,
  keywords_in_top_20 INTEGER DEFAULT 0,
  keywords_in_top_50 INTEGER DEFAULT 0,
  estimated_traffic INTEGER DEFAULT 0,
  gainers_count INTEGER DEFAULT 0,
  losers_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, snapshot_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tracked_keywords_project ON public.tracked_keywords(project_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tracked_keywords_lookup ON public.tracked_keywords(keyword, location_code, language_code);
CREATE INDEX IF NOT EXISTS idx_rank_history_keyword_date ON public.rank_tracking_history(tracked_keyword_id, check_date DESC);
CREATE INDEX IF NOT EXISTS idx_rank_history_date ON public.rank_tracking_history(check_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_date ON public.rank_tracking_snapshots(project_id, snapshot_date DESC);

-- Enable Row Level Security
ALTER TABLE public.tracked_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_tracking_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_tracking_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_tracking_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tracked_keywords
CREATE POLICY "Users can view tracked keywords for their projects"
  ON public.tracked_keywords FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = tracked_keywords.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert tracked keywords for their projects"
  ON public.tracked_keywords FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = tracked_keywords.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tracked keywords for their projects"
  ON public.tracked_keywords FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = tracked_keywords.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tracked keywords for their projects"
  ON public.tracked_keywords FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = tracked_keywords.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

-- RLS Policies for rank_tracking_history
CREATE POLICY "Users can view rank history for their keywords"
  ON public.rank_tracking_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tracked_keywords
      JOIN public.seo_projects ON seo_projects.id = tracked_keywords.project_id
      WHERE tracked_keywords.id = rank_tracking_history.tracked_keyword_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert rank history"
  ON public.rank_tracking_history FOR INSERT
  WITH CHECK (true);

-- RLS Policies for rank_tracking_schedules
CREATE POLICY "Users can view schedules for their projects"
  ON public.rank_tracking_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = rank_tracking_schedules.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage schedules for their projects"
  ON public.rank_tracking_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = rank_tracking_schedules.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

-- RLS Policies for rank_tracking_snapshots
CREATE POLICY "Users can view snapshots for their projects"
  ON public.rank_tracking_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = rank_tracking_snapshots.project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage snapshots"
  ON public.rank_tracking_snapshots FOR ALL
  WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_tracked_keywords_updated_at
  BEFORE UPDATE ON public.tracked_keywords
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON public.rank_tracking_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();