-- Add location column to seo_tasks table for storing URLs where issues are located
ALTER TABLE public.seo_tasks 
ADD COLUMN location TEXT;