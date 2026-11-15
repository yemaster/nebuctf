export type ContainerStartUsage = {
  limit: number;
  remaining: number;
  blocked: boolean;
  used: number;
  pending: number;
};
export function ContainerStartHint({
  value,
}: {
  value?: ContainerStartUsage | null;
}) {
  if (!value) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {value.blocked
        ? value.limit === 0
          ? "本题未开放靶机开启"
          : "开启次数已用完"
        : `还剩 ${value.remaining} 次开启`}
    </p>
  );
}
