import {
  createApiError,
  requestFailure,
  type RequestFailureInfo,
} from '@/lib/api-error';
import { RequestFailure } from '@/components/request-failure';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/toast';
import { documentsApi, type DocumentDetail } from '@/lib/api';

interface EditContentDialogProps {
  doc: DocumentDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (doc: DocumentDetail) => void;
}

export function EditContentDialog({
  doc,
  open,
  onOpenChange,
  onSaved,
}: EditContentDialogProps) {
  const [markdown, setMarkdown] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<RequestFailureInfo | null>(null);

  useEffect(() => {
    if (doc && open) {
      setMarkdown(doc.content?.markdown ?? '');
      setFailure(null);
    }
  }, [doc, open]);

  const save = async () => {
    if (!doc) return;
    if (!markdown.trim()) {
      setFailure(requestFailure(createApiError('CONTENT_REQUIRED')));
      return;
    }
    setFailure(null);
    setSaving(true);
    try {
      const updated = await documentsApi.updateContent(doc.id, markdown);
      toast(`已生成 v${updated.version} 草稿`);
      onOpenChange(false);
      onSaved(updated);
    } catch (e) {
      setFailure(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div>
            <DialogTitle>编辑正文</DialogTitle>
            <DialogDescription className="mt-1">
              保存后生成新的 content_id，版本号 +1 并回到草稿状态。
            </DialogDescription>
          </div>
        </DialogHeader>
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="min-h-[320px] font-mono text-[12.5px]"
          placeholder="# 在这里编写 Markdown 正文…"
        />
        {failure && (
          <div className="mt-4">
            <RequestFailure title="暂时无法保存" failure={failure} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存为新版本'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
