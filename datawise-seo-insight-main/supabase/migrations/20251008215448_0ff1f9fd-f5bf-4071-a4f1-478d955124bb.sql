-- Add location and language settings to seo_projects table
ALTER TABLE public.seo_projects 
ADD COLUMN location_code integer,
ADD COLUMN language_code text,
ADD COLUMN location_name text;

-- Add index for faster lookups
CREATE INDEX idx_seo_projects_location ON public.seo_projects(location_code);

-- Add comment explaining these are DataForSEO location/language codes
COMMENT ON COLUMN public.seo_projects.location_code IS 'DataForSEO location code for rank tracking';
COMMENT ON COLUMN public.seo_projects.language_code IS 'DataForSEO language code for rank tracking';
COMMENT ON COLUMN public.seo_projects.location_name IS 'Display name for the selected location';