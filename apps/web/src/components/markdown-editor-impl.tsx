import { createContext, useContext, useEffect } from "react";
import MDEditor, {
  commands,
  EditorContext,
  type ICommand,
  type MDEditorProps,
} from "@uiw/react-md-editor/common";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading,
  Link,
  Image,
  Quote,
  Code,
  SquareCode,
  List,
  ListOrdered,
  ListTodo,
  Table2,
  Pencil,
  Columns2,
  Eye,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Markdown } from "./markdown";
import { useTheme } from "./theme-provider";
import type { MarkdownEditorProps } from "./markdown-editor";
import "./markdown-editor.css";

const EditorOptionsContext = createContext({
  disabled: false,
  maxLength: 20000,
});
const formatting: ICommand[] = [
  {
    name: "heading-menu",
    keyCommand: "heading-menu",
    icon: <Heading />,
    buttonProps: { "aria-label": "标题" },
  },
  commands.bold,
  commands.italic,
  commands.strikethrough,
  commands.link,
  commands.image,
  commands.quote,
  commands.code,
  commands.codeBlock,
  commands.unorderedListCommand,
  commands.orderedListCommand,
  commands.checkedListCommand,
  commands.table,
];
const modes = [
  commands.codeEdit,
  commands.codeLive,
  commands.codePreview,
  commands.fullscreen,
];
const tools = new Map<ICommand, [string, typeof Bold]>([
  [commands.bold, ["粗体", Bold]],
  [commands.italic, ["斜体", Italic]],
  [commands.strikethrough, ["删除线", Strikethrough]],
  [commands.link, ["链接", Link]],
  [commands.image, ["图片链接", Image]],
  [commands.quote, ["引用", Quote]],
  [commands.code, ["行内代码", Code]],
  [commands.codeBlock, ["代码块", SquareCode]],
  [commands.unorderedListCommand, ["无序列表", List]],
  [commands.orderedListCommand, ["有序列表", ListOrdered]],
  [commands.checkedListCommand, ["任务列表", ListTodo]],
  [commands.table, ["表格", Table2]],
  [commands.codeEdit, ["编辑", Pencil]],
  [commands.codeLive, ["分屏预览", Columns2]],
  [commands.codePreview, ["预览", Eye]],
  [commands.fullscreen, ["全屏编辑", Maximize]],
]);

function FullscreenLifecycle() {
  const { fullscreen, dispatch, container, textarea, markdown, preview } =
    useContext(EditorContext);
  const { maxLength } = useContext(EditorOptionsContext);
  useEffect(() => {
    if (!textarea) return;
    textarea.tabIndex = preview === "preview" ? -1 : 0;
    textarea.setAttribute("aria-hidden", String(preview === "preview"));
    textarea.setCustomValidity(
      (markdown?.length ?? 0) > maxLength ? `题面最多 ${maxLength} 个字符` : "",
    );
    if ((markdown?.length ?? 0) > maxLength && preview === "preview")
      dispatch?.({ preview: "edit" });
  }, [textarea, markdown, maxLength, preview, dispatch]);
  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      // Let an open dropdown handle Escape first.
      if (document.querySelector('[data-slot="dropdown-menu-content"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch?.({ fullscreen: false });
      }
      if (event.key === "Tab" && container) {
        const focusable = [
          ...container.querySelectorAll<HTMLElement>(
            "button:not(:disabled), textarea:not(:disabled), a[href]",
          ),
        ].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
    };
  }, [fullscreen, dispatch, container]);
  return null;
}

type Execute = (command: ICommand, groupName?: string) => void;
function ToolbarCommand({
  command,
  disabled,
  execute,
}: {
  command: ICommand;
  disabled: boolean;
  execute: Execute;
}) {
  const { disabled: pending } = useContext(EditorOptionsContext);
  const { preview, fullscreen, textarea } = useContext(EditorContext);
  if (command.name === "heading-menu")
    return (
      <span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="标题"
              title="标题"
              disabled={disabled || pending}
            >
              <Heading />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[100000]"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              textarea?.focus();
            }}
          >
            {[
              commands.heading1,
              commands.heading2,
              commands.heading3,
              commands.heading4,
              commands.heading5,
              commands.heading6,
            ].map((heading, index) => (
              <DropdownMenuItem
                key={heading.name}
                onSelect={() => execute(heading)}
                disabled={pending}
              >
                {index + 1} 级标题
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  const [label, Icon] = tools.get(command) ?? ["格式", Code];
  const active =
    command.keyCommand === "preview"
      ? preview === command.value
      : command.keyCommand === "fullscreen"
        ? !!fullscreen
        : undefined;
  const name =
    command === commands.fullscreen && fullscreen ? "退出全屏" : label;
  return (
    <span>
      {command === commands.fullscreen && <FullscreenLifecycle />}
      <Button
        type="button"
        variant={active ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label={name}
        title={name}
        aria-pressed={active}
        disabled={disabled || pending}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          execute(command);
        }}
      >
        {command === commands.fullscreen && fullscreen ? (
          <Minimize />
        ) : (
          <Icon />
        )}
      </Button>
    </span>
  );
}

const components: MDEditorProps["components"] = {
  toolbar: (command, disabled, execute) => (
    <ToolbarCommand command={command} disabled={disabled} execute={execute} />
  ),
  preview: (source) =>
    source ? (
      <Markdown>{source}</Markdown>
    ) : (
      <p className="text-sm text-muted-foreground">暂无题面</p>
    ),
};

export default function MarkdownEditorImpl({
  id,
  value,
  onChange,
  disabled = false,
  maxLength = 20000,
}: MarkdownEditorProps) {
  const { resolved } = useTheme();
  return (
    <EditorOptionsContext.Provider value={{ disabled, maxLength }}>
      <MDEditor
        className="nebuctf-markdown-editor"
        data-color-mode={resolved}
        value={value}
        onChange={(source) => onChange(source ?? "")}
        commands={formatting}
        extraCommands={modes}
        components={components}
        preview="edit"
        height={420}
        minHeight={280}
        maxHeight={900}
        defaultTabEnable
        overflow={false}
        textareaProps={{
          id,
          "aria-label": "题目内容",
          maxLength,
          "aria-invalid": value.length > maxLength,
          "aria-describedby":
            value.length > maxLength ? `${id}-error` : undefined,
          disabled,
          placeholder: "使用 Markdown 编写题面",
        }}
      />
    </EditorOptionsContext.Provider>
  );
}
