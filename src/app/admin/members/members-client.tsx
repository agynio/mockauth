"use client";

import { useMemo, useState, useTransition } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Copy, Loader2, Trash2, UserPlus, XCircle } from "lucide-react";

import type { MembershipRole } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
} from "@/app/admin/actions";

type MemberRecord = {
  id: string;
  role: MembershipRole;
  adminUser: { id: string; name: string | null; email: string | null };
  createdAt: string;
};

type InviteRecord = {
  id: string;
  tenantId: string;
  role: MembershipRole;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  createdBy: { name: string | null; email: string | null };
  usedBy: { name: string | null; email: string | null } | null;
};

const roleLabels: Record<MembershipRole, string> = {
  OWNER: "Owner",
  WRITER: "Writer",
  READER: "Reader",
};

const inviteExpiryOptions = ["1", "24", "168"] as const;
type InviteExpiryOption = (typeof inviteExpiryOptions)[number];

type MembersClientProps = {
  tenantId: string;
  tenantName: string;
  viewerId: string;
  viewerRole: MembershipRole;
  members: MemberRecord[];
  invites: InviteRecord[];
};

type InviteTokenMap = Record<string, string>;

export function MembersClient({ tenantId, tenantName, viewerId, viewerRole, members, invites }: MembersClientProps) {
  const { toast } = useToast();
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [inviteTokens, setInviteTokens] = useState<InviteTokenMap>({});
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const ownersCount = useMemo(() => members.filter((member) => member.role === "OWNER").length, [members]);
  const canManageMembers = viewerRole === "OWNER";

  const handleRoleChange = (membershipId: string, role: MembershipRole) => {
    if (!canManageMembers) return;
    setPendingMemberId(membershipId);
    startTransition(async () => {
      const response = await updateMemberRoleAction({ tenantId, membershipId, role });
      if (response.error) {
        toast({ variant: "destructive", title: "Unable to update member", description: response.error });
      } else {
        toast({ title: "Member updated" });
      }
      setPendingMemberId(null);
    });
  };

  const handleRemoveMember = (membershipId: string) => {
    setRemovingId(membershipId);
    startTransition(async () => {
      const response = await removeMemberAction({ tenantId, membershipId });
      if (response.error) {
        toast({ variant: "destructive", title: "Unable to remove member", description: response.error });
      } else {
        toast({ title: "Member removed" });
      }
      setRemovingId(null);
    });
  };

  const handleInviteCreated = (inviteId: string, token: string) => {
    setInviteTokens((prev) => ({ ...prev, [inviteId]: token }));
  };

  const handleCopyInvite = async (inviteId: string) => {
    const token = inviteTokens[inviteId];
    if (!token) {
      toast({ variant: "destructive", title: "Invite token unavailable", description: "Create a new invite to copy its link." });
      return;
    }
    const base = window.location.origin;
    const link = `${base}/admin/invite/${inviteId}?token=${token}`;
    await navigator.clipboard.writeText(link);
    toast({ title: "Invite link copied" });
  };

  const handleRevokeInvite = (inviteId: string) => {
    setRevokeId(inviteId);
    startTransition(async () => {
      const response = await revokeInviteAction({ tenantId, inviteId });
      if (response.error) {
        toast({ variant: "destructive", title: "Unable to revoke invite", description: response.error });
      } else {
        toast({ title: "Invite revoked" });
      }
      setRevokeId(null);
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Collaboration</h1>
        <p className="text-muted-foreground">Manage who can work on {tenantName}.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>Owners control access. Writers can configure clients. Readers have view-only access.</CardDescription>
            </div>
            {canManageMembers && <InviteDialog tenantId={tenantId} onInviteCreated={handleInviteCreated} />}
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="w-40">Role</TableHead>
                    <TableHead className="w-32 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const isViewer = member.adminUser.id === viewerId;
                    const isLastOwner = member.role === "OWNER" && ownersCount === 1;
                    const roleDisabled = !canManageMembers || (isLastOwner && member.role === "OWNER");
                    const disableRemoval = roleDisabled || isViewer;
                    return (
                      <TableRow key={member.id} data-testid="member-row">
                        <TableCell>
                          <div className="font-medium">{member.adminUser.name ?? "Unknown user"}</div>
                          <div className="text-xs text-muted-foreground">{member.adminUser.email ?? "No email"}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>Joined {format(new Date(member.createdAt), "LLL d, yyyy")}</span>
                            {isViewer && <Badge variant="outline">You</Badge>}
                            {isLastOwner && <Badge variant="secondary">Last owner</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {canManageMembers ? (
                            <Select
                              value={member.role}
                              onValueChange={(value) => handleRoleChange(member.id, value as MembershipRole)}
                              disabled={roleDisabled || isPending || pendingMemberId === member.id}
                            >
                              <SelectTrigger aria-label="Member role">
                                <SelectValue placeholder="Role" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="OWNER">Owner</SelectItem>
                                <SelectItem value="WRITER">Writer</SelectItem>
                                <SelectItem value="READER">Reader</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline">{roleLabels[member.role]}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManageMembers ? (
                            <RemoveMemberDialog
                              disabled={disableRemoval || isPending}
                              onConfirm={() => handleRemoveMember(member.id)}
                              pending={removingId === member.id}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">No actions</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invites</CardTitle>
            <CardDescription>Share links to add writers or readers. Links expire automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending invites.</p>
            ) : (
              <div className="space-y-4">
                {invites.map((invite) => {
                  const status = resolveInviteStatus(invite);
                  const tokenAvailable = Boolean(inviteTokens[invite.id]);
                  return (
                    <div key={invite.id} className="rounded-lg border p-3" data-testid="invite-row">
                      <div className="flex flex-col gap-1 text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{roleLabels[invite.role]}</Badge>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                        <div className="text-muted-foreground">
                          Created {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })} · Expires {formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true })}
                        </div>
                        {invite.usedBy && (
                          <p className="text-muted-foreground">Used by {invite.usedBy.name ?? invite.usedBy.email}</p>
                        )}
                      </div>
                      {canManageMembers && status.actionable && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleCopyInvite(invite.id)} disabled={!tokenAvailable || isPending} data-testid="invite-copy">
                            <Copy className="mr-2 h-4 w-4" /> Copy link
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleRevokeInvite(invite.id)} disabled={isPending}>
                            {revokeId === invite.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />} Revoke
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
          {!canManageMembers && (
            <CardFooter>
              <p className="text-xs text-muted-foreground">Only owners can create or revoke invites.</p>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}

const resolveInviteStatus = (invite: InviteRecord): { label: string; variant: "secondary" | "outline"; actionable: boolean } => {
  if (invite.revokedAt) {
    return { label: "Revoked", variant: "outline", actionable: false };
  }
  if (invite.usedAt) {
    return { label: "Used", variant: "outline", actionable: false };
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    return { label: "Expired", variant: "outline", actionable: false };
  }
  return { label: "Active", variant: "secondary", actionable: true };
};

const RemoveMemberDialog = ({ onConfirm, disabled, pending }: { onConfirm: () => void; disabled: boolean; pending: boolean }) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} data-testid="member-remove">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove member?</AlertDialogTitle>
          <AlertDialogDescription>They will immediately lose access to this tenant.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const InviteDialog = ({ tenantId, onInviteCreated }: { tenantId: string; onInviteCreated: (inviteId: string, token: string) => void }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"WRITER" | "READER">("WRITER");
  const [expiresIn, setExpiresIn] = useState<InviteExpiryOption>("24");
  const [result, setResult] = useState<{ inviteId: string; token: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const response = await createInviteAction({ tenantId, role, expiresInHours: expiresIn });
      if (response.error || !response.data) {
        toast({ variant: "destructive", title: "Unable to create invite", description: response.error });
        return;
      }
      onInviteCreated(response.data.inviteId, response.data.token);
      setResult(response.data);
    });
  };

  const close = () => {
    setOpen(false);
    setResult(null);
  };

  const inviteLink = result ? `${typeof window !== "undefined" ? window.location.origin : ""}/admin/invite/${result.inviteId}?token=${result.token}` : "";

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a collaborator</DialogTitle>
          <DialogDescription>Select a role and expiration for the invite link.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>Share this link</AlertTitle>
              <AlertDescription>It will only be shown once. Copy it before closing.</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly data-testid="invite-link" />
              <Button
                type="button"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                data-testid="invite-copy-inline"
              >
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select value={role} onValueChange={(value) => setRole(value as "WRITER" | "READER")}> 
                <SelectTrigger aria-label="Invite role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WRITER">Writer</SelectItem>
                  <SelectItem value="READER">Reader</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Expiration</label>
              <Select value={expiresIn} onValueChange={(value) => setExpiresIn(value as InviteExpiryOption)}>
                <SelectTrigger aria-label="Invite expiration">
                  <SelectValue placeholder="Select duration" />
                </SelectTrigger>
                <SelectContent>
                  {inviteExpiryOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "1" ? "1 hour" : option === "24" ? "24 hours" : "7 days"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create invite
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
