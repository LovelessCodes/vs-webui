import { Check, KeyRound, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUser, useDeleteUser, useMe, useUpdateUser, useUsers } from "@/hooks/use-api";
import type { UserRole } from "@/lib/api";
import { errorMessage } from "@/lib/format";

const ROLES: UserRole[] = ["owner", "operator", "viewer"];

/** Owner-only user management. Operators and viewers never see this card. */
export default function UsersCard() {
  const { t } = useTranslation();
  const me = useMe();
  const isOwner = me.data?.user?.role === "owner";

  const users = useUsers(isOwner);
  const create = useCreateUser();
  const update = useUpdateUser();
  const remove = useDeleteUser();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("operator");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  if (!isOwner) return null;

  const roleItems = ROLES.map((value) => ({ value, label: t(`settings.role.${value}`) }));
  const mutationError = create.error ?? update.error ?? remove.error;

  function addUser() {
    if (!name.trim() || password.length < 8) return;
    create.mutate(
      { name: name.trim(), password, role },
      {
        onSuccess: () => {
          setName("");
          setPassword("");
          setRole("operator");
        },
      },
    );
  }

  return (
    <Card className="self-start lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="size-4 text-muted-foreground" />
          {t("settings.usersTitle")}
        </CardTitle>
        <CardDescription>{t("settings.usersDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="user-name">{t("settings.userName")}</Label>
            <Input
              className="w-44"
              id="user-name"
              onChange={(event) => setName(event.target.value)}
              placeholder={t("settings.userNamePlaceholder")}
              value={name}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="user-password">{t("settings.userPassword")}</Label>
            <Input
              className="w-44"
              id="user-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("settings.roleLabel")}</Label>
            <Select
              items={roleItems}
              onValueChange={(value) => {
                if (typeof value === "string") setRole(value as UserRole);
              }}
              value={role}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!name.trim() || password.length < 8 || create.isPending}
            onClick={addUser}
            size="sm"
            variant="accent-primary"
          >
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("settings.userAdd")}
          </Button>
        </div>

        {mutationError && <p className="text-error text-xs">{errorMessage(mutationError)}</p>}

        {users.data && users.data.users.length > 0 && (
          <div className="border border-border">
            <div className="flex items-center gap-3 border-b border-border bg-card px-3 py-2 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              <span className="flex-1">{t("settings.userName")}</span>
              <span className="w-32">{t("settings.roleLabel")}</span>
              <span className="hidden w-40 sm:block">{t("settings.userCreatedAt")}</span>
              <span className="w-40 text-right" />
            </div>
            <div className="divide-y divide-border">
              {users.data.users.map((user) => (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5" key={user.id}>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {user.name}
                    {user.name === me.data?.user?.name && (
                      <span className="ml-2 text-[10px] text-muted-foreground uppercase">
                        {t("settings.userYou")}
                      </span>
                    )}
                  </span>
                  <div className="w-32">
                    <Select
                      items={roleItems}
                      onValueChange={(value) => {
                        if (typeof value === "string" && value !== user.role) {
                          update.mutate({ id: user.id, role: value as UserRole });
                        }
                      }}
                      value={user.role}
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {roleItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="hidden w-40 font-mono text-[11px] text-muted-foreground sm:block">
                    {new Date(user.created * 1000).toLocaleString()}
                  </span>
                  <div className="flex w-40 shrink-0 items-center justify-end gap-1.5">
                    {passwordFor === user.id ? (
                      <>
                        <Input
                          autoFocus
                          className="w-40"
                          onChange={(event) => setNewPassword(event.target.value)}
                          placeholder={t("settings.userNewPassword")}
                          type="password"
                          value={newPassword}
                        />
                        <Button
                          disabled={newPassword.length < 8 || update.isPending}
                          onClick={() =>
                            update.mutate(
                              { id: user.id, password: newPassword },
                              {
                                onSuccess: () => {
                                  setPasswordFor(null);
                                  setNewPassword("");
                                },
                              },
                            )
                          }
                          size="icon-sm"
                          title={t("common.save")}
                          variant="ghost"
                        >
                          {update.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                        </Button>
                        <Button
                          onClick={() => {
                            setPasswordFor(null);
                            setNewPassword("");
                          }}
                          size="icon-sm"
                          title={t("common.cancel")}
                          variant="ghost"
                        >
                          <span className="text-[11px]">{t("common.cancel")}</span>
                        </Button>
                      </>
                    ) : confirm === user.id ? (
                      <>
                        <span className="text-muted-foreground text-[11px]">
                          {t("settings.userDeleteQuestion")}
                        </span>
                        <Button
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate(user.id, { onSuccess: () => setConfirm(null) })
                          }
                          size="sm"
                          variant="destructive"
                        >
                          {t("common.yes")}
                        </Button>
                        <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                          {t("common.cancel")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={() => {
                            setPasswordFor(user.id);
                            setNewPassword("");
                          }}
                          size="icon-sm"
                          title={t("settings.userResetPassword")}
                          variant="ghost"
                        >
                          <KeyRound />
                        </Button>
                        <Button
                          onClick={() => setConfirm(user.id)}
                          size="icon-sm"
                          title={t("settings.userDeleteTitle")}
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
