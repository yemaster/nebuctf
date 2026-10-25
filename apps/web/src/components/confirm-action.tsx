import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import type { ReactNode } from "react";
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirm = "确认",
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  confirm?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !pending && onOpenChange(value)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending ? "处理中" : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
