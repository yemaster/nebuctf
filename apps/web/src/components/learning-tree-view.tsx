import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import {
  ReactFlow,
  Controls,
  Handle,
  Position,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  CheckCircle2,
  Circle,
  Lock,
  Plus,
  Minus,
  ArrowLeft,
  GitBranch,
} from "lucide-react";
import type { LearningNode } from "@/lib/types";
import { arrangeSkillTree, flowLabels } from "@/lib/learning-graph";
import { skillBranches } from "@/lib/learning-navigation";
import { useTheme } from "./theme-provider";
import { SkillNode } from "./learning-node-card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from "./ui/breadcrumb";

type PublicSkill = Node<
  {
    node: LearningNode;
    count: number;
    expanded: boolean;
    select: (id: string) => void;
    toggle: (id: string) => void;
  },
  "skill"
>;
function Skill({ data, selected }: NodeProps<PublicSkill>) {
  const n = data.node;
  const Icon = n.completed ? CheckCircle2 : n.unlocked ? Circle : Lock;
  return (
    <div
      className={`flex h-16 w-52 items-center rounded-lg bg-card shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="opacity-0"
      />
      <Button
        variant="ghost"
        className="nodrag nopan h-full min-w-0 flex-1 justify-start gap-2 px-3 whitespace-normal"
        onClick={() => data.select(n.id)}
        aria-pressed={selected}
        aria-label={`${n.title}，${n.completed ? "已完成" : n.unlocked ? "可学习" : "未解锁"}`}
      >
        <Icon
          className={`size-4 shrink-0 ${n.completed ? "text-success" : n.unlocked ? "text-primary" : "text-muted-foreground"}`}
        />
        <span
          className="line-clamp-2 break-words text-left leading-5"
          title={n.title}
        >
          {n.title}
        </span>
      </Button>
      {data.count > 0 && (
        <Button
          variant="ghost"
          size="icon"
          className="nodrag nopan mr-1 size-7 shrink-0 text-muted-foreground"
          onClick={() => data.toggle(n.id)}
          aria-expanded={data.expanded}
          aria-label={`${data.expanded ? "收起" : "展开"}${n.title}的分支`}
        >
          {data.expanded ? <Minus /> : <Plus />}
        </Button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="opacity-0"
      />
    </div>
  );
}
const nodeTypes = { skill: Skill };
export function LearningTreeView({ nodes }: { nodes: LearningNode[] }) {
  const { resolved } = useTheme(),
    reduced = useReducedMotion();
  const [params, setParams] = useSearchParams(),
    location = useLocation();
  const tree = useMemo(() => skillBranches(nodes), [nodes]);
  const requested = params.get("node"),
    branch = params.get("branch");
  const selected =
    tree.byId.get(requested ?? "") ??
    nodes.find((n) => n.unlocked && !n.completed) ??
    nodes[0];
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...tree.roots,
        ...tree.ancestors(selected?.id ?? ""),
        ...(branch ? [branch] : []),
      ]),
  );
  const manual = params.get("layout") === "author";
  const geometry = useMemo(() => {
    const visible = tree.visible(expanded, branch);
    const ids = new Set(visible.map((n) => n.id));
    const edges = visible.flatMap((n) =>
      n.prerequisites
        .filter((id) => ids.has(id))
        .map((source) => ({ id: `${source}:${n.id}`, source, target: n.id })),
    );
    const arranged = arrangeSkillTree(visible, edges, {
      width: 208,
      height: 64,
    });
    return {
      nodes: arranged.map((n) => ({
        ...n,
        position: manual
          ? (tree.byId.get(n.id)?.position ?? n.position)
          : n.position,
      })),
      edges,
    };
  }, [tree, expanded, branch, manual]);
  const flow = useRef<ReactFlowInstance<PublicSkill> | null>(null);
  const details = useRef<HTMLElement>(null);
  // Selection alone does not move the canvas. Refit only when its topology changes.
  useEffect(() => {
    const frame = requestAnimationFrame(
      () =>
        void flow.current?.fitView({
          padding: 0.18,
          minZoom: 0.65,
          maxZoom: 1,
          duration: reduced ? 0 : 250,
        }),
    );
    return () => cancelAnimationFrame(frame);
  }, [geometry, reduced]);
  function update(values: Record<string, string | null>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        Object.entries(values).forEach(([key, value]) =>
          value ? next.set(key, value) : next.delete(key),
        );
        return next;
      },
      { replace: true },
    );
  }
  function select(id: string, leaveBranch = false) {
    update({ node: id, ...(leaveBranch ? { branch: null } : {}) });
    setExpanded((previous) => {
      const parents = [...tree.ancestors(id)];
      return parents.every((parent) => previous.has(parent))
        ? previous
        : new Set([...previous, ...parents]);
    });
    if (window.matchMedia("(max-width: 1023px)").matches)
      requestAnimationFrame(() =>
        details.current?.scrollIntoView({
          behavior: reduced ? "instant" : "smooth",
          block: "nearest",
        }),
      );
  }
  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    update({ node: id });
  }
  function focus(id: string | null) {
    update({ branch: id, node: id });
    setExpanded(new Set(id ? [id] : tree.roots));
  }
  const returnParams = new URLSearchParams(params);
  if (selected) returnParams.set("node", selected.id);
  const returnTo = location.pathname + `?${returnParams}`;
  const allOpen = [...tree.children]
    .filter(([, children]) => children.length)
    .every(([id]) => expanded.has(id));
  return (
    <div
      className="overflow-hidden rounded-xl bg-card shadow-sm"
      aria-label="技能树"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {branch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                focus(tree.byId.get(branch)?.prerequisites[0] ?? null)
              }
            >
              <ArrowLeft />
              上一级
            </Button>
          )}
          <Breadcrumb aria-label="技能分支">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {tree.byId.get(branch ?? "")?.title ?? "全部技能"}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {branch && (
            <Button variant="ghost" size="sm" onClick={() => focus(null)}>
              全部
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {nodes.some((n) => n.position) && (
            <NativeSelect
              aria-label="技能树布局"
              value={manual ? "author" : "tree"}
              onChange={(e) =>
                update({
                  layout: e.target.value === "author" ? "author" : null,
                })
              }
            >
              <NativeSelectOption value="tree">树形布局</NativeSelectOption>
              <NativeSelectOption value="author">作者布局</NativeSelectOption>
            </NativeSelect>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setExpanded(
                new Set(allOpen ? tree.roots : nodes.map((n) => n.id)),
              );
              update({ node: branch ?? tree.roots[0] ?? null });
            }}
          >
            {allOpen ? "收起分支" : "展开全部"}
          </Button>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          className="h-[60dvh] min-h-[400px] bg-background"
          aria-label="技能分支画布"
        >
          <ReactFlow<PublicSkill>
            nodes={geometry.nodes.map((n) => ({
              id: n.id,
              type: "skill",
              position: n.position,
              selected: n.id === selected?.id,
              data: {
                node: n,
                count: tree.children.get(n.id)?.length ?? 0,
                expanded: expanded.has(n.id),
                select,
                toggle,
              },
            }))}
            edges={geometry.edges}
            onInit={(instance) => {
              flow.current = instance;
            }}
            nodeTypes={nodeTypes}
            colorMode={resolved}
            ariaLabelConfig={flowLabels}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ minZoom: 0.65, maxZoom: 1, padding: 0.18 }}
            minZoom={0.3}
            maxZoom={1.5}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "var(--muted-foreground)", strokeWidth: 1.25 },
            }}
            style={{ background: "var(--background)" }}
          >
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside
          ref={details}
          aria-label="当前技能"
          className="min-w-0 space-y-6 p-5"
        >
          {selected ? (
            <>
              <SkillNode
                key={selected.id}
                node={selected}
                returnTo={returnTo}
              />
              {(tree.children.get(selected.id)?.length ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => focus(selected.id)}
                >
                  <GitBranch />
                  进入分支
                  <Badge variant="outline" className="ml-auto">
                    {tree.children.get(selected.id)!.length}
                  </Badge>
                </Button>
              )}
              {selected.prerequisites.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs text-muted-foreground">前置技能</h3>
                  <div className="flex flex-col items-stretch gap-1">
                    {selected.prerequisites.map((id) => {
                      const prerequisite = tree.byId.get(id);
                      return (
                        prerequisite && (
                          <Button
                            key={id}
                            variant="ghost"
                            size="sm"
                            className="h-auto justify-start whitespace-normal py-2 text-left"
                            onClick={() => select(id, true)}
                          >
                            {prerequisite.completed ? (
                              <CheckCircle2 className="shrink-0 text-success" />
                            ) : (
                              <Circle className="shrink-0 text-muted-foreground" />
                            )}
                            {prerequisite.title}
                          </Button>
                        )
                      );
                    })}
                  </div>
                </div>
              )}
              {!selected.article_id &&
                !selected.challenge_id &&
                !tree.children.get(selected.id)?.length && (
                  <p className="text-sm text-muted-foreground">暂无学习内容</p>
                )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">暂无技能节点</p>
          )}
        </aside>
      </div>
      <div
        className="flex flex-wrap gap-5 px-4 py-3 text-xs text-muted-foreground"
        aria-label="学习状态图例"
      >
        <span className="flex items-center gap-2">
          <CheckCircle2 className="size-3.5 text-success" />
          已完成
        </span>
        <span className="flex items-center gap-2">
          <Circle className="size-3.5 text-primary" />
          可学习
        </span>
        <span className="flex items-center gap-2">
          <Lock className="size-3.5" />
          未解锁
        </span>
      </div>
    </div>
  );
}
