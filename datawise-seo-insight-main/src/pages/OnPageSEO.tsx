import { useState } from "react";
import { Search, ExternalLink, AlertCircle, CheckCircle, Clock, Plus, Image, Zap, Shield, FileText, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { fetchLighthouseSEO } from "@/lib/dataforseo";
import { useToast } from "@/hooks/use-toast";
import LoadingAnimation from "@/components/LoadingAnimation";
import DotLottieLoader from "@/components/DotLottieLoader";

interface LighthouseResult {
  lighthouse: {
    categories: {
      seo?: { score: number };
      performance?: { score: number };
      accessibility?: { score: number };
      'best-practices'?: { score: number };
    };
    audits: Record<string, {
      id: string;
      title: string;
      description: string;
      score: number | null;
      displayValue?: string;
      numericValue?: number;
      details?: {
        type?: string;
        items?: Array<{
          url?: string;
          wastedBytes?: number;
          wastedMs?: number;
          node?: { nodeLabel?: string; snippet?: string };
          [key: string]: any;
        }>;
        [key: string]: any;
      };
    }>;
    metadata?: {
      finalUrl?: string;
      mainDocumentUrl?: string;
      requestedUrl?: string;
      finalDisplayedUrl?: string;
      fetchTime?: string;
      userAgent?: string;
    };
  };
  htmlContent?: {
    title?: {
      content: string | null;
      length: number;
      exists: boolean;
    };
    metaDescription?: {
      content: string | null;
      length: number;
      exists: boolean;
    };
    metaKeywords?: {
      content: string | null;
      exists: boolean;
    };
    h1Tags?: {
      content: string[];
      count: number;
    };
    url: string;
  };
  htmlData?: {
    title?: { content: string; length: number; exists: boolean };
    metaDescription?: { content: string; length: number; exists: boolean };
    metaKeywords?: { content: string; exists: boolean };
    h1Tags?: { content: string[]; count: number };
    schemaMarkup?: { 
      exists: boolean; 
      types: string[];
      jsonLd: any[];
      microdata: string[];
      rdfa: string[];
    };
    url: string;
  };
  url: string;
  timestamp: string;
}

interface Project {
  id: string;
  project_name: string;
  website_url: string;
}

const CATEGORIES = [
  "Technical SEO",
  "Content Optimization", 
  "Meta Tags",
  "Performance",
  "Images",
  "Mobile Optimization",
  "Schema Markup",
  "Internal Linking"
];

export default function OnPageSEO() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LighthouseResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [selectedAudits, setSelectedAudits] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // TODO: Migrate projects to D1 database
  // For now, projects are empty until D1 migration is complete

  const runAnalysis = async () => {
    if (!url.trim()) {
      toast({
        title: "Error",
        description: "Please enter a URL to analyze",
        variant: "destructive",
      });
      return;
    }

    // Validate URL format
    let validUrl = url.trim();
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl;
    }

    try {
      new URL(validUrl);
    } catch {
      toast({
        title: "Error",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const data: any = await fetchLighthouseSEO({ url: validUrl });

      if (data.error) {
        throw new Error(data.error);
      }

      setResults(data);
      toast({
        title: "Success",
        description: "SEO analysis completed successfully",
      });
    } catch (error) {
      console.error('Error running analysis:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to run SEO analysis",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // TODO: Migrate saveSelectedTasks to D1 database
  const saveSelectedTasks = async () => {
    toast({
      title: "Coming Soon",
      description: "Task saving will be available after D1 database migration",
    });
  };

  const getCategoryForAudit = (auditId: string): string => {
    if (auditId.includes('meta') || auditId.includes('title')) return 'Meta Tags';
    if (auditId.includes('image') || auditId.includes('alt')) return 'Images';
    if (auditId.includes('performance') || auditId.includes('speed')) return 'Performance';
    if (auditId.includes('mobile')) return 'Mobile Optimization';
    if (auditId.includes('schema') || auditId.includes('structured')) return 'Schema Markup';
    if (auditId.includes('link')) return 'Internal Linking';
    return 'Technical SEO';
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.9) return "text-success";
    if (score >= 0.5) return "text-warning";
    return "text-destructive";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 0.9) return "default";
    if (score >= 0.5) return "secondary";
    return "destructive";
  };

  // Helper functions for enhanced display
  const getPerformanceTime = (auditId: string): { seconds: number; color: string; status: string } => {
    const audit = results?.lighthouse?.audits[auditId];
    if (!audit?.numericValue) return { seconds: 0, color: "text-muted-foreground", status: "Unknown" };
    
    const seconds = audit.numericValue / 1000;
    const color = seconds <= 2.5 ? "text-success" : "text-destructive";
    const status = seconds <= 2.5 ? "Good" : "Needs Improvement";
    
    return { seconds: Number(seconds.toFixed(1)), color, status };
  };

  const getSEOBasics = () => {
    if (!results?.htmlData) {
      return {
        title: { present: false, length: 0, text: 'Not found' },
        metaDescription: { present: false, length: 0, text: 'Not found' },
        schema: { present: false, types: [] },
        viewport: { present: false }
      };
    }

    const htmlData = results.htmlData;
    
    return {
      title: {
        present: htmlData.title?.exists || false,
        length: htmlData.title?.length || 0,
        text: htmlData.title?.content || 'No title found'
      },
      metaDescription: {
        present: htmlData.metaDescription?.exists || false,
        length: htmlData.metaDescription?.length || 0,
        text: htmlData.metaDescription?.content || 'No meta description found'
      },
      schema: {
        present: htmlData.schemaMarkup?.exists || false,
        types: htmlData.schemaMarkup?.types || []
      },
      viewport: {
        present: results.lighthouse?.audits?.viewport?.score === 1 || false
      }
    };
  };

  const getImageIssues = () => {
    if (!results || !results.lighthouse) return { unoptimized: [], missingAlt: [], oversized: [] };
    
    const audits = results.lighthouse.audits;
    const unoptimizedAudit = audits['uses-optimized-images'];
    const altTextAudit = audits['image-alt'];
    const oversizedAudit = audits['uses-responsive-images'];
    
    return {
      unoptimized: unoptimizedAudit?.details?.items || [],
      missingAlt: altTextAudit?.details?.items || [],
      oversized: oversizedAudit?.details?.items || []
    };
  };

  const getSlowResources = () => {
    if (!results || !results.lighthouse) return [];
    
    const networkAudit = results.lighthouse.audits['network-requests'];
    const slowResources = networkAudit?.details?.items?.filter((item: any) => 
      item.transferSize > 100000 || item.resourceSize > 500000
    ) || [];
    
    return slowResources;
  };

  const failedAudits = results ? Object.entries(results.lighthouse.audits).filter(([_, audit]) => 
    audit.score !== null && audit.score < 1
  ) : [];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">On-Page SEO Analysis</h1>
          <p className="text-muted-foreground">
            Analyze your website's SEO performance with Google Lighthouse
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Analyze Website</CardTitle>
            <CardDescription>
              Enter a URL to get a comprehensive SEO audit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="url">Website URL</Label>
                <Input
                  id="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && runAnalysis()}
                />
              </div>
              <div className="flex items-end">
                 <Button onClick={runAnalysis} disabled={loading}>
                   {loading ? (
                     <>
                       <DotLottieLoader className="mr-2" size={40} />
                       Analyzing...
                     </>
                   ) : (
                     <>
                       <Search className="h-4 w-4 mr-2" />
                       Analyze
                     </>
                   )}
                 </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              This analysis may take 30-60 seconds to complete
            </p>
          </CardContent>
        </Card>

          {loading && (
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <Card className="p-8">
                <div className="flex flex-col items-center space-y-4">
                  <DotLottieLoader size={240} />
                  <div className="text-center">
                    <h3 className="text-lg font-semibold mb-2">Analyzing Your Website</h3>
                    <p className="text-muted-foreground">
                      Running comprehensive SEO audit using Google Lighthouse...
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}
          
          {results && !loading && (
          <div className="space-y-6">
            <Tabs defaultValue="performance" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="performance" className="flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Performance
                </TabsTrigger>
                <TabsTrigger value="seo-basics" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  SEO Basics
                </TabsTrigger>
                <TabsTrigger value="images" className="flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Images
                </TabsTrigger>
                <TabsTrigger value="issues" className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  All Issues
                </TabsTrigger>
              </TabsList>

              {/* Performance Tab */}
              <TabsContent value="performance">
                <div className="space-y-6">
                  {/* Overall Scores */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Performance Overview</CardTitle>
                      <CardDescription>Your website's loading performance</CardDescription>
                    </CardHeader>
                    <CardContent>
                       <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                         {Object.entries(results.lighthouse.categories).map(([key, category]) => (
                           <div key={key} className="text-center">
                             <div className={`text-3xl font-bold mb-2 ${getScoreColor(category.score)}`}>
                               {Math.round(category.score * 100)}
                             </div>
                             <Badge variant={getScoreBadgeVariant(category.score) as any}>
                               {key.replace('-', ' ').toUpperCase()}
                             </Badge>
                           </div>
                         ))}
                       </div>
                    </CardContent>
                  </Card>

                  {/* Loading Times */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Loading Times</CardTitle>
                      <CardDescription>How fast your website loads for users</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 md:grid-cols-3">
                        {[
                          { id: 'first-contentful-paint', label: 'First Content Visible', description: 'When users see something' },
                          { id: 'largest-contentful-paint', label: 'Main Content Loaded', description: 'When the main content appears' },
                          { id: 'speed-index', label: 'Overall Loading Speed', description: 'How quickly the page fills in' }
                        ].map(({ id, label, description }) => {
                          const timing = getPerformanceTime(id);
                          return (
                            <div key={id} className="space-y-2">
                              <div className="flex justify-between items-center">
                                <span className="font-medium">{label}</span>
                                <Badge variant={timing.seconds <= 2.5 ? "default" : "destructive"}>
                                  {timing.status}
                                </Badge>
                              </div>
                              <div className={`text-2xl font-bold ${timing.color}`}>
                                {timing.seconds}s
                              </div>
                              <p className="text-sm text-muted-foreground">{description}</p>
                              <Progress 
                                value={Math.min((5 - timing.seconds) / 5 * 100, 100)} 
                                className="h-2"
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                        <p className="text-sm">
                          <strong>Good:</strong> 1-2.5 seconds • <strong>Needs Work:</strong> 2.5+ seconds
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Slow Resources */}
                  {getSlowResources().length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Slow Loading Resources</CardTitle>
                        <CardDescription>Files that are slowing down your website</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {getSlowResources().slice(0, 10).map((resource: any, index) => (
                            <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{resource.url}</p>
                                <p className="text-sm text-muted-foreground">
                                  Size: {Math.round(resource.transferSize / 1024)}KB
                                </p>
                              </div>
                              <Badge variant="outline">
                                {resource.resourceType}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* SEO Basics Tab */}
              <TabsContent value="seo-basics">
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>SEO Fundamentals</CardTitle>
                      <CardDescription>Essential SEO elements every website needs</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {(() => {
                          const basics = getSEOBasics();
                          if (!basics) return null;
                          
                          return (
                            <>
                              {/* Page Title */}
                              <div className="flex items-start justify-between p-4 border rounded-lg">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <FileText className="h-5 w-5" />
                                    <h4 className="font-semibold">Page Title</h4>
                                    <Badge variant={basics.title.present ? "default" : "destructive"}>
                                      {basics.title.present ? "Present" : "Missing"}
                                    </Badge>
                                  </div>
                                  {basics.title.present ? (
                                    <div>
                                      <p className="text-sm mb-1">"{basics.title.text}"</p>
                                      <p className="text-xs text-muted-foreground">
                                        Length: {basics.title.length} characters 
                                        {basics.title.length < 30 && " (too short)"}
                                        {basics.title.length > 60 && " (too long)"}
                                        {basics.title.length >= 30 && basics.title.length <= 60 && " (good)"}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-destructive">No title tag found</p>
                                  )}
                                </div>
                              </div>

                              {/* Meta Description */}
                              <div className="flex items-start justify-between p-4 border rounded-lg">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Globe className="h-5 w-5" />
                                    <h4 className="font-semibold">Meta Description</h4>
                                    <Badge variant={basics.metaDescription.present ? "default" : "destructive"}>
                                      {basics.metaDescription.present ? "Present" : "Missing"}
                                    </Badge>
                                  </div>
                                  {basics.metaDescription.present ? (
                                    <div>
                                      <p className="text-sm mb-1">"{basics.metaDescription.text}"</p>
                                      <p className="text-xs text-muted-foreground">
                                        Length: {basics.metaDescription.length} characters
                                        {basics.metaDescription.length < 120 && " (too short)"}
                                        {basics.metaDescription.length > 160 && " (too long)"}
                                        {basics.metaDescription.length >= 120 && basics.metaDescription.length <= 160 && " (good)"}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-destructive">No meta description found</p>
                                  )}
                                </div>
                              </div>

                              {/* Schema Markup */}
                              <div className="flex items-start justify-between p-4 border rounded-lg">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Shield className="h-5 w-5" />
                                    <h4 className="font-semibold">Schema Markup</h4>
                                    <Badge variant={basics.schema.present ? "default" : "destructive"}>
                                      {basics.schema.present ? "Present" : "Missing"}
                                    </Badge>
                                  </div>
                                  {basics.schema.present ? (
                                    <div>
                                      <p className="text-sm">Schema types found:</p>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {basics.schema.types.map((type: string, index: number) => (
                                          <Badge key={index} variant="outline" className="text-xs">
                                            {type}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-destructive">No structured data found</p>
                                  )}
                                </div>
                              </div>

                              {/* Mobile Viewport */}
                              <div className="flex items-start justify-between p-4 border rounded-lg">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Globe className="h-5 w-5" />
                                    <h4 className="font-semibold">Mobile Viewport</h4>
                                    <Badge variant={basics.viewport.present ? "default" : "destructive"}>
                                      {basics.viewport.present ? "Configured" : "Missing"}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground">
                                    {basics.viewport.present 
                                      ? "Your site is optimized for mobile devices"
                                      : "Mobile viewport tag is missing - site may not display properly on mobile"
                                    }
                                  </p>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Images Tab */}
              <TabsContent value="images">
                <div className="space-y-6">
                  {(() => {
                    const imageIssues = getImageIssues();
                    const hasIssues = imageIssues.unoptimized.length > 0 || 
                                     imageIssues.missingAlt.length > 0 || 
                                     imageIssues.oversized.length > 0;
                    
                    if (!hasIssues) {
                      return (
                        <Card>
                          <CardContent className="flex items-center justify-center py-12">
                            <div className="text-center">
                              <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
                              <h3 className="text-lg font-semibold mb-2">Images Look Great!</h3>
                              <p className="text-muted-foreground">
                                Your images are well optimized and accessible.
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    }

                    return (
                      <>
                        {/* Unoptimized Images */}
                        {imageIssues.unoptimized.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <Image className="h-5 w-5" />
                                Unoptimized Images ({imageIssues.unoptimized.length})
                              </CardTitle>
                              <CardDescription>
                                These images could be compressed or converted to modern formats
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {imageIssues.unoptimized.slice(0, 10).map((image: any, index) => (
                                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">{image.url}</p>
                                      <p className="text-sm text-muted-foreground">
                                        Could save {Math.round(image.wastedBytes / 1024)}KB
                                      </p>
                                    </div>
                                    <Badge variant="secondary">
                                      {Math.round(image.wastedBytes / 1024)}KB savings
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Missing Alt Text */}
                        {imageIssues.missingAlt.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <AlertCircle className="h-5 w-5" />
                                Images Missing Alt Text ({imageIssues.missingAlt.length})
                              </CardTitle>
                              <CardDescription>
                                These images need alt text for accessibility
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {imageIssues.missingAlt.slice(0, 10).map((image: any, index) => (
                                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">
                                        {image.node?.snippet || image.url || `Image ${index + 1}`}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        Missing alt attribute
                                      </p>
                                    </div>
                                    <Badge variant="destructive">
                                      No Alt Text
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Oversized Images */}
                        {imageIssues.oversized.length > 0 && (
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <Image className="h-5 w-5" />
                                Oversized Images ({imageIssues.oversized.length})
                              </CardTitle>
                              <CardDescription>
                                These images are larger than needed
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-3">
                                {imageIssues.oversized.slice(0, 10).map((image: any, index) => (
                                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">{image.url}</p>
                                      <p className="text-sm text-muted-foreground">
                                        Could save {Math.round(image.wastedBytes / 1024)}KB
                                      </p>
                                    </div>
                                    <Badge variant="secondary">
                                      Resize needed
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </>
                    );
                  })()}
                </div>
              </TabsContent>

              {/* All Issues Tab */}
              <TabsContent value="issues">

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">All Issues & Recommendations</h3>
                    {failedAudits.length > 0 && projects.length > 0 && (
                      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                        <DialogTrigger asChild>
                          <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Save to Project
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Save Issues as Tasks</DialogTitle>
                            <DialogDescription>
                              Select which issues you want to save as tasks to track
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <Label>Select Project</Label>
                              <Select value={selectedProject} onValueChange={setSelectedProject}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Choose a project" />
                                </SelectTrigger>
                                <SelectContent>
                                  {projects.map(project => (
                                    <SelectItem key={project.id} value={project.id}>
                                      {project.project_name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div>
                              <Label>Select Issues to Save</Label>
                              <div className="max-h-64 overflow-y-auto space-y-2 mt-2">
                                {failedAudits.map(([auditId, audit]) => (
                                  <div key={auditId} className="flex items-start space-x-2">
                                    <input
                                      type="checkbox"
                                      id={auditId}
                                      checked={selectedAudits.includes(auditId)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedAudits([...selectedAudits, auditId]);
                                        } else {
                                          setSelectedAudits(selectedAudits.filter(id => id !== auditId));
                                        }
                                      }}
                                      className="mt-1"
                                    />
                                    <label htmlFor={auditId} className="text-sm">
                                      <div className="font-medium">{audit.title}</div>
                                      <div className="text-muted-foreground text-xs">{audit.description}</div>
                                    </label>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="flex justify-end space-x-2">
                              <Button
                                variant="outline"
                                onClick={() => setShowSaveDialog(false)}
                                disabled={saving}
                              >
                                Cancel
                              </Button>
                              <Button onClick={saveSelectedTasks} disabled={saving}>
                                {saving ? "Saving..." : `Save ${selectedAudits.length} Tasks`}
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>

                  {failedAudits.length === 0 ? (
                    <Card>
                      <CardContent className="flex items-center justify-center py-12">
                        <div className="text-center">
                          <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
                          <h3 className="text-lg font-semibold mb-2">Excellent SEO Performance!</h3>
                          <p className="text-muted-foreground">
                            No critical SEO issues were found in the analysis.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Accordion type="single" collapsible className="space-y-4">
                      {failedAudits.map(([auditId, audit]) => (
                        <AccordionItem key={auditId} value={auditId}>
                          <Card>
                            <AccordionTrigger className="px-6 py-4">
                              <div className="flex items-center gap-3 text-left">
                                <AlertCircle className={`h-5 w-5 ${audit.score === 0 ? 'text-destructive' : 'text-warning'}`} />
                                <div>
                                  <div className="font-semibold">{audit.title}</div>
                                  <div className="text-sm text-muted-foreground">
                                    {audit.score === 0 ? 'Critical Issue' : 'Needs Improvement'}
                                  </div>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-6 pb-4">
                              <div className="space-y-3">
                                <p className="text-muted-foreground">{audit.description}</p>
                                {audit.displayValue && (
                                  <div className="text-sm">
                                    <strong>Current Value:</strong> {audit.displayValue}
                                  </div>
                                )}
                                {audit.details?.items && audit.details.items.length > 0 && (
                                  <div className="text-sm">
                                    <strong>Affected Resources:</strong>
                                    <ul className="list-disc list-inside mt-1 space-y-1">
                                      {audit.details.items.slice(0, 5).map((item: any, index: number) => (
                                        <li key={index} className="text-xs text-muted-foreground truncate">
                                          {item.url || item.node?.snippet || JSON.stringify(item).substring(0, 100)}
                                        </li>
                                      ))}
                                      {audit.details.items.length > 5 && (
                                        <li className="text-xs text-muted-foreground">
                                          ... and {audit.details.items.length - 5} more
                                        </li>
                                      )}
                                    </ul>
                                  </div>
                                )}
                                <Badge variant="outline">
                                  {getCategoryForAudit(auditId)}
                                </Badge>
                              </div>
                            </AccordionContent>
                          </Card>
                        </AccordionItem>
                      ))}
                    </Accordion>
                   )}
                 </div>
               </TabsContent>
             </Tabs>
           </div>
         )}
       </div>
     </div>
   );
 }