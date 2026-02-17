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
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-3">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="avatar" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/20 text-sm font-semibold text-amber-200">
          {initials}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{user.name ?? "Signed in"}</p>
        <p className="truncate text-xs text-slate-400">{user.email ?? "mock admin"}</p>
      </div>
    </div>
  );
}

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
};
