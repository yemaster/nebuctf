import type { User } from "./types";

export type HelpDocumentSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  position: number;
  updated_at: string;
};

export type HelpDocument = HelpDocumentSummary & {
  body: string;
  published: boolean;
  created_at: string;
  author: Pick<User, "id" | "username" | "avatar_id"> | null;
  editor: Pick<User, "id" | "username" | "avatar_id"> | null;
};

export type HelpDocumentGroup = {
  category: string;
  documents: HelpDocumentSummary[];
};

// Keep the API's order within each category, and categories in first-seen order.
export function groupHelpDocuments(
  items: HelpDocumentSummary[],
): HelpDocumentGroup[] {
  const groups = new Map<string, HelpDocumentSummary[]>();
  for (const item of items) {
    const group = groups.get(item.category);
    if (group) group.push(item);
    else groups.set(item.category, [item]);
  }
  return Array.from(groups, ([category, documents]) => ({
    category,
    documents,
  }));
}
