import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { documentsApi } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
export function WebImportDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState('');
  const submitting = useRef(false);
  const [mustCheck, setMustCheck] = useState(false);
  useEffect(() => {
    if (!open && !busy) {
      setUrl('');
      setError('');
      setCreated('');
      setMustCheck(false);
    }
  }, [open, busy]);
  const submit = async () => {
    if (submitting.current || created || mustCheck) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await documentsApi.importWeb(url.trim());
      setCreated(result.id);
      onCreated();
    } catch (error) {
      const failure = requestFailure(error, 'upload');
      setError(failure.message);
      setMustCheck(failure.action === 'check_result');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          onOpenChange(value);
          if (!value) {
            setUrl('');
            setError('');
            setCreated('');
          }
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入网页</DialogTitle>
          <DialogDescription>
            保存公开网页的静态快照，解析后可对照原件核对；动态页面和外链图片可能需要补充。
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <p>
            快照已保存。
            <Link
              to={`/documents/${created}`}
              onClick={() => onOpenChange(false)}
              className="underline"
            >
              查看解析进度
            </Link>
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-3"
          >
            <label className="block">
              网页地址
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
                maxLength={4096}
                placeholder="https://example.com/article"
                disabled={busy || mustCheck}
              />
            </label>
            <Button type="submit" disabled={busy || mustCheck || !url.trim()}>
              {busy ? '正在保存快照…' : '保存并解析'}
            </Button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
        {mustCheck && (
          <Link to="/documents" className="underline">
            查看文档库确认结果
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
