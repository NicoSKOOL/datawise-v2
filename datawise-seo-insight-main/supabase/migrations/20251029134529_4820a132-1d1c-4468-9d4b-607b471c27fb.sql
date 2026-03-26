-- Create AI Search Tracking Projects table
CREATE TABLE public.ai_search_tracking_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seo_project_id UUID NOT NULL REFERENCES public.seo_projects(id) ON DELETE CASCADE,
  target_domain TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  tracking_frequency TEXT NOT NULL DEFAULT 'weekly',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI Search Queries table
CREATE TABLE public.ai_search_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_project_id UUID NOT NULL REFERENCES public.ai_search_tracking_projects(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI Search Results table
CREATE TABLE public.ai_search_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id UUID NOT NULL REFERENCES public.ai_search_queries(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  model_name TEXT NOT NULL,
  response_text TEXT NOT NULL,
  target_domain_cited BOOLEAN NOT NULL DEFAULT false,
  citation_position INTEGER,
  citation_context TEXT,
  total_citations INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  check_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create AI Search Citations table
CREATE TABLE public.ai_search_citations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  result_id UUID NOT NULL REFERENCES public.ai_search_results(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  position INTEGER NOT NULL,
  citation_type TEXT,
  is_target_domain BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_search_tracking_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_citations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ai_search_tracking_projects
CREATE POLICY "Users can view their own AI tracking projects"
  ON public.ai_search_tracking_projects FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = ai_search_tracking_projects.seo_project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create AI tracking projects for their SEO projects"
  ON public.ai_search_tracking_projects FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = ai_search_tracking_projects.seo_project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own AI tracking projects"
  ON public.ai_search_tracking_projects FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = ai_search_tracking_projects.seo_project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own AI tracking projects"
  ON public.ai_search_tracking_projects FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.seo_projects
      WHERE seo_projects.id = ai_search_tracking_projects.seo_project_id
      AND seo_projects.user_id = auth.uid()
    )
  );

-- RLS Policies for ai_search_queries
CREATE POLICY "Users can view queries for their AI projects"
  ON public.ai_search_queries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_search_tracking_projects aitp
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE aitp.id = ai_search_queries.ai_project_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create queries for their AI projects"
  ON public.ai_search_queries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_search_tracking_projects aitp
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE aitp.id = ai_search_queries.ai_project_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own queries"
  ON public.ai_search_queries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_search_tracking_projects aitp
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE aitp.id = ai_search_queries.ai_project_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own queries"
  ON public.ai_search_queries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_search_tracking_projects aitp
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE aitp.id = ai_search_queries.ai_project_id
      AND sp.user_id = auth.uid()
    )
  );

-- RLS Policies for ai_search_results
CREATE POLICY "Users can view results for their queries"
  ON public.ai_search_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_search_queries asq
      JOIN public.ai_search_tracking_projects aitp ON aitp.id = asq.ai_project_id
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE asq.id = ai_search_results.query_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert results"
  ON public.ai_search_results FOR INSERT
  WITH CHECK (true);

-- RLS Policies for ai_search_citations
CREATE POLICY "Users can view citations for their results"
  ON public.ai_search_citations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_search_results asr
      JOIN public.ai_search_queries asq ON asq.id = asr.query_id
      JOIN public.ai_search_tracking_projects aitp ON aitp.id = asq.ai_project_id
      JOIN public.seo_projects sp ON sp.id = aitp.seo_project_id
      WHERE asr.id = ai_search_citations.result_id
      AND sp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert citations"
  ON public.ai_search_citations FOR INSERT
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX idx_ai_projects_seo_project ON public.ai_search_tracking_projects(seo_project_id);
CREATE INDEX idx_ai_queries_project ON public.ai_search_queries(ai_project_id);
CREATE INDEX idx_ai_results_query ON public.ai_search_results(query_id);
CREATE INDEX idx_ai_results_date ON public.ai_search_results(check_date);
CREATE INDEX idx_ai_citations_result ON public.ai_search_citations(result_id);

-- Create trigger for updated_at
CREATE TRIGGER update_ai_tracking_projects_updated_at
  BEFORE UPDATE ON public.ai_search_tracking_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_queries_updated_at
  BEFORE UPDATE ON public.ai_search_queries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();