import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Props = {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export function UserBadge({ user }: Props) {
  const initials = getInitials(user.name ?? user.email ?? "User");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/80 px-3 py-3" data-testid="sidebar-user-badge">
      <Avatar>
        {user.image ? <AvatarImage src={user.image} alt="avatar" /> : null}
        <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{user.name ?? "Signed in"}</p>
        <p className="truncate text-xs text-muted-foreground">{user.email ?? "mock admin"}</p>
      </div>
    </div>
  );
}

const getInitials = (value: string) => {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
};
