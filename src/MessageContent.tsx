import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t, useLanguage } from './i18n';
import { remarkFileLinks } from './fileLinks';

const remarkPlugins = [remarkGfm, remarkFileLinks];

function ProjectImage({ projectId, sessionId, src, alt }: { projectId?: string; sessionId?: string; src?: string; alt?: string }) {
  const [url, setURL] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setURL('');setError('');
    if (projectId && sessionId && src) window.archi.call('image', { projectId, sessionId, relative: src })
      .then(value => { if (live) setURL(value); })
      .catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [projectId, sessionId, src]);
  return url
    ? <img className="project-image" src={url} alt={alt || t('ui.processingResult')} />
    : <span className="muted">{error || t('ui.loadingImage')}</span>;
}

export const MessageContent = memo(function MessageContent({ text, projectId, sessionId, onLink }: {
  text: string;
  projectId?: string;
  sessionId?: string;
  onLink: (href?: string) => void;
}) {
  useLanguage();
  // Markdown uses these functions as component types. Keep them stable so
  // composer edits and streaming updates do not remount loaded images or links.
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => <ProjectImage key={`${projectId}:${sessionId}:${src}`} projectId={projectId} sessionId={sessionId} src={typeof src === 'string' ? src : undefined} alt={alt} />,
    a: ({ href, children }) => <button className="inline-link" title={href && !/^https:/i.test(href) ? t('ui.revealFile', { path: href }) : href} onClick={() => onLink(href)}>{children}</button>,
  }), [projectId, sessionId, onLink]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={url=>/^(?:(?:project|session):\/|file:\/\/\/|[a-z]:[\\/])/i.test(url)?url:defaultUrlTransform(url)}>{text}</ReactMarkdown>;
});
