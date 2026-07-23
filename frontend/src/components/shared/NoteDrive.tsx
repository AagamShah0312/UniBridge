import { FileText, Folder, FolderOpen, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

export type DriveFolder = { id: string; name: string; parentId?: string | null; isSystem?: boolean }
export type DriveFile = { id: string; title: string; description?: string | null; mimeType?: string; originalFileName?: string | null; fileSizeKb?: number | null; status?: string; releaseAt?: string; uploadedBy?: string; hasAiSummary?: boolean; createdAt?: string }

export function NoteDrive({
  breadcrumbs, folders, files, faculty = false, onOpenFolder, onBreadcrumb, onCreateFolder, onUpload, onRenameFolder, onDeleteFolder, onDownload, onSummary, onEditFile, onDeleteFile,
}: {
  breadcrumbs: { id: string | null; name: string }[]
  folders: DriveFolder[]
  files: DriveFile[]
  faculty?: boolean
  onOpenFolder: (id: string) => void
  onBreadcrumb: (id: string | null) => void
  onCreateFolder?: () => void
  onUpload?: () => void
  onRenameFolder?: (folder: DriveFolder) => void
  onDeleteFolder?: (folder: DriveFolder) => void
  onDownload?: (file: DriveFile) => void
  onSummary?: (file: DriveFile) => void
  onEditFile?: (file: DriveFile) => void
  onDeleteFile?: (file: DriveFile) => void
}) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav className="flex min-w-0 items-center gap-1 text-sm text-text-secondary" aria-label="Folder path">
        {breadcrumbs.map((crumb, index) => <span key={`${crumb.id ?? 'root'}-${index}`} className="flex items-center gap-1">
          {index > 0 && <span className="text-text-muted">/</span>}
          <button onClick={() => onBreadcrumb(crumb.id)} className={cn('truncate rounded px-1.5 py-1 hover:bg-surface-hover', index === breadcrumbs.length - 1 && 'font-semibold text-text-primary')}>{crumb.name}</button>
        </span>)}
      </nav>
      <div className="flex gap-2">
        {faculty && onCreateFolder && <Button size="sm" variant="outline" leftIcon={<Plus size={14} />} onClick={onCreateFolder}>New folder</Button>}
        {faculty && onUpload && <Button size="sm" leftIcon={<Upload size={14} />} onClick={onUpload}>Upload</Button>}
      </div>
    </div>

    {folders.length > 0 && <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Folders</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((folder) => <Card key={folder.id} className="group flex cursor-pointer items-center gap-3 p-3 transition hover:border-primary/40 hover:shadow-card-hover" onClick={() => onOpenFolder(folder.id)}>
          <FolderOpen size={22} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{folder.name}</span>
          {faculty && !folder.isSystem && <span className="flex gap-1 opacity-0 transition group-hover:opacity-100">
            {onRenameFolder && <button className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-primary" title="Rename" onClick={(e) => { e.stopPropagation(); onRenameFolder(folder) }}><Pencil size={14} /></button>}
            {onDeleteFolder && <button className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-danger" title="Delete" onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder) }}><Trash2 size={14} /></button>}
          </span>}
        </Card>)}
      </div>
    </section>}

    <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Files</div>
      {files.length === 0 ? <div className="rounded-card border border-dashed border-border p-8 text-center text-sm text-text-muted"><Folder size={26} className="mx-auto mb-2 opacity-50" />This folder is empty.</div> :
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {files.map((file) => <div key={file.id} className="flex items-center gap-3 border-b border-border-light px-4 py-3 last:border-0 hover:bg-surface-hover">
            <FileText size={19} className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-text-primary">{file.title}</div><div className="truncate text-xs text-text-muted">{file.originalFileName ?? file.mimeType ?? 'file'}{file.uploadedBy ? ` · ${file.uploadedBy}` : ''}</div></div>
            <div className="hidden text-xs text-text-muted sm:block">{file.status === 'SCHEDULED' ? 'Scheduled' : ''}</div>
            {onSummary && <Button size="sm" variant="ghost" className="h-8 w-8 px-0 text-primary hover:bg-primary-light" onClick={() => onSummary(file)} title="Generate AI summary" aria-label={`Generate AI summary for ${file.title}`}><Sparkles size={17} strokeWidth={2.25} /></Button>}
            {onDownload && <Button size="sm" variant="outline" onClick={() => onDownload(file)}>Open</Button>}
            {faculty && onEditFile && <button title="Edit" className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-primary" onClick={() => onEditFile(file)}><Pencil size={14} /></button>}
            {faculty && onDeleteFile && <button title="Delete" className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-danger" onClick={() => onDeleteFile(file)}><Trash2 size={14} /></button>}
            {faculty && <MoreHorizontal size={17} className="text-text-muted" />}
          </div>)}
        </div>}
    </section>
  </div>
}
