-- Create SEO projects table
CREATE TABLE public.seo_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  website_url TEXT NOT NULL,
  project_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create SEO tasks table
CREATE TABLE public.seo_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.seo_projects(id) ON DELETE CASCADE,
  task_title TEXT NOT NULL,
  task_description TEXT,
  category TEXT NOT NULL DEFAULT 'Technical SEO',
  priority TEXT NOT NULL DEFAULT 'Medium',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT
);

-- Enable Row Level Security
ALTER TABLE public.seo_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_tasks ENABLE ROW LEVEL SECURITY;

-- Create policies for seo_projects
CREATE POLICY "Users can view their own SEO projects" 
ON public.seo_projects 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own SEO projects" 
ON public.seo_projects 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own SEO projects" 
ON public.seo_projects 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own SEO projects" 
ON public.seo_projects 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create policies for seo_tasks
CREATE POLICY "Users can view tasks from their own projects" 
ON public.seo_tasks 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.seo_projects 
  WHERE public.seo_projects.id = public.seo_tasks.project_id 
  AND public.seo_projects.user_id = auth.uid()
));

CREATE POLICY "Users can create tasks in their own projects" 
ON public.seo_tasks 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seo_projects 
  WHERE public.seo_projects.id = public.seo_tasks.project_id 
  AND public.seo_projects.user_id = auth.uid()
));

CREATE POLICY "Users can update tasks in their own projects" 
ON public.seo_tasks 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.seo_projects 
  WHERE public.seo_projects.id = public.seo_tasks.project_id 
  AND public.seo_projects.user_id = auth.uid()
));

CREATE POLICY "Users can delete tasks from their own projects" 
ON public.seo_tasks 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM public.seo_projects 
  WHERE public.seo_projects.id = public.seo_tasks.project_id 
  AND public.seo_projects.user_id = auth.uid()
));

-- Create trigger for automatic timestamp updates on seo_projects
CREATE TRIGGER update_seo_projects_updated_at
BEFORE UPDATE ON public.seo_projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_seo_projects_user_id ON public.seo_projects(user_id);
CREATE INDEX idx_seo_tasks_project_id ON public.seo_tasks(project_id);
CREATE INDEX idx_seo_tasks_is_completed ON public.seo_tasks(is_completed);