import { Link } from "react-router-dom";
import { CheckCircle2, Lock, BookOpen, Flag } from "lucide-react";
import type { LearningNode } from "@/lib/types";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { learningContentHref } from "@/lib/learning-navigation";
export function SkillNode({
  node: n,
  returnTo,
}: {
  node: LearningNode;
  returnTo: string;
}) {
  return (
    <Card className="min-w-0 border-0 gap-3 p-0 shadow-none">
      <div className="flex items-center justify-between gap-3 [&>svg]:shrink-0 [&>[data-slot=badge]]:shrink-0">
        <h2
          title={n.title}
          className={`min-w-0 line-clamp-2 break-words font-medium ${n.unlocked ? "" : "text-muted-foreground"}`}
        >
          {n.title}
        </h2>
        {n.completed ? (
          <CheckCircle2 className="size-5 text-success" />
        ) : n.unlocked ? (
          <Badge>可学习</Badge>
        ) : (
          <Lock className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="mt-2 grid gap-2">
        {n.article_id &&
          (n.unlocked && n.slug ? (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="nodrag nopan h-auto min-h-8 whitespace-normal text-left"
            >
              <Link to={learningContentHref(`/library/${n.slug}`, returnTo)}>
                <BookOpen />
                <span
                  className="min-w-0 line-clamp-2 break-words"
                  title={n.article_title ?? undefined}
                >
                  {n.article_title}
                </span>
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="h-auto min-h-8 whitespace-normal"
            >
              <BookOpen />
              <span
                className="min-w-0 line-clamp-2 break-words"
                title={n.article_title ?? undefined}
              >
                {n.article_title ?? "文档暂未开放"}
              </span>
            </Button>
          ))}
        {n.challenge_id &&
          (n.unlocked && n.challenge_title ? (
            <Button
              variant="outline"
              size="sm"
              asChild
              className="nodrag nopan h-auto min-h-8 whitespace-normal text-left"
            >
              <Link
                to={learningContentHref(
                  `/challenges?challenge=${n.challenge_id}`,
                  returnTo,
                )}
              >
                <Flag />
                <span
                  className="min-w-0 line-clamp-2 break-words"
                  title={n.challenge_title ?? undefined}
                >
                  {n.challenge_title}
                </span>
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="h-auto min-h-8 whitespace-normal"
            >
              <Flag />
              <span
                className="min-w-0 line-clamp-2 break-words"
                title={n.challenge_title ?? undefined}
              >
                {n.challenge_title ?? "练习暂未开放"}
              </span>
            </Button>
          ))}
      </div>
    </Card>
  );
}
