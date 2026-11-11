import { Icon } from '@/components/ui/icon';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { documentsApi, type DocumentDetail } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';
import {
  UPLOAD_ACCEPT,
  UPLOAD_FORMAT_LABEL,
  validateUploadFile,
  uploadResult,
} from '@/lib/document-upload';
import { RequestFailure } from '@/components/request-failure';
import { formatBytes } from '@/lib/format';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function UploadDialog({
  open,
  onOpenChange,
  onCreated,
}: UploadDialogProps) {
  const [failure, setFailure] = useState<ReturnType<
    typeof requestFailure
  > | null>(null);
  const [created, setCreated] = useState<DocumentDetail | null>(null);
  const submittingRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [team, setTeam] = useState('');
  const [tags, setTags] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFailure(null);
    setCreated(null);
    setFile(null);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setTitle('');
    setCategory('');
    setTeam('');
    setTags('');
  };

  const pickFile = (f: File | undefined) => {
    if (!f || submittingRef.current || failure?.action === 'check_result')
      return;
    const error = validateUploadFile(f);
    if (error) {
      setFile(null);
      setFailure(requestFailure(error));
      return;
    }
    setFailure(null);
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (submittingRef.current || failure?.action === 'check_result' || created)
      return;
    const validation = validateUploadFile(file);
    if (validation || !file) {
      if (validation) setFailure(requestFailure(validation));
      return;
    }
    submittingRef.current = true;
    setFailure(null);
    setSubmitting(true);
    try {
      const document = await documentsApi.create(file, {
        title: title.trim() || undefined,
        category: category.trim() || undefined,
        team: team.trim() || undefined,
        tags: tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setCreated(document);
      onCreated();
    } catch (e) {
      const next = requestFailure(e, 'upload');
      setFailure(next);
      if (next.action === 'check_result') onCreated();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const outcome = created ? uploadResult(created.parseStatus) : null;
  const needsCheck = failure?.action === 'check_result';
  const close = () => {
    if (submittingRef.current) return;
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submittingRef.current) return;
        if (!v) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>上传文档</DialogTitle>
            <DialogDescription className="mt-1.5">
              添加一份文档，开始积累团队知识。
            </DialogDescription>
          </div>
        </DialogHeader>

        {created && outcome ? (
          <>
            <div
              role="status"
              className="rounded-lg border border-border bg-secondary/60 p-4"
            >
              <p className="text-sm font-semibold">{outcome.title}</p>
              <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                {outcome.message}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                完成
              </Button>
              <Button asChild>
                <Link to={`/documents/${created.id}`} onClick={close}>
                  查看文档
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <fieldset
              disabled={submitting || needsCheck}
              className="min-w-0 space-y-4 disabled:opacity-70"
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={UPLOAD_ACCEPT}
                aria-label="选择文档文件"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={`w-full cursor-pointer rounded-lg border-[1.5px] border-dashed px-4 py-7 text-center text-[13px] transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input text-muted-foreground hover:border-primary hover:bg-primary/5'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!submittingRef.current && !needsCheck) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
              >
                {file ? (
                  <span className="font-medium text-foreground">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                ) : (
                  <>
                    <Icon
                      name="upload"
                      width={26}
                      height={26}
                      className="mx-auto mb-3 text-primary"
                    />
                    拖放文件到这里，或点击选择
                    <span className="mt-1 block text-[12px] text-muted-foreground/70">
                      支持 {UPLOAD_FORMAT_LABEL}，单个不超过 100 MB
                    </span>
                  </>
                )}
              </button>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="up-title">标题</Label>
                  <Input
                    id="up-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="默认取文件名"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-category">分类</Label>
                  <Input
                    id="up-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="如：产品"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="up-team">团队</Label>
                  <Input
                    id="up-team"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="如：平台组"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="up-tags">标签</Label>
                  <Input
                    id="up-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="多个标签用逗号分隔"
                  />
                </div>
              </div>
            </fieldset>
            {failure && (
              <div className="mt-4">
                <RequestFailure
                  title={needsCheck ? '请先确认上传结果' : '暂时无法上传'}
                  failure={failure}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={submitting} onClick={close}>
                取消
              </Button>
              {needsCheck ? (
                <Button asChild>
                  <Link to="/documents" onClick={close}>
                    查看文档列表
                  </Link>
                </Button>
              ) : (
                <Button onClick={submit} disabled={submitting || !file}>
                  {submitting ? '上传中…' : '保存为草稿'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
