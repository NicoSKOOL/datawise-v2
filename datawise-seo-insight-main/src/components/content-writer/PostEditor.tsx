import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import {
  Bold, Italic, Heading1, Heading2, Heading3, Heading4, List, ListOrdered,
  Link as LinkIcon, Quote, Code, Table as TableIcon, Columns, Rows, Trash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { htmlToMarkdown } from '@/lib/markdown';

interface PostEditorProps {
  initialHtml: string;
  onChange?: (html: string, markdown: string) => void;
  placeholder?: string;
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (active: boolean, onClick: () => void, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      className="h-8 w-8 p-0"
      onClick={onClick}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
  const inTable = editor.isActive('table');
  const sep = <span className="mx-1 h-5 w-px bg-border" aria-hidden />;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold', Bold)}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic', Italic)}
      {sep}
      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), 'H1', Heading1)}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', Heading2)}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3', Heading3)}
      {btn(editor.isActive('heading', { level: 4 }), () => editor.chain().focus().toggleHeading({ level: 4 }).run(), 'H4', Heading4)}
      {sep}
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bulleted list', List)}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list', ListOrdered)}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Quote', Quote)}
      {btn(editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), 'Inline code', Code)}
      {btn(editor.isActive('link'), () => {
        const previous = editor.getAttributes('link').href as string | undefined;
        const url = window.prompt('URL', previous || 'https://');
        if (url === null) return;
        if (url === '') {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }, 'Insert link', LinkIcon)}
      {sep}
      {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), 'Insert table (3x3)', TableIcon)}
      {inTable && (
        <>
          {btn(false, () => editor.chain().focus().addColumnAfter().run(), 'Add column', Columns)}
          {btn(false, () => editor.chain().focus().addRowAfter().run(), 'Add row', Rows)}
          {btn(false, () => editor.chain().focus().deleteTable().run(), 'Delete table', Trash)}
        </>
      )}
    </div>
  );
}

export default function PostEditor({ initialHtml, onChange, placeholder }: PostEditorProps) {
  const debounceRef = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'rounded bg-muted p-3' } } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: placeholder || 'Start writing...' }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'cw-table' } }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[400px] px-4 py-4 [&_a]:text-primary [&_a]:underline',
      },
    },
    onUpdate: ({ editor }) => {
      if (!onChange) return;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const html = editor.getHTML();
        const md = htmlToMarkdown(html);
        onChange(html, md);
      }, 500);
    },
  });

  // Sync external initialHtml updates (e.g., a freshly generated draft)
  useEffect(() => {
    if (!editor) return;
    if (initialHtml && editor.getHTML() !== initialHtml) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
  }, [editor, initialHtml]);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  return (
    // White surface for the editor regardless of the surrounding page tone,
    // so the writing area visually pops as the focal element. In dark mode
    // we use the card token (slightly lighter than the page) for the same
    // contrast effect.
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-card">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
