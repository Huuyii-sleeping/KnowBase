import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/toast';
import { documentsApi } from '@/lib/api';
import { formatBytes } from '@/lib/format';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function UploadDialog({ open, onOpenChange, onCreated }: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [team, setTeam] = useState('');
  const [tags, setTags] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setTitle('');
    setCategory('');
    setTeam('');
    setTags('');
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!file) {
      toast('请先选择文件', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await documentsApi.create(file, {
        title: title.trim() || undefined,
        category: category.trim() || undefined,
        team: team.trim() || undefined,
        tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      });
      toast('已保存为草稿，等待解析');
      onOpenChange(false);
      reset();
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>上传文档</DialogTitle>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.mp3,.mp4,.wav,.m4a"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <div
          className={`cursor-pointer rounded-lg border-[1.5px] border-dashed px-4 py-7 text-center text-[13px] transition-colors ${
            dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:border-primary hover:bg-primary/5'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
        >
          {file ? (
            <span className="font-medium text-foreground">{file.name} · {formatBytes(file.size)}</span>
          ) : (
            <>
              拖放文件到这里，或点击选择
              <div className="mt-1 text-[12px] text-muted-foreground/70">
                支持 PDF / DOCX / PPTX / XLSX / TXT / MD / 音视频，单个不超过 100 MB
              </div>
            </>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="up-title">标题</Label>
            <Input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="默认取文件名" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="up-category">分类</Label>
            <Input id="up-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如：产品" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="up-team">团队</Label>
            <Input id="up-team" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="如：平台组" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="up-tags">标签</Label>
            <Input id="up-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={submitting || !file}>
            {submitting ? '上传中…' : '保存为草稿'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
