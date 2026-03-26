import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

interface AddKeywordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess: () => void;
}

export function AddKeywordsDialog({ open, onOpenChange, projectId, onSuccess }: AddKeywordsDialogProps) {
  const [keywordsInput, setKeywordsInput] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("desktop");
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    const keywords = keywordsInput
      .split('\n')
      .map(kw => kw.trim())
      .filter(kw => kw.length > 0);

    if (keywords.length === 0) {
      toast({
        title: "No keywords",
        description: "Please enter at least one keyword",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const keywordsToAdd = keywords.map(keyword => ({
        keyword,
        location_code: parseInt(location),
        language_code: language,
        device,
        target_url: targetUrl || null
      }));

      const { data, error } = await supabase.functions.invoke('add-tracked-keywords', {
        body: {
          project_id: projectId,
          keywords: keywordsToAdd
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Added ${data.count} keywords to tracking`,
      });

      // Reset form
      setKeywordsInput("");
      setTargetUrl("");
      onSuccess();
    } catch (error: any) {
      console.error('Error adding keywords:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to add keywords",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Keywords to Track</DialogTitle>
          <DialogDescription>
            Enter keywords to monitor their ranking positions over time. Add one keyword per line.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="keywords">Keywords (one per line)</Label>
            <Textarea
              id="keywords"
              placeholder="seo tools&#10;keyword research&#10;rank tracking"
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              rows={6}
              className="mt-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="location" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.slice(0, 20).map((loc) => (
                    <SelectItem key={loc.value} value={loc.value.toString()}>
                      {loc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.slice(0, 10).map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="device">Device</Label>
            <Select value={device} onValueChange={setDevice}>
              <SelectTrigger id="device" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="targetUrl">Target URL (Optional)</Label>
            <Input
              id="targetUrl"
              type="url"
              placeholder="https://example.com/page"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Track rankings for a specific URL. Leave empty to track any ranking from your domain.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Adding..." : "Add Keywords"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
