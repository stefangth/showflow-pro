import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Read-only markdown rendered with the shared ShowFlow doc prose styling. */
export function MarkdownDoc({ source }: { source: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground
      [&_h1]:font-display [&_h1]:text-2xl [[&_h1]:font-bold_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3
      [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1
      [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1
      [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:text-foreground
      [&_li]:text-sm [&_li]:leading-relaxed
      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
      [&_code]:bg-well-tint [&_code]:text-foreground [&_code]:text-xs [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
      [&_pre]:bg-well-tint [&_pre]:rounded-card [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_pre]:text-xs
      [&_pre_code]:bg-transparent [&_pre_code]:p-0
      [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4
      [&_th]:text-left [&_th]:font-medium [&_th]:border [&_th]:border-border [&_th]:bg-well-tint [&_th]:px-3 [&_th]:py-1.5
      [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-sm [&_td]:align-top
      [&_hr]:border-border [&_hr]:my-4
      [&_strong]:font-semibold [&_strong]:text-foreground
      [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
    </div>
  );
}
