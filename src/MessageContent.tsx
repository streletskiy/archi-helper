import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t, useLanguage } from './i18n';

const remarkPlugins = [remarkGfm];

function ProjectImage({ projectId, src, alt }: { projectId?: string; src?: string; alt?: string }) {
  const [url, setURL] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    if (projectId && src) window.archi.call('image', { projectId, relative: src })
      .then(value => { if (live) setURL(value); })
      .catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [projectId, src]);
  return url
    ? <img className="project-image" src={url} alt={alt || t('ui.processingResult')} />
    : <span className="muted">{error || t('ui.loadingImage')}</span>;
}

export const MessageContent = memo(function MessageContent({ text, projectId, onLink }: {
  text: string;
  projectId?: string;
  onLink: (href?: string) => void;
}) {
  useLanguage();
  // Markdown uses these functions as component types. Keep them stable so
  // composer edits and streaming updates do not remount loaded images or links.
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => <ProjectImage key={`${projectId}:${src}`} projectId={projectId} src={typeof src === 'string' ? src : undefined} alt={alt} />,
    a: ({ href, children }) => <button className="inline-link" onClick={() => onLink(href)}>{children}</button>,
  }), [projectId, onLink]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>{text}</ReactMarkdown>;
});
