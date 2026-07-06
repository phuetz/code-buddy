/**
 * MediaAttachments — inline viewers for local media referenced by an
 * assistant message (generated images/videos/voice). The chat used to show
 * `MEDIA:/abs/path.mp4` as bare text; this renders the actual player.
 */
import { useMemo } from 'react';

import { extractMediaPaths, toFileUrl } from './media-attachments-model.js';

export function MediaAttachments({ text }: { text: string }) {
  const media = useMemo(() => extractMediaPaths(text), [text]);
  if (media.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-3" data-testid="media-attachments">
      {media.map(({ kind, path }) => {
        const url = toFileUrl(path);
        if (kind === 'video') {
          return (
            <video
              key={path}
              src={url}
              controls
              preload="metadata"
              className="max-h-80 max-w-full rounded-lg border border-border bg-black"
            />
          );
        }
        if (kind === 'audio') {
          return <audio key={path} src={url} controls preload="metadata" className="w-full max-w-md" />;
        }
        return (
          <img
            key={path}
            src={url}
            alt={path.slice(path.lastIndexOf('/') + 1)}
            loading="lazy"
            className="max-h-80 max-w-full rounded-lg border border-border object-contain"
          />
        );
      })}
    </div>
  );
}
