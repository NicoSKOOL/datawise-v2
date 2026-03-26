import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ExternalLink, Trash2, Edit2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Project {
  id: string;
  project_name: string;
  website_url: string;
  created_at: string;
  task_count?: number;
  completed_count?: number;
}

export default function SEOProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  const fetchProjects = async () => {
    try {
      const { data: projectsData, error: projectsError } = await supabase
        .from('seo_projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;

      // Fetch task counts for each project
      const projectsWithCounts = await Promise.all(
        projectsData.map(async (project) => {
          const { data: tasks, error: tasksError } = await supabase
            .from('seo_tasks')
            .select('is_completed')
            .eq('project_id', project.id);

          if (tasksError) {
            console.error('Error fetching tasks:', tasksError);
            return { ...project, task_count: 0, completed_count: 0 };
          }

          const task_count = tasks.length;
          const completed_count = tasks.filter(task => task.is_completed).length;
          
          return { ...project, task_count, completed_count };
        })
      );

      setProjects(projectsWithCounts);
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast({
        title: "Error",
        description: "Failed to load SEO projects",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    if (!projectName.trim() || !websiteUrl.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase
        .from('seo_projects')
        .insert([{
          project_name: projectName.trim(),
          website_url: websiteUrl.trim(),
          user_id: user?.id
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "SEO project created successfully",
      });

      setProjectName("");
      setWebsiteUrl("");
      setShowCreateDialog(false);
      fetchProjects();
    } catch (error) {
      console.error('Error creating project:', error);
      toast({
        title: "Error",
        description: "Failed to create SEO project",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm("Are you sure you want to delete this project? This will also delete all associated tasks.")) {
      return;
    }

    try {
      const { error } = await supabase
        .from('seo_projects')
        .delete()
        .eq('id', projectId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "SEO project deleted successfully",
      });
      fetchProjects();
    } catch (error) {
      console.error('Error deleting project:', error);
      toast({
        title: "Error",
        description: "Failed to delete SEO project",
        variant: "destructive",
      });
    }
  };

  const getProgressPercentage = (completed: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-pulse text-muted-foreground">Loading SEO projects...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">SEO Projects</h1>
          <p className="text-muted-foreground">
            Manage your website SEO projects and track your progress
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New SEO Project</DialogTitle>
              <DialogDescription>
                Add a new website to track SEO improvements
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  placeholder="My Website SEO"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="website-url">Website URL</Label>
                <Input
                  id="website-url"
                  placeholder="https://example.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Include https:// or http://
                </p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button onClick={createProject} disabled={creating}>
                  {creating ? "Creating..." : "Create Project"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">No SEO Projects Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first SEO project to start tracking website improvements
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Project
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-xl mb-2">{project.project_name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 min-w-0">
                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      <a 
                        href={project.website_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:underline truncate block"
                        title={project.website_url}
                      >
                        {project.website_url}
                      </a>
                    </CardDescription>
                  </div>
                  <div className="flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteProject(project.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium">Progress</span>
                      <Badge variant="secondary">
                        {project.completed_count || 0} / {project.task_count || 0} tasks
                      </Badge>
                    </div>
                    <Progress 
                      value={getProgressPercentage(project.completed_count || 0, project.task_count || 0)} 
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {getProgressPercentage(project.completed_count || 0, project.task_count || 0)}% complete
                    </p>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      className="flex-1"
                      onClick={() => navigate(`/seo-projects/${project.id}`)}
                    >
                      <Edit2 className="h-4 w-4 mr-2" />
                      Manage Tasks
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}