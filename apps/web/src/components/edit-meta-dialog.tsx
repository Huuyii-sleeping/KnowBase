import { useEffect, useState } from 'react';
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
import { documentsApi, type DocumentDetail } from '@/lib/api';

interface EditMetaDialogProps {
  doc: DocumentDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (doc: DocumentDetail) => void;
}

export function EditMetaDialog({ doc, open, onOpenChange, onSaved }: EditMetaDialogProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [team, setTeam] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (doc && open) {
      setTitle(doc.title);
      setCategory(doc.category ?? '');
      setTeam(doc.team ?? '');
      setTags(doc.tags.join(', '));
    }
  }, [doc, open]);

  const save = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      const updated = await documentsApi.update(doc.id, {
        title: title.trim(),
        category: category.trim(),
        team: team.trim(),
        tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      });
      toast('元数据已更新');
      onOpenChange(false);
      onSaved({ ...updated, content: doc.content });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑元数据</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="em-title">标题</Label>
            <Input id="em-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-category">分类</Label>
            <Input id="em-category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-team">团队</Label>
            <Input id="em-team" value={team} onChange={(e) => setTeam(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="em-tags">标签</Label>
            <Input id="em-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="多个标签用逗号分隔" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
