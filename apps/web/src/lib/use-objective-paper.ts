import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useAPI } from "./api";
import {
  type Paper,
  type PaperQuestion,
  type ObjectiveResponse,
  type ObjectiveSaved,
  answerState,
} from "./objective-paper";

type Draft = { answer: ObjectiveResponse; revision: string | null };
export function useObjectivePaper(
  scope: string,
  enabled: boolean,
  active: boolean,
) {
  const path = `/contests/${scope}/objective-paper`,
    query = useAPI<Paper>(path, enabled, active ? 15000 : undefined),
    cache = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [branchChoices, setBranchChoices] = useState<Record<string, string>>(
    {},
  );
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!query.data) return;
    setDrafts((old) => {
      const editable = new Set(
        query.data!.items.filter((q) => !q.saved.finalized_at).map((q) => q.id),
      );
      return Object.keys(old).some((id) => !editable.has(id))
        ? Object.fromEntries(
            Object.entries(old).filter(([id]) => editable.has(id)),
          )
        : old;
    });
  }, [query.data]);
  const response = (question: PaperQuestion) =>
    drafts[question.id]?.answer ?? question.saved.answer;
  const state = (question: PaperQuestion) =>
    answerState(question, response(question), !!drafts[question.id]);
  const change = (question: PaperQuestion, answer: ObjectiveResponse) => {
    if (question.saved.finalized_at) return;
    setDrafts((old) => ({
      ...old,
      [question.id]: {
        answer,
        revision: old[question.id]
          ? old[question.id]!.revision
          : question.saved.revision,
      },
    }));
  };
  const pending = (query.data?.items ?? []).filter(
    (q) => q.permissions.submit && !q.saved.finalized_at,
  );
  const groups = new Map<string, PaperQuestion[]>();
  for (const q of pending) {
    const group = q.contest_logic?.exclusive_group;
    if (!group || q.contest_logic?.exclusive_selected) continue;
    const items = groups.get(group);
    if (items) items.push(q);
    else groups.set(group, [q]);
  }
  const branches = Array.from(groups, ([group, items]) => ({
    group,
    items,
    selectedId: items.some((q) => q.id === branchChoices[group])
      ? branchChoices[group]
      : undefined,
  }));
  const needsBranchSelection = branches.some((branch) => !branch.selectedId);
  const finalQuestions = pending.filter((q) => {
    const group = q.contest_logic?.exclusive_group;
    return (
      !group ||
      q.contest_logic?.exclusive_selected ||
      branchChoices[group] === q.id
    );
  });
  const submit = useMutation({
    onMutate: () => cache.cancelQueries({ queryKey: [path] }),
    mutationFn: async (finalize: boolean) => {
      if (finalize && needsBranchSelection)
        throw new Error("请选择互斥组的提交题目");
      const items = finalize
        ? finalQuestions
        : (query.data?.items ?? []).filter(
            (q) =>
              q.permissions.submit && !q.saved.finalized_at && !!drafts[q.id],
          );
      return api<{
        server_time: string;
        items: ({ id: string } & ObjectiveSaved)[];
      }>(path, "POST", {
        finalize,
        answers: items.map((q) => ({
          id: q.id,
          answer: response(q),
          revision: drafts[q.id] ? drafts[q.id]!.revision : q.saved.revision,
        })),
      });
    },
    onSuccess: (result) => {
      const updates = new Map(result.items.map((q) => [q.id, q]));
      cache.setQueryData<Paper>([path], (old) =>
        old
          ? {
              ...old,
              server_time: result.server_time,
              items: old.items.map((q) =>
                updates.has(q.id) ? { ...q, saved: updates.get(q.id)! } : q,
              ),
            }
          : old,
      );
      setDrafts((old) =>
        Object.fromEntries(
          Object.entries(old).filter(([id]) => !updates.has(id)),
        ),
      );
      void cache.invalidateQueries({
        predicate: (q) =>
          String(q.queryKey[0]) === path ||
          String(q.queryKey[0]).startsWith(`/challenges?scope=${scope}`) ||
          String(q.queryKey[0]).startsWith(`/scoreboard?scope=${scope}`),
      });
    },
  });
  return {
    query,
    dirty,
    edited: (id: string) => !!drafts[id],
    response,
    state,
    change,
    branches,
    needsBranchSelection,
    finalQuestions,
    selectBranch: (group: string, id: string) =>
      setBranchChoices((old) => ({ ...old, [group]: id })),
    submit,
    reload: async () => {
      const result = await query.refetch();
      if (!result.error) {
        setDrafts({});
        submit.reset();
      }
    },
  };
}
export type ObjectivePaperModel = ReturnType<typeof useObjectivePaper>;
