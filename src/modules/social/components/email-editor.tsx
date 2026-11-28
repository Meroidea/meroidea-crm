'use client';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import {
  EMAIL_COLORS,
  EMAIL_FONTS,
  EMAIL_HIGHLIGHTS,
  EMAIL_IMAGE_MAX_WIDTH,
  emailDocEditorHtml,
  safeHref,
  type EmailDoc,
} from '../email-doc';
import { domToEmailDoc, type DomLike } from '../email-editor-dom';

/*
 * The formatted text area of Compose (ADR-090): a browser editing surface with a toolbar of the
 * formats an email document can hold. What is typed is read back as a document
 * (`domToEmailDoc`), never sent as HTML. Pasting keeps the words only, so a page or a Word
 * document cannot bring its own markup, pictures or scripts in.
 */

export type EmailEditorHandle = {
  /** The text as an email document. */
  read: () => EmailDoc;
  focus: () => void;
  /** Replaces the text with a document (a draft, a forwarded email). */
  load: (doc: EmailDoc) => void;
  /** Adds a document at the end (a signature), with an empty line before it. */
  append: (doc: EmailDoc) => void;
};

/** Where a picture in the writer's own Compose folder is shown from, in the editor. */
export const composeFileUrl = (path: string) =>
  `/api/social/compose-file/${encodeURIComponent(path.split('/').pop() ?? '')}`;

const PICTURE_SIZES = [
  { label: 'Small', width: 200 },
  { label: 'Medium', width: 400 },
  { label: 'Large', width: EMAIL_IMAGE_MAX_WIDTH },
] as const;

const STYLES = [
  { value: 'p', label: 'Normal' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'blockquote', label: 'Quote' },
] as const;

/** The browser's 1–7 font sizes for the email's four. */
const SIZES = [
  { value: '2', label: 'Small' },
  { value: '3', label: 'Normal' },
  { value: '4', label: 'Large' },
  { value: '6', label: 'Huge' },
] as const;

const COLOR_NAMES: Record<keyof typeof EMAIL_COLORS, string> = {
  black: 'Black',
  gray: 'Grey',
  red: 'Red',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};
const HIGHLIGHT_NAMES: Record<keyof typeof EMAIL_HIGHLIGHTS, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
};

type Toggle =
  'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList';
const TOGGLES: Toggle[] = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'insertUnorderedList',
  'insertOrderedList',
];

/** "example.com" → "https://example.com/", "kim@example.com" → "mailto:…"; else as typed. */
function linkTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(trimmed)) return safeHref(`mailto:${trimmed}`);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return safeHref(`https://${trimmed}`);
  return safeHref(trimmed);
}

export const EmailEditor = forwardRef<
  EmailEditorHandle,
  {
    /** Called on every change, so Compose knows the email has been started. */
    onInput?: () => void;
    /** Files dropped or pasted on the text that are not pictures: attached. */
    onFiles?: (files: File[]) => void;
    /**
     * Uploads a picture for the text to the writer's Compose folder and returns its path, or
     * null when it could not be uploaded (the caller says why). Without it, no pictures.
     */
    onPicture?: (file: File) => Promise<string | null>;
    /** What the editor opens with: a draft, a forwarded email, a signature. */
    initialDoc?: EmailDoc | null;
    /** A smaller text area, for the reply box. */
    compact?: boolean;
    disabled?: boolean;
    'aria-labelledby'?: string;
  }
>(function EmailEditor(
  { onInput, onFiles, onPicture, initialDoc, compact, disabled, ...aria },
  ref,
) {
  const area = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<Set<Toggle>>(new Set());
  const [menu, setMenu] = useState<'color' | 'highlight' | 'link' | 'table' | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [inTable, setInTable] = useState(false);
  const picture = useRef<HTMLImageElement | null>(null);
  /** The selected picture's width, or null when no picture is selected. */
  const [pictureWidth, setPictureWidth] = useState<number | null>(null);
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3, header: true });

  useImperativeHandle(ref, () => ({
    read: () => (area.current ? domToEmailDoc(area.current as unknown as DomLike) : []),
    focus: () => area.current?.focus(),
    load: (doc) => {
      // Markup built here from a checked document, every character escaped (email-doc.ts).
      if (area.current) area.current.innerHTML = emailDocEditorHtml(doc, composeFileUrl);
    },
    append: (doc) => {
      if (!area.current || doc.length === 0) return;
      area.current.insertAdjacentHTML(
        'beforeend',
        `<p><br></p>${emailDocEditorHtml(doc, composeFileUrl)}`,
      );
    },
  }));

  useEffect(() => {
    if (initialDoc && area.current && !area.current.hasChildNodes()) {
      area.current.innerHTML = emailDocEditorHtml(initialDoc, composeFileUrl);
    }
    // Only what it opens with: later changes come through `load` and `append`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Tags (<b>, <font color>) rather than inline CSS where the browser offers the choice, and
    // <p> for each new line, so what is read back matches what the toolbar shows.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('defaultParagraphSeparator', false, 'p');
    const onSelection = () => {
      const selection = document.getSelection();
      if (!selection?.anchorNode || !area.current?.contains(selection.anchorNode)) return;
      setActive(new Set(TOGGLES.filter((command) => document.queryCommandState(command))));
      const node = selection.anchorNode;
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
      setInTable(Boolean(element?.closest('td, th')));
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  /** Keeps the selection while a toolbar control has focus, to apply the format to it. */
  const keepSelection = () => {
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0 && area.current?.contains(selection.anchorNode)) {
      saved.current = selection.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    area.current?.focus();
    const range = saved.current;
    if (!range) return;
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const run = (command: string, value?: string) => {
    if (disabled) return;
    restoreSelection();
    document.execCommand(command, false, value);
    keepSelection();
    setActive(new Set(TOGGLES.filter((name) => document.queryCommandState(name))));
    onInput?.();
  };

  const openLink = () => {
    keepSelection();
    const anchor = document.getSelection()?.anchorNode?.parentElement?.closest('a');
    setLink(anchor?.getAttribute('href') ?? '');
    setLinkError(null);
    setMenu('link');
  };

  const insertLink = () => {
    const href = linkTarget(link);
    if (!href) {
      setLinkError('Enter a web address (https://…) or an email address.');
      return;
    }
    restoreSelection();
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) {
      document.execCommand('createLink', false, href);
    } else if (selection && selection.rangeCount > 0) {
      // No text chosen: the address itself becomes the link's words. Built with DOM nodes, so
      // nothing typed is ever read as markup.
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = link.trim();
      const range = selection.getRangeAt(0);
      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setMenu(null);
    setLink('');
    onInput?.();
  };

  /** The block under the editable area that holds the caret (a paragraph, list, table…). */
  const caretBlock = (): Element | null => {
    const node = saved.current?.startContainer ?? null;
    let element = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    while (element && element.parentElement !== area.current) element = element.parentElement;
    return element && area.current?.contains(element) ? element : null;
  };

  /** Puts a block after the caret's block (or at the end), followed by an empty line to type on. */
  const insertBlock = (block: HTMLElement) => {
    if (!area.current) return;
    restoreSelection();
    const after = caretBlock();
    const line = document.createElement('p');
    line.appendChild(document.createElement('br'));
    if (after) after.after(block, line);
    else area.current.append(block, line);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(line, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    keepSelection();
    onInput?.();
  };

  const insertTable = () => {
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    for (let row = 0; row < tableSize.rows; row += 1) {
      const tr = document.createElement('tr');
      for (let col = 0; col < tableSize.cols; col += 1) {
        const cell = document.createElement(tableSize.header && row === 0 ? 'th' : 'td');
        cell.appendChild(document.createElement('br'));
        tr.appendChild(cell);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    setMenu(null);
    insertBlock(table);
  };

  /** The cell the caret is in, if any. */
  const currentCell = (): HTMLTableCellElement | null => {
    const node = saved.current?.startContainer ?? document.getSelection()?.anchorNode ?? null;
    const element = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    const cell = element?.closest('td, th') as HTMLTableCellElement | null;
    return cell && area.current?.contains(cell) ? cell : null;
  };

  const editTable = (action: 'row' | 'col' | 'delete-row' | 'delete-col' | 'delete') => {
    const cell = currentCell();
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest('table');
    if (!cell || !row || !table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const column = Array.from(row.children).indexOf(cell);
    if (action === 'row' && rows.length < 50) {
      const copy = document.createElement('tr');
      for (let index = 0; index < row.children.length; index += 1) {
        copy.appendChild(document.createElement('td')).appendChild(document.createElement('br'));
      }
      row.after(copy);
    } else if (action === 'col' && row.children.length < 10) {
      for (const each of rows) {
        const reference = each.children[column];
        const fresh = document.createElement(reference?.tagName === 'TH' ? 'th' : 'td');
        fresh.appendChild(document.createElement('br'));
        if (reference) reference.after(fresh);
        else each.appendChild(fresh);
      }
    } else if (action === 'delete-row') {
      if (rows.length <= 1) table.remove();
      else row.remove();
    } else if (action === 'delete-col') {
      if (row.children.length <= 1) table.remove();
      else for (const each of rows) each.children[column]?.remove();
    } else if (action === 'delete') {
      table.remove();
    }
    if (!table.isConnected) setInTable(false);
    onInput?.();
  };

  const addPictures = async (files: File[]) => {
    if (!onPicture) return;
    for (const file of files) {
      const path = await onPicture(file);
      if (!path) continue;
      const image = document.createElement('img');
      image.src = composeFileUrl(path);
      image.dataset.path = path;
      image.alt = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
      image.width = 400;
      const holder = document.createElement('p');
      holder.appendChild(image);
      insertBlock(holder);
    }
  };

  /** Pictures go into the text (when the editor takes them); other files are attached. */
  const takeFiles = (files: File[]) => {
    const pictures = onPicture ? files.filter((file) => file.type.startsWith('image/')) : [];
    const others = files.filter((file) => !pictures.includes(file));
    if (pictures.length > 0) {
      keepSelection();
      void addPictures(pictures);
    }
    if (others.length > 0) onFiles?.(others);
  };

  const sizePicture = (width: number) => {
    if (!picture.current) return;
    picture.current.width = width;
    setPictureWidth(width);
    onInput?.();
  };

  const divider = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
  const selectClass =
    'h-8 rounded-md border-0 bg-transparent px-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="relative flex flex-wrap items-center gap-0.5 border-b px-2 py-1"
      >
        <ToolButton
          label={'Undo'}
          icon={Undo2}
          onClick={() => run('undo')}
          shortcut={'Ctrl+Z'}
          disabled={disabled}
        />
        <ToolButton
          label={'Redo'}
          icon={Redo2}
          onClick={() => run('redo')}
          shortcut={'Ctrl+Y'}
          disabled={disabled}
        />
        {divider}
        <select
          aria-label="Paragraph style"
          className={selectClass}
          disabled={disabled}
          defaultValue=""
          onMouseDown={keepSelection}
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = '';
            if (value) run('formatBlock', `<${value}>`);
          }}
        >
          <option value="" disabled>
            Style
          </option>
          {STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Text size"
          className={selectClass}
          disabled={disabled}
          defaultValue=""
          onMouseDown={keepSelection}
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = '';
            if (value) run('fontSize', value);
          }}
        >
          <option value="" disabled>
            Size
          </option>
          {SIZES.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Font"
          className={selectClass}
          disabled={disabled}
          defaultValue=""
          onMouseDown={keepSelection}
          onChange={(event) => {
            const value = event.target.value;
            event.target.value = '';
            if (value) run('fontName', value);
          }}
        >
          <option value="" disabled>
            Font
          </option>
          {Object.values(EMAIL_FONTS).map((font) => (
            <option key={font.label} value={font.label} style={{ fontFamily: font.stack }}>
              {font.label}
            </option>
          ))}
        </select>
        {divider}
        <ToolButton
          label={'Bold'}
          icon={Bold}
          onClick={() => run('bold')}
          pressed={active.has('bold')}
          shortcut={'Ctrl+B'}
          disabled={disabled}
        />
        <ToolButton
          label={'Italic'}
          icon={Italic}
          onClick={() => run('italic')}
          pressed={active.has('italic')}
          shortcut={'Ctrl+I'}
          disabled={disabled}
        />
        <ToolButton
          label={'Underline'}
          icon={Underline}
          onClick={() => run('underline')}
          pressed={active.has('underline')}
          shortcut={'Ctrl+U'}
          disabled={disabled}
        />
        <ToolButton
          label={'Strikethrough'}
          icon={Strikethrough}
          onClick={() => run('strikeThrough')}
          pressed={active.has('strikeThrough')}
          disabled={disabled}
        />
        <span className="relative inline-flex">
          <ToolButton
            label={'Text colour'}
            icon={Baseline}
            onClick={() => {
              keepSelection();
              setMenu(menu === 'color' ? null : 'color');
            }}
            disabled={disabled}
          />
          {menu === 'color' && (
            <Swatches
              label="Text colour"
              colors={Object.entries(EMAIL_COLORS).map(([key, value]) => ({
                value,
                name: COLOR_NAMES[key as keyof typeof EMAIL_COLORS],
              }))}
              onPick={(value) => {
                setMenu(null);
                run('foreColor', value);
              }}
            />
          )}
        </span>
        <span className="relative inline-flex">
          <ToolButton
            label={'Highlight'}
            icon={Highlighter}
            onClick={() => {
              keepSelection();
              setMenu(menu === 'highlight' ? null : 'highlight');
            }}
            disabled={disabled}
          />
          {menu === 'highlight' && (
            <Swatches
              label="Highlight"
              colors={Object.entries(EMAIL_HIGHLIGHTS).map(([key, value]) => ({
                value,
                name: HIGHLIGHT_NAMES[key as keyof typeof EMAIL_HIGHLIGHTS],
              }))}
              onPick={(value) => {
                setMenu(null);
                run('backColor', value);
              }}
              onClear={() => {
                setMenu(null);
                run('backColor', 'transparent');
              }}
            />
          )}
        </span>
        {divider}
        <ToolButton
          label={'Bulleted list'}
          icon={List}
          onClick={() => run('insertUnorderedList')}
          pressed={active.has('insertUnorderedList')}
          disabled={disabled}
        />
        <ToolButton
          label={'Numbered list'}
          icon={ListOrdered}
          onClick={() => run('insertOrderedList')}
          pressed={active.has('insertOrderedList')}
          disabled={disabled}
        />
        <ToolButton
          label={'Align left'}
          icon={AlignLeft}
          onClick={() => run('justifyLeft')}
          disabled={disabled}
        />
        <ToolButton
          label={'Centre'}
          icon={AlignCenter}
          onClick={() => run('justifyCenter')}
          disabled={disabled}
        />
        <ToolButton
          label={'Align right'}
          icon={AlignRight}
          onClick={() => run('justifyRight')}
          disabled={disabled}
        />
        {divider}
        <ToolButton
          label={'Insert link'}
          icon={LinkIcon}
          onClick={openLink}
          shortcut={'Ctrl+K'}
          disabled={disabled}
        />
        <ToolButton
          label={'Remove link'}
          icon={Unlink}
          onClick={() => run('unlink')}
          disabled={disabled}
        />
        <ToolButton
          label={'Horizontal line'}
          icon={Minus}
          onClick={() => run('insertHorizontalRule')}
          disabled={disabled}
        />
        <span className="relative inline-flex">
          <ToolButton
            label="Insert table"
            icon={TableIcon}
            onClick={() => {
              keepSelection();
              setMenu(menu === 'table' ? null : 'table');
            }}
            disabled={disabled}
          />
          {menu === 'table' && (
            <div
              role="dialog"
              aria-label="Insert table"
              className="absolute top-9 right-0 z-20 flex w-56 flex-col gap-2 rounded-lg border bg-popover p-3 text-sm shadow-md sm:right-auto sm:left-0"
            >
              <label className="flex items-center justify-between gap-2">
                Rows
                <Input
                  type="number"
                  min={1}
                  max={50}
                  className="h-8 w-20"
                  value={tableSize.rows}
                  onChange={(event) =>
                    setTableSize({
                      ...tableSize,
                      rows: Math.min(50, Math.max(1, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                Columns
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="h-8 w-20"
                  value={tableSize.cols}
                  onChange={(event) =>
                    setTableSize({
                      ...tableSize,
                      cols: Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={tableSize.header}
                  onChange={(event) => setTableSize({ ...tableSize, header: event.target.checked })}
                />
                First row is a header
              </label>
              <Button type="button" size="sm" onClick={insertTable}>
                Insert
              </Button>
            </div>
          )}
        </span>
        {onPicture && (
          <>
            <ToolButton
              label="Insert picture"
              icon={ImagePlus}
              onClick={() => {
                keepSelection();
                pictureInput.current?.click();
              }}
              disabled={disabled}
            />
            <input
              ref={pictureInput}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) void addPictures(files);
              }}
            />
          </>
        )}
        <ToolButton
          label={'Clear formatting'}
          icon={RemoveFormatting}
          onClick={() => {
            run('removeFormat');
            run('formatBlock', '<p>');
          }}
          disabled={disabled}
        />
      </div>

      {(inTable || pictureWidth !== null) && !disabled && (
        <div
          role="toolbar"
          aria-label={pictureWidth !== null ? 'Picture' : 'Table'}
          className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1 text-sm"
        >
          {pictureWidth !== null ? (
            <>
              <span className="px-1 text-muted-foreground">Picture size</span>
              {PICTURE_SIZES.map((size) => (
                <Button
                  key={size.width}
                  type="button"
                  size="sm"
                  variant={pictureWidth === size.width ? 'secondary' : 'ghost'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => sizePicture(size.width)}
                >
                  {size.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const element = picture.current;
                  if (element) {
                    const holder = element.closest('p');
                    if (holder && holder.textContent?.trim() === '') holder.remove();
                    else element.remove();
                  }
                  picture.current = null;
                  setPictureWidth(null);
                  onInput?.();
                }}
              >
                <Trash2 aria-hidden /> Remove picture
              </Button>
            </>
          ) : (
            <>
              <span className="px-1 text-muted-foreground">Table</span>
              {(
                [
                  ['row', 'Add row'],
                  ['col', 'Add column'],
                  ['delete-row', 'Delete row'],
                  ['delete-col', 'Delete column'],
                  ['delete', 'Delete table'],
                ] as const
              ).map(([action, label]) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    keepSelection();
                  }}
                  onClick={() => editTable(action)}
                >
                  {label}
                </Button>
              ))}
            </>
          )}
        </div>
      )}

      {menu === 'link' && (
        <form
          className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            insertLink();
          }}
        >
          <label htmlFor="compose-link" className="text-sm">
            Link to
          </label>
          <Input
            id="compose-link"
            autoFocus
            className="h-8 max-w-sm flex-1"
            placeholder="https://example.com or name@example.com"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenu(null);
            }}
          />
          <Button type="submit" size="sm">
            Insert
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMenu(null)}>
            Cancel
          </Button>
          {linkError && (
            <p role="alert" className="w-full text-xs text-destructive-text">
              {linkError}
            </p>
          )}
        </form>
      )}

      <div
        ref={area}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={aria['aria-labelledby']}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder="Write your email"
        data-sensitive
        className={cn(
          'email-rich flex-1 overflow-y-auto px-4 py-3 text-[15px] leading-relaxed outline-none',
          compact ? 'max-h-80 min-h-28' : 'min-h-64',
          disabled && 'opacity-60',
        )}
        onInput={() => onInput?.()}
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          // Handled here rather than left to the browser, which does not map them everywhere.
          const shortcut = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()];
          if (shortcut && !event.shiftKey) {
            event.preventDefault();
            document.execCommand(shortcut);
            setActive(new Set(TOGGLES.filter((name) => document.queryCommandState(name))));
            onInput?.();
            return;
          }
          if (event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openLink();
          }
        }}
        onPaste={(event) => {
          // The words only: another page's or a document's markup never comes in.
          event.preventDefault();
          const plain = event.clipboardData.getData('text/plain');
          if (plain) document.execCommand('insertText', false, plain);
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0) takeFiles(files);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) takeFiles(files);
        }}
        onClick={(event) => {
          // Clicking a picture selects it, for its size and removal.
          const target = event.target as HTMLElement;
          picture.current?.classList.remove('is-selected');
          if (target.tagName === 'IMG' && area.current?.contains(target)) {
            const image = target as HTMLImageElement;
            image.classList.add('is-selected');
            picture.current = image;
            setPictureWidth(image.width);
          } else {
            picture.current = null;
            setPictureWidth(null);
          }
        }}
        onBlur={keepSelection}
      />
    </div>
  );
});

function ToolButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  shortcut,
  disabled,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  pressed?: boolean;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-8', pressed && 'bg-accent text-foreground')}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Keep the text's selection: a button press would otherwise move focus off it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon aria-hidden className="size-4" />
    </Button>
  );
}

function Swatches({
  label,
  colors,
  onPick,
  onClear,
}: {
  label: string;
  colors: { value: string; name: string }[];
  onPick: (value: string) => void;
  onClear?: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label={label}
      className="absolute top-9 left-0 z-20 flex items-center gap-1 rounded-lg border bg-popover p-2 shadow-md"
    >
      {colors.map((color) => (
        <button
          key={color.value}
          type="button"
          role="menuitem"
          title={color.name}
          aria-label={color.name}
          className="size-6 rounded-full border border-border focus-visible:ring-2 focus-visible:ring-ring"
          // Email colours are content written into the email, not the app's theme.
          style={{ backgroundColor: color.value }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color.value)}
        />
      ))}
      {onClear && (
        <button
          type="button"
          role="menuitem"
          className="ml-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClear}
        >
          None
        </button>
      )}
    </div>
  );
}
