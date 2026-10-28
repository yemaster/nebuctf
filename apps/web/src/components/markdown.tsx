import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";

export const Markdown = memo(function Markdown({
  children,
}: {
  children: string;
}) {
  return (
    <div className="markdown min-w-0 break-words text-sm leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre({ children }) {
            const code = Children.toArray(children).find(isValidElement);
            if (
              !isValidElement<{ children?: ReactNode; className?: string }>(
                code,
              )
            )
              return <pre>{children}</pre>;
            const text = String(code.props.children ?? "").replace(/\n$/, "");
            const language =
              /language-([\w-]+)/
                .exec(code.props.className ?? "")?.[1]
                ?.toLowerCase() ?? "";
            return <CodeBlock code={text} language={language} />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
