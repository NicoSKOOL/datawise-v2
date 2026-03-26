import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Check, X, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import HistoricalPerformance from "@/components/HistoricalPerformance";

interface Project {
  id: string;
  project_name: string;
  website_url: string;
}

interface Task {
  id: string;
  task_title: string;
  task_description: string;
  category: string;
  priority: string;
  is_completed: boolean;
  created_at: string;
  completed_at?: string;
  notes?: string;
  location?: string;
}

const CATEGORIES = [
  "Technical SEO",
  "Content Optimization", 
  "Meta Tags",
  "Performance",
  "Images",
  "Mobile Optimization",
  "Schema Markup",
  "Internal Linking",
  "External Links"
];

const PRIORITIES = ["High", "Medium", "Low"];

export default function ProjectTasks() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("tasks");

  // Form state
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [category, setCategory] = useState("Technical SEO");
  const [priority, setPriority] = useState("Medium");
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (user && id) {
      fetchProjectAndTasks();
    }
  }, [user, id]);

  const fetchProjectAndTasks = async () => {
    try {
      // Fetch project details
      const { data: projectData, error: projectError } = await supabase
        .from('seo_projects')
        .select('*')
        .eq('id', id)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      // Fetch tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('seo_tasks')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: false });

      if (tasksError) throw tasksError;
      setTasks(tasksData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to load project data",
        variant: "destructive",
      });
      navigate('/seo-projects');
    } finally {
      setLoading(false);
    }
  };

  const createTask = async () => {
    if (!taskTitle.trim()) {
      toast({
        title: "Error",
        description: "Task title is required",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const { error } = await supabase
        .from('seo_tasks')
        .insert([{
          project_id: id,
          task_title: taskTitle.trim(),
          task_description: taskDescription.trim(),
          category,
          priority,
          location: location.trim() || null
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Task created successfully",
      });

      // Reset form
      setTaskTitle("");
      setTaskDescription("");
      setCategory("Technical SEO");
      setPriority("Medium");
      setLocation("");
      setShowCreateDialog(false);
      fetchProjectAndTasks();
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error",
        description: "Failed to create task",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const toggleTaskCompletion = async (taskId: string, isCompleted: boolean) => {
    try {
      const { error } = await supabase
        .from('seo_tasks')
        .update({ 
          is_completed: !isCompleted,
          completed_at: !isCompleted ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) throw error;
      
      fetchProjectAndTasks();
    } catch (error) {
      console.error('Error updating task:', error);
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const { error } = await supabase
        .from('seo_tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
      fetchProjectAndTasks();
    } catch (error) {
      console.error('Error deleting task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === "completed") return task.is_completed;
    if (filter === "pending") return !task.is_completed;
    return true;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "destructive";
      case "Medium": return "default";
      case "Low": return "secondary";
      default: return "default";
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-pulse text-muted-foreground">Loading project tasks...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Project Not Found</h1>
          <Button onClick={() => navigate('/seo-projects')}>
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  const completedCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={() => navigate('/seo-projects')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Projects
        </Button>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{project.project_name}</h1>
        <p className="text-muted-foreground mb-4">{project.website_url}</p>
        
        <div className="flex flex-wrap items-center gap-4">
          <Badge variant="outline" className="text-base py-1 px-3">
            {completedCount} / {totalCount} tasks completed ({progressPercentage}%)
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="performance">Historical Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-6">
          <div className="flex justify-between items-center">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                <TabsTrigger value="all">All Tasks</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
              </TabsList>
            </Tabs>

            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New SEO Task</DialogTitle>
              <DialogDescription>
                Add a new task to track for this project
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="task-title">Task Title</Label>
                <Input
                  id="task-title"
                  placeholder="Fix missing meta description"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="task-description">Description (Optional)</Label>
                <Textarea
                  id="task-description"
                  placeholder="Add meta description tags to all pages..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="task-location">Location URL (Optional)</Label>
                <Input
                  id="task-location"
                  placeholder="https://example.com/page-with-issue"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map(pri => (
                        <SelectItem key={pri} value={pri}>{pri}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button onClick={createTask} disabled={creating}>
                  {creating ? "Creating..." : "Create Task"}
                </Button>
              </div>
            </div>
            </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            {filteredTasks.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold mb-2">
                      {filter === "all" ? "No Tasks Yet" : `No ${filter} Tasks`}
                    </h3>
                    <p className="text-muted-foreground mb-4">
                      {filter === "all" 
                        ? "Create your first SEO task to get started"
                        : `No ${filter} tasks found`
                      }
                    </p>
                    {filter === "all" && (
                      <Button onClick={() => setShowCreateDialog(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Your First Task
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              filteredTasks.map((task) => (
                <Card key={task.id} className={`transition-all ${task.is_completed ? 'opacity-60' : ''}`}>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <Checkbox
                        checked={task.is_completed}
                        onCheckedChange={() => toggleTaskCompletion(task.id, task.is_completed)}
                        className="mt-1"
                      />
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between">
                          <h3 className={`font-semibold ${task.is_completed ? 'line-through' : ''}`}>
                            {task.task_title}
                          </h3>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{task.category}</Badge>
                            <Badge variant={getPriorityColor(task.priority) as any}>
                              {task.priority}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteTask(task.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {task.task_description && (
                          <p className={`text-muted-foreground ${task.is_completed ? 'line-through' : ''}`}>
                            {task.task_description}
                          </p>
                        )}
                        
                        {task.location && (
                          <p className={`text-sm text-muted-foreground ${task.is_completed ? 'line-through' : ''}`}>
                            <span className="font-medium">Location:</span>{' '}
                            <a 
                              href={task.location} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              {task.location}
                            </a>
                          </p>
                        )}
                        
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>Created {new Date(task.created_at).toLocaleDateString()}</span>
                          {task.is_completed && task.completed_at && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              Completed {new Date(task.completed_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="performance">
          <HistoricalPerformance websiteUrl={project?.website_url || ""} />
        </TabsContent>
      </Tabs>
    </div>
  );
}