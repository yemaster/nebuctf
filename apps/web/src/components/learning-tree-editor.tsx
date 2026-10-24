import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  Handle,
  Position,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Plus, Trash2, BookOpen, Flag, X, GitFork } from "lucide-react";
import { toast } from "sonner";
import type { Article, LearningNode, LearningTree } from "@/lib/types";
import { useAPI } from "@/lib/api";
import {
  learningGraph,
  arrangeSkillTree,
  skillNodeSize,
  flowLabels,
  canConnectPrerequisite,
  serializeLearningGraph,
} from "@/lib/learning-graph";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { Switch } from "./ui/switch";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Field, Pagination, QueryState, Empty } from "./shared";
import { ChallengePicker } from "./challenge-picker";
type SkillNode = Node<LearningNode & Record<string, unknown>, "skill">;
function SkillNodeView({ data, selected }: NodeProps<SkillNode>) {
  return (
    <Card
      className={`w-72 gap-2 border-0 p-4 shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <Handle type="target" position={Position.Top} aria-label="连接前置技能" />
      <span
        className="line-clamp-2 break-words text-sm font-medium"
        title={data.title}
      >
        {data.title || "未命名节点"}
      </span>
      {data.article_id && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span className="truncate">{data.article_title ?? "关联文档"}</span>
        </span>
      )}
      {data.challenge_id && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Flag className="size-3.5 shrink-0" />
          <span className="truncate">{data.challenge_title ?? "关联练习"}</span>
        </span>
      )}
      {!data.article_id && !data.challenge_id && (
        <span className="text-xs text-muted-foreground">未关联内容</span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        aria-label="连接后续技能"
      />
    </Card>
  );
}
const nodeTypes = { skill: SkillNodeView };
export function LearningTreeEditor({
  tree,
  onSave,
  pending,
}: {
  tree: LearningTree | null;
  onSave: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const initial = useMemo(() => learningGraph(tree?.nodes ?? []), [tree]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SkillNode>(
    initial.nodes.map((node, index) => ({
      ...node,
      selected: index === 0,
    })) as SkillNode[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selected, setSelected] = useState<string | null>(nodes[0]?.id ?? null),
    [picking, setPicking] = useState(false),
    [layoutRevision, setLayoutRevision] = useState(0);
  const flow = useRef<ReactFlowInstance<SkillNode> | null>(null),
    canvas = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const current = nodes.find((n) => n.id === selected);
  useEffect(() => {
    if (!layoutRevision) return;
    const frame = requestAnimationFrame(() => {
      void flow.current?.fitView({ padding: 0.15 });
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutRevision]);
  function arrange() {
    setNodes((previous) => arrangeSkillTree(previous, edges));
    setLayoutRevision((previous) => previous + 1);
  }
  const patch = (value: Partial<LearningNode>) =>
    setNodes((previous) =>
      previous.map((n) =>
        n.id === selected ? { ...n, data: { ...n.data, ...value } } : n,
      ),
    );
  function remove(id: string) {
    setNodes((previous) => previous.filter((n) => n.id !== id));
    setEdges((previous) =>
      previous.filter((e) => e.source !== id && e.target !== id),
    );
    if (selected === id) setSelected(null);
  }
  function add(parentId?: string) {
    const id = crypto.randomUUID(),
      bounds = canvas.current?.getBoundingClientRect(),
      parent = nodes.find((node) => node.id === parentId);
    const position = parent
      ? {
          x: parent.position.x,
          y:
            parent.position.y +
            Math.max(skillNodeSize.height, parent.measured?.height ?? 0) +
            80,
        }
      : bounds && flow.current
        ? flow.current.screenToFlowPosition({
            x: bounds.left + bounds.width / 2 - 144,
            y: bounds.top + bounds.height / 2 - 40,
          })
        : { x: 0, y: 0 };
    // Keep a newly added branch clear of existing cards without moving hand-placed nodes.
    while (
      nodes.some(
        (node) =>
          Math.abs(node.position.x - position.x) < skillNodeSize.width + 64 &&
          Math.abs(node.position.y - position.y) < skillNodeSize.height + 40,
      )
    )
      position.x += skillNodeSize.width + 64;
    setNodes((previous) => [
      ...previous.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "skill",
        selected: true,
        position,
        data: {
          id,
          title: "",
          article_id: null,
          challenge_id: null,
          prerequisites: parent ? [parent.id] : [],
        },
      },
    ]);
    if (parent)
      setEdges((previous) =>
        addEdge(
          { id: `${parent.id}:${id}`, source: parent.id, target: id },
          previous,
        ),
      );
    setSelected(id);
  }
  return (
    <form
      id="tree-form"
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        const invalid = nodes.find(
          (n) =>
            !n.data.title.trim() ||
            (!n.data.article_id && !n.data.challenge_id),
        );
        if (!nodes.length || invalid) {
          setSelected(invalid?.id ?? null);
          toast.error(
            !nodes.length ? "请添加技能节点" : "请填写节点名称并关联文档或练习",
          );
          return;
        }
        const data = new FormData(e.currentTarget);
        onSave({
          title: data.get("title"),
          description: data.get("description"),
          published: data.has("published"),
          nodes: serializeLearningGraph(nodes, edges),
        });
      }}
    >
      <div className="grid items-end gap-5 rounded-xl bg-card p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="技能树名称">
          <Input
            name="title"
            defaultValue={tree?.title}
            required
            maxLength={120}
          />
        </Field>
        <Field label="学习目标">
          <Textarea
            name="description"
            defaultValue={tree?.description}
            maxLength={2000}
            rows={2}
          />
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch name="published" defaultChecked={tree?.published} />
          启用技能树
        </label>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div
          ref={canvas}
          className="h-[65dvh] min-h-[480px] overflow-hidden rounded-xl bg-card shadow-sm"
          aria-label="技能树画布"
        >
          <ReactFlow<SkillNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={(instance) => {
              flow.current = instance;
            }}
            onNodeClick={(_, node) => setSelected(node.id)}
            onSelectionChange={({ nodes: selectedNodes }) =>
              setSelected(selectedNodes.at(-1)?.id ?? null)
            }
            onNodesDelete={(removed) => {
              const ids = new Set(removed.map((n) => n.id));
              setEdges((previous) =>
                previous.filter(
                  (e) => !ids.has(e.source) && !ids.has(e.target),
                ),
              );
              if (selected && ids.has(selected)) setSelected(null);
            }}
            onConnect={(connection) => {
              if (
                canConnectPrerequisite(
                  edges,
                  connection.source,
                  connection.target,
                )
              )
                setEdges((previous) => addEdge(connection, previous));
            }}
            isValidConnection={(connection) =>
              !!connection.source &&
              !!connection.target &&
              canConnectPrerequisite(
                edges,
                connection.source,
                connection.target,
              )
            }
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "var(--muted-foreground)" },
            }}
            colorMode={resolved}
            ariaLabelConfig={flowLabels}
            fitView
            minZoom={0.2}
            maxZoom={2}
            deleteKeyCode={["Backspace", "Delete"]}
            aria-label="拖动节点并连接前置技能"
            style={{ background: "var(--card)" }}
          >
            <Controls showInteractive={false} />
            <Panel position="top-left" className="flex gap-2">
              <Button
                type="button"
                onClick={() => add()}
                disabled={pending || nodes.length >= 100}
              >
                <Plus />
                添加节点
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={arrange}
                disabled={pending || !nodes.length}
              >
                <GitFork />
                树形排列
              </Button>
            </Panel>
          </ReactFlow>
        </div>
        <aside className="space-y-5 rounded-xl bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">节点设置</h2>
            {current && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="删除选中节点"
                onClick={() => remove(current.id)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          {current ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={pending || nodes.length >= 100}
                onClick={() => add(current.id)}
              >
                <Plus />
                添加子节点
              </Button>
              <Field label="节点名称">
                <Input
                  aria-label="节点名称"
                  value={current.data.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  maxLength={120}
                />
              </Field>
              <Field label="关联文档">
                <ArticleSelector
                  value={current.data.article_id}
                  title={current.data.article_title}
                  onChange={(id, title) =>
                    patch({ article_id: id, article_title: title })
                  }
                />
              </Field>
              <Field label="关联练习">
                <div className="flex gap-1">
                  <Dialog open={picking} onOpenChange={setPicking}>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-w-0 flex-1 justify-start"
                      >
                        <span className="truncate">
                          {current.data.challenge_title ??
                            (current.data.challenge_id
                              ? "已关联练习"
                              : "选择练习")}
                        </span>
                      </Button>
                    </DialogTrigger>
                    <DialogContent
                      aria-describedby={undefined}
                      className="max-w-2xl"
                    >
                      <DialogTitle>选择练习</DialogTitle>
                      {picking && (
                        <ChallengePicker
                          practice
                          single
                          value={
                            current.data.challenge_id
                              ? [current.data.challenge_id]
                              : []
                          }
                          onChange={(ids) => {
                            if (!ids.length)
                              patch({
                                challenge_id: null,
                                challenge_title: null,
                              });
                          }}
                          onPick={(c) => {
                            patch({
                              challenge_id: c.id,
                              challenge_title: c.title,
                            });
                            setPicking(false);
                          }}
                        />
                      )}
                    </DialogContent>
                  </Dialog>
                  {current.data.challenge_id && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="取消关联练习"
                      onClick={() =>
                        patch({ challenge_id: null, challenge_title: null })
                      }
                    >
                      <X />
                    </Button>
                  )}
                </div>
              </Field>
              <div className="space-y-2">
                <h3 className="text-sm font-medium">前置技能</h3>
                {edges
                  .filter((e) => e.target === current.id)
                  .map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {nodes.find((n) => n.id === e.source)?.data.title ||
                          "未命名节点"}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="移除前置依赖"
                        onClick={() =>
                          setEdges((previous) =>
                            previous.filter((v) => v.id !== e.id),
                          )
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                {!edges.some((e) => e.target === current.id) && (
                  <p className="text-sm text-muted-foreground">无前置技能</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">选择节点后编辑内容</p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            从底部连接点连到后续节点顶部。选中连线后按 Delete 删除。
          </p>
        </aside>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending}>保存技能树</Button>
      </div>
    </form>
  );
}
function ArticleSelector({
  value,
  title,
  onChange,
}: {
  value: string | null;
  title?: string | null;
  onChange: (id: string | null, title: string | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const data = useAPI<{ items: Article[]; total: number }>(
    `/admin/articles?page=${page}&q=${encodeURIComponent(q)}`,
    open,
  );
  return (
    <div className="flex gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start"
          >
            <span className="truncate">
              {title ?? (value ? "已关联文档" : "选择文档")}
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>选择文档</DialogTitle>
          <div className="flex gap-2">
            <Input
              aria-label="搜索文档"
              placeholder="搜索文档"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setQ(search);
                  setPage(1);
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQ(search);
                setPage(1);
              }}
            >
              搜索
            </Button>
          </div>
          <QueryState
            loading={data.isLoading}
            error={data.error}
            retry={() => void data.refetch()}
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {data.data?.items.map((a) => (
              <Button
                type="button"
                key={a.id}
                variant={a.id === value ? "secondary" : "ghost"}
                className="h-auto w-full justify-start whitespace-normal text-left"
                onClick={() => {
                  onChange(a.id, a.title);
                  setOpen(false);
                }}
              >
                {a.title}
                {!a.published && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    草稿
                  </span>
                )}
              </Button>
            ))}
            {data.data?.items.length === 0 && <Empty>没有符合条件的文档</Empty>}
          </div>
          <Pagination
            page={page}
            setPage={setPage}
            total={data.data?.total}
            hasMore={page * 24 < (data.data?.total ?? 0)}
            disabled={data.isFetching}
            alwaysShow
          />
        </DialogContent>
      </Dialog>
      {value && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="取消关联文档"
          onClick={() => onChange(null, null)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
