import { Check, Copy } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement, memo, useEffect, useRef, useState } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const COPIED_MS = 1500;
const HIGHLIGHT_PLUGINS = [rehypeHighlight];
const NO_PLUGINS: never[] = [];

function languageOf(children: ReactNode): string | undefined {
  if (!isValidElement(children)) return undefined;
  const { className } = (children as ReactElement<{ className?: string }>).props;
  return className?.match(/language-([\w-]+)/)?.[1];
}

/** A fenced code block, with its language and a way to copy it. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.current?.textContent ?? '');
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.error('Your browser blocked copying. Select the code and copy it by hand.');
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-md bg-muted">
      <div className="flex items-center justify-between gap-2 border-b pl-3">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {language ?? 'Code'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="size-3.5 text-success" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre
        ref={code}
        className="overflow-x-auto p-3 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0"
      >
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-link underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-semibold">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-signal pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) => (
    <code
      className={
        className
          ? `font-mono text-sm ${className}`
          : 'rounded bg-muted px-1 font-mono text-[0.9em]'
      }
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
};

/**
 * Model output. react-markdown skips raw HTML and strips unsafe link schemes by default. A reply
 * still streaming skips highlighting, because it would redo every code block on each token.
 */
export const Markdown = memo(function Markdown({
  children,
  highlight = true,
}: {
  children: string;
  highlight?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={highlight ? HIGHLIGHT_PLUGINS : NO_PLUGINS}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
});
