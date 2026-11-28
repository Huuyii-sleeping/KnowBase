import { useEffect, useRef, useState } from 'react';
import { documentsApi } from '@/lib/api';
import { requestFailure } from '@/lib/api-error';

/** Short-lived object-scoped URLs enable authenticated native previews and seek. */
export function DocumentResource({
  objectKey,
  mimeType,
  page,
  startMs,
  label = '原件',
}: {
  objectKey: string;
  mimeType: string;
  page?: number;
  startMs?: number;
  label?: string;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  const position = useRef<number | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    setUrl('');
    setError('');
    position.current = undefined;
    const load = () =>
      documentsApi
        .resourceAccess(objectKey)
        .then((access) => {
          if (!stopped) {
            if (media.current) position.current = media.current.currentTime;
            setUrl(access.url);
            setError('');
          }
        })
        .catch((error) => {
          if (!stopped) {
            setUrl('');
            setError(requestFailure(error).message);
          }
        });
    void load();
    const timer = setInterval(() => void load(), 240000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [objectKey]);
  useEffect(() => {
    if (media.current && startMs !== undefined)
      media.current.currentTime = startMs / 1000;
  }, [startMs]);
  const loaded = () => {
    if (media.current && position.current !== undefined)
      media.current.currentTime = position.current;
  };
  if (error) return <span role="alert">{error}</span>;
  if (!url) return <span>正在读取{label}…</span>;
  const target =
    url +
    (mimeType === 'application/pdf'
      ? `#page=${page ?? 1}`
      : startMs === undefined
        ? ''
        : `#t=${startMs / 1000}`);
  if (mimeType.startsWith('image/'))
    return (
      <img
        src={target}
        alt={label}
        className="max-h-[600px] max-w-full object-contain"
      />
    );
  if (mimeType.startsWith('audio/'))
    return (
      <audio
        ref={(node) => {
          media.current = node;
        }}
        onLoadedMetadata={loaded}
        src={target}
        controls
        aria-label={label}
        preload="metadata"
      />
    );
  if (mimeType.startsWith('video/'))
    return (
      <video
        ref={(node) => {
          media.current = node;
        }}
        onLoadedMetadata={loaded}
        src={target}
        controls
        aria-label={label}
        preload="metadata"
        className="max-h-[600px] max-w-full"
      />
    );
  if (mimeType === 'application/pdf')
    return <iframe src={target} title={label} className="h-[600px] w-full" />;
  return (
    <a href={target} target="_blank" rel="noreferrer" className="underline">
      下载{label}核对
    </a>
  );
}
