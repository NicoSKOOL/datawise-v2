-- Drop AI Search Visibility tables in correct order (respecting foreign key constraints)

-- Drop citations table first (has foreign key to results)
DROP TABLE IF EXISTS public.ai_search_citations CASCADE;

-- Drop results table (has foreign key to queries)
DROP TABLE IF EXISTS public.ai_search_results CASCADE;

-- Drop queries table (has foreign key to tracking projects)
DROP TABLE IF EXISTS public.ai_search_queries CASCADE;

-- Drop tracking projects table last (has foreign key to seo_projects)
DROP TABLE IF EXISTS public.ai_search_tracking_projects CASCADE;