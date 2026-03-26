import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SpiderIcon } from '@/components/icons/SpiderIcon';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ImagePlus, X } from 'lucide-react';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const feedbackSchema = z.object({
  type: z.enum(['bug', 'feature']),
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Please provide more detail (at least 10 characters)').max(5000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  screenshot_info: z.string().max(2000).optional(),
});

type FeedbackFormData = z.infer<typeof feedbackSchema>;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function FeedbackBubble() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FeedbackFormData>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      type: 'bug',
      severity: 'medium',
      title: '',
      description: '',
      screenshot_info: '',
    },
  });

  const watchType = form.watch('type');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Image must be under 5MB');
      return;
    }

    setScreenshotFile(file);
    const preview = URL.createObjectURL(file);
    setScreenshotPreview(preview);
  };

  const clearScreenshot = () => {
    setScreenshotFile(null);
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = async (data: FeedbackFormData) => {
    setSubmitting(true);
    try {
      let screenshot_data: string | undefined;
      let screenshot_name: string | undefined;

      if (screenshotFile) {
        screenshot_data = await fileToDataUrl(screenshotFile);
        screenshot_name = screenshotFile.name;
      }

      await api('/api/feedback', {
        method: 'POST',
        body: {
          ...data,
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          screenshot_data,
          screenshot_name,
        },
      });
      toast.success('Thanks for your feedback!');
      form.reset();
      clearScreenshot();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
        aria-label="Report a bug or request a feature"
      >
        <SpiderIcon size={34} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <SpiderIcon size={20} />
              Report Bug or Request Feature
            </SheetTitle>
            <SheetDescription>
              Help us improve by reporting issues or suggesting new features.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
            {/* Type toggle */}
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={watchType === 'bug' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => form.setValue('type', 'bug')}
                >
                  Bug Report
                </Button>
                <Button
                  type="button"
                  variant={watchType === 'feature' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => form.setValue('type', 'feature')}
                >
                  Feature Request
                </Button>
              </div>
            </div>

            {/* Severity (only for bugs) */}
            {watchType === 'bug' && (
              <div className="space-y-2">
                <Label htmlFor="severity">Severity</Label>
                <Select
                  value={form.watch('severity')}
                  onValueChange={(val) => form.setValue('severity', val as FeedbackFormData['severity'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder={watchType === 'bug' ? 'Brief summary of the issue' : 'What feature would you like?'}
                {...form.register('title')}
              />
              {form.formState.errors.title && (
                <p className="text-sm text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={5}
                placeholder={
                  watchType === 'bug'
                    ? 'What happened? What did you expect to happen? Steps to reproduce...'
                    : 'Describe the feature you would like and how it would help you...'
                }
                {...form.register('description')}
              />
              {form.formState.errors.description && (
                <p className="text-sm text-destructive">{form.formState.errors.description.message}</p>
              )}
            </div>

            {/* Screenshot upload */}
            <div className="space-y-2">
              <Label>Screenshot (optional)</Label>
              {screenshotPreview ? (
                <div className="relative">
                  <img
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    className="w-full rounded-md border object-cover max-h-48"
                  />
                  <button
                    type="button"
                    onClick={clearScreenshot}
                    className="absolute top-1.5 right-1.5 rounded-full bg-background/80 p-1 hover:bg-background shadow"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
                >
                  <ImagePlus className="h-5 w-5" />
                  Click to upload a screenshot
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Additional context */}
            <div className="space-y-2">
              <Label htmlFor="screenshot_info">Additional Context (optional)</Label>
              <Textarea
                id="screenshot_info"
                rows={2}
                placeholder="Any extra details that might help..."
                {...form.register('screenshot_info')}
              />
            </div>

            {/* Auto-captured info note */}
            <p className="text-xs text-muted-foreground">
              Your current page URL and browser info will be included automatically.
            </p>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
