import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, X, Link2, Paperclip, Upload, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  type ActionItem,
  type ActionStatus,
  type Priority,
  type Subtask,
  type Attachment,
  parseSubtasks,
  parseAttachments,
  createTask,
  updateActionItem,
  deleteActionItem,
  uploadTaskAttachment,
} from '@/lib/site-audit';

type Mode = { kind: 'create'; propertyId: string } | { kind: 'edit'; item: ActionItem };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode | null;
  queryKey: readonly unknown[];
}

const CATEGORY_PRESETS = ['Technical', 'Content', 'Links', 'Performance', 'Meta', 'Other'] as const;

const PRIORITY_TRIGGER: Record<Priority, string> = {
  high: 'border-red-500/40 text-red-600 font-medium bg-red-500/5',
  medium: 'border-amber-500/40 text-amber-600 font-medium bg-amber-500/5',
  low: 'border-blue-500/40 text-blue-600 font-medium bg-blue-500/5',
};

function isImageUrl(u: string) {
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(u);
}

export function TaskDetailDialog({ open, onOpenChange, mode, queryKey }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [status, setStatus] = useState<ActionStatus>('todo');
  const [dueDate, setDueDate] = useState<string>('');
  const [howToFix, setHowToFix] = useState('');
  const [notes, setNotes] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newAttachmentUrl, setNewAttachmentUrl] = useState('');
  const [newSubtaskText, setNewSubtaskText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (mode?.kind === 'edit') {
      const it = mode.item;
      setTitle(it.title || '');
      setUrl(it.url || '');
      setCategory(it.category || '');
      setPriority(it.priority);
      setStatus(it.status);
      setDueDate(it.due_date || '');
      setHowToFix(it.how_to_fix || '');
      setNotes(it.notes || '');
      setSubtasks(parseSubtasks(it));
      setAttachments(parseAttachments(it));
    } else {
      setTitle('');
      setUrl('');
      setCategory('');
      setPriority('medium');
      setStatus('todo');
      setDueDate('');
      setHowToFix('');
      setNotes('');
      setSubtasks([]);
      setAttachments([]);
    }
    setNewAttachmentUrl('');
    setNewSubtaskText('');
  }, [open, mode]);

  const createMut = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: 'Task created' });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Failed', description: err?.message }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateActionItem>[1] }) =>
      updateActionItem(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: 'Task updated' });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Failed', description: err?.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteActionItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: 'Task deleted' });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Failed', description: err?.message }),
  });

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending;

  const categoryValue = useMemo(() => {
    if (!category) return '';
    const preset = CATEGORY_PRESETS.find((c) => c.toLowerCase() === category.toLowerCase());
    return preset || 'Other';
  }, [category]);

  function handleSave() {
    if (!title.trim()) {
      toast({ variant: 'destructive', title: 'Title is required' });
      return;
    }
    const finalCategory = category.trim() || null;
    const finalSubtasks = subtasks.filter((s) => s.text.trim().length > 0);
    if (mode?.kind === 'create') {
      createMut.mutate({
        property_id: mode.propertyId,
        title: title.trim(),
        how_to_fix: howToFix,
        category: finalCategory,
        url: url.trim() || null,
        priority,
        status,
        due_date: dueDate || null,
        subtasks: finalSubtasks,
        attachments,
        notes: notes || null,
      });
    } else if (mode?.kind === 'edit') {
      updateMut.mutate({
        id: mode.item.id,
        patch: {
          title: title.trim(),
          how_to_fix: howToFix,
          category: finalCategory,
          url: url.trim() || null,
          priority,
          status,
          due_date: dueDate || null,
          subtasks: finalSubtasks,
          attachments,
          notes: notes || null,
        },
      });
    }
  }

  function handleDelete() {
    if (mode?.kind !== 'edit') return;
    if (!confirm('Delete this task? This cannot be undone.')) return;
    deleteMut.mutate(mode.item.id);
  }

  function addSubtask() {
    const text = newSubtaskText.trim();
    if (!text) return;
    setSubtasks((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
    setNewSubtaskText('');
  }

  function addAttachment() {
    const v = newAttachmentUrl.trim();
    if (!v) return;
    try {
      new URL(v);
    } catch {
      toast({ variant: 'destructive', title: 'Invalid URL' });
      return;
    }
    setAttachments((prev) => [...prev, { url: v, name: v.split('/').pop() || v }]);
    setNewAttachmentUrl('');
  }

  async function handleFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const f of Array.from(files)) {
        const res = await uploadTaskAttachment(f);
        uploaded.push(res);
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err?.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items || []);
    const images = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (images.length === 0) return;
    e.preventDefault();
    await handleFilesChosen(dataTransferFromFiles(images));
  }

  function dataTransferFromFiles(files: File[]): FileList {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    return dt.files;
  }

  const isManual = mode?.kind === 'edit' && mode.item.source === 'manual';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode?.kind === 'create' ? 'New task' : 'Edit task'}
            {mode?.kind === 'edit' && (
              <Badge variant="outline" className="text-[10px] capitalize">{mode.item.source}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix broken link on /pricing" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">URL</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/page" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select
                value={categoryValue}
                onValueChange={(v) => {
                  if (v === 'Other') {
                    setCategory(category && !CATEGORY_PRESETS.includes(category as any) ? category : '');
                  } else {
                    setCategory(v);
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_PRESETS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {categoryValue === 'Other' && (
                <Input
                  className="mt-2"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Custom category"
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className={PRIORITY_TRIGGER[priority]}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="text-red-600 font-medium">High</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      <span className="text-amber-600 font-medium">Medium</span>
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      <span className="text-blue-600 font-medium">Low</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as ActionStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">How to fix</label>
            <Textarea
              value={howToFix}
              onChange={(e) => setHowToFix(e.target.value)}
              placeholder="Steps or context for getting this done"
              rows={3}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Subtasks</label>
              <span className="text-[10px] text-muted-foreground">
                {subtasks.filter((s) => s.done).length} / {subtasks.length} done
              </span>
            </div>
            <div className="space-y-1">
              {subtasks.map((st) => (
                <div key={st.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={st.done}
                    onCheckedChange={(v) =>
                      setSubtasks((prev) => prev.map((s) => (s.id === st.id ? { ...s, done: !!v } : s)))
                    }
                  />
                  {st.url ? (
                    <div
                      className={`flex items-center gap-2 flex-1 min-w-0 h-8 px-2 text-sm rounded-md border bg-muted/30 ${
                        st.done ? 'line-through text-muted-foreground' : ''
                      }`}
                    >
                      <a
                        href={st.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline truncate min-w-0"
                        title={st.url}
                      >
                        <Link2 className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{st.text}</span>
                      </a>
                    </div>
                  ) : (
                    <Input
                      value={st.text}
                      onChange={(e) =>
                        setSubtasks((prev) => prev.map((s) => (s.id === st.id ? { ...s, text: e.target.value } : s)))
                      }
                      className={`h-8 text-sm flex-1 ${st.done ? 'line-through text-muted-foreground' : ''}`}
                    />
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={() => setSubtasks((prev) => prev.filter((s) => s.id !== st.id))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={newSubtaskText}
                  onChange={(e) => setNewSubtaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSubtask();
                    }
                  }}
                  placeholder="Add a subtask and press Enter"
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={addSubtask}><Plus className="h-3 w-3" /></Button>
              </div>
            </div>
          </div>

          <div onPaste={handlePaste}>
            <label className="text-xs font-medium text-muted-foreground">
              Attachments (upload screenshots, paste images, or add URLs)
            </label>
            <div className="space-y-2 mt-1">
              {attachments.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {attachments.map((att, idx) => (
                    <div key={idx} className="flex items-center gap-2 group border rounded-md p-2">
                      {isImageUrl(att.url) ? (
                        <a href={att.url} target="_blank" rel="noreferrer" className="flex-shrink-0">
                          <img src={att.url} alt={att.name || ''} className="h-12 w-12 object-cover rounded" />
                        </a>
                      ) : (
                        <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs truncate flex-1 hover:underline"
                      >
                        {att.name || att.url}
                      </a>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100"
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) {
                    handleFilesChosen(e.dataTransfer.files);
                  }
                }}
                className="border border-dashed rounded-md p-3 text-xs text-muted-foreground flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Uploading…</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Drop files, paste a screenshot, or</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      Choose file
                    </Button>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesChosen(e.target.files)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={newAttachmentUrl}
                  onChange={(e) => setNewAttachmentUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAttachment();
                    }
                  }}
                  placeholder="Or paste an external URL…"
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" variant="outline" onClick={addAttachment}>Add URL</Button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Extra context, links, client questions…"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <div>
            {mode?.kind === 'edit' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={busy}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleSave} disabled={busy}>{mode?.kind === 'create' ? 'Create' : 'Save'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
