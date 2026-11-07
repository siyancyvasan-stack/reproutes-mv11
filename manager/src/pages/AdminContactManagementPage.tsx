import React from "react";
import { Link2, Loader2, Save, Trash2 } from "lucide-react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { useToast } from "../context/ToastContext";
import {
  AssignmentType,
  ContactAdminUser,
  ContactAssignment,
  createContactAssignment,
  deleteContactAssignment,
  loadContactAdmin,
  updateContactUser,
  updateCountryCode,
} from "../services/contactApi";

const definitions: Array<{
  type: AssignmentType;
  first: ContactAdminUser["role"];
  second: ContactAdminUser["role"];
  label: string;
}> = [
  {
    type: "SALES_MANAGER",
    first: "AGENT",
    second: "MANAGER",
    label: "Sales Person → Manager",
  },
  {
    type: "SALES_FACTORY_MANAGER",
    first: "AGENT",
    second: "FACTORY_MANAGER",
    label: "Sales Person → Factory Manager",
  },
  {
    type: "MANAGER_FACTORY_MANAGER",
    first: "MANAGER",
    second: "FACTORY_MANAGER",
    label: "Manager → Factory Manager",
  },
];

export const AdminContactManagementPage = () => {
  const { showToast } = useToast();
  const [users, setUsers] = React.useState<ContactAdminUser[]>([]);
  const [assignments, setAssignments] = React.useState<ContactAssignment[]>([]);
  const [code, setCode] = React.useState("94");
  const [loading, setLoading] = React.useState(true);
  const [type, setType] = React.useState<AssignmentType>("SALES_MANAGER");
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const refresh = React.useCallback(
    () =>
      loadContactAdmin()
        .then((data) => {
          setUsers(data.users);
          setAssignments(data.assignments);
          setCode(data.phoneCountryCode);
        })
        .finally(() => setLoading(false)),
    [],
  );
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  const definition = definitions.find((item) => item.type === type)!;
  const name = (id: string) =>
    users.find((user) => user.id === id)?.name ?? "Unknown user";
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  return (
    <ManagerLayout>
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-extrabold text-white">
          <Link2 className="text-cyan-400" />
          Contact Administration
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Maintain protected phone details and role assignments.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-white">
        <h3 className="font-bold">Default calling code</h3>
        <div className="mt-3 flex max-w-sm gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 p-3"
          />
          <button
            onClick={() =>
              void updateCountryCode(code).then(() =>
                showToast("Saved", "Calling code updated.", "success"),
              )
            }
            className="rounded-xl bg-cyan-500 px-4 font-bold text-slate-950"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-white">
        <h3 className="font-bold">User contact details</h3>
        <div className="mt-4 space-y-3">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              onSave={async (phone, wa) => {
                await updateContactUser(user.id, phone, wa);
                await refresh();
                showToast(
                  "Saved",
                  `${user.name}'s contact details updated.`,
                  "success",
                );
              }}
            />
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-white">
        <h3 className="font-bold">Assignments</h3>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as AssignmentType);
              setA("");
              setB("");
            }}
            className="rounded-xl border border-slate-700 bg-slate-950 p-3"
          >
            {definitions.map((d) => (
              <option key={d.type} value={d.type}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={a}
            onChange={(e) => setA(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 p-3"
          >
            <option value="">Select {definition.first.toLowerCase()}</option>
            {users
              .filter((u) => u.role === definition.first)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <select
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 p-3"
          >
            <option value="">Select {definition.second.toLowerCase()}</option>
            {users
              .filter((u) => u.role === definition.second)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <button
            disabled={!a || !b}
            onClick={() =>
              void createContactAssignment({ userAId: a, userBId: b, type })
                .then(() => {
                  setA("");
                  setB("");
                  return refresh();
                })
                .catch((err) =>
                  showToast(
                    "Unable to assign",
                    err instanceof Error ? err.message : "Assignment failed",
                    "error",
                  ),
                )
            }
            className="rounded-xl bg-cyan-500 p-3 font-bold text-slate-950 disabled:opacity-40"
          >
            Add assignment
          </button>
        </div>
        <div className="mt-5 space-y-2">
          {assignments.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-xl bg-slate-950/70 p-3 text-sm"
            >
              <span>
                {name(item.userAId)} → {name(item.userBId)}{" "}
                <small className="ml-2 text-slate-500">
                  {item.type.replaceAll("_", " ")}
                </small>
              </span>
              <button
                aria-label="Delete assignment"
                onClick={() =>
                  void deleteContactAssignment(item.id).then(refresh)
                }
                className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </ManagerLayout>
  );
};

const UserRow = ({
  user,
  onSave,
}: {
  key?: React.Key;
  user: ContactAdminUser;
  onSave: (phone: string, wa: string) => Promise<void>;
}) => {
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [wa, setWa] = React.useState(user.whatsappNumber ?? "");
  return (
    <div className="grid items-center gap-2 rounded-xl bg-slate-950/70 p-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
      <div>
        <b>{user.name}</b>
        <p className="text-xs text-cyan-400">{user.role.replace("_", " ")}</p>
      </div>
      <input
        aria-label={`${user.name} phone`}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone"
        className="rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm"
      />
      <input
        aria-label={`${user.name} WhatsApp`}
        value={wa}
        onChange={(e) => setWa(e.target.value)}
        placeholder="WhatsApp"
        className="rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-sm"
      />
      <button
        onClick={() => void onSave(phone, wa)}
        className="rounded-lg bg-indigo-600 p-2.5"
      >
        <Save className="h-4 w-4" />
      </button>
    </div>
  );
};
