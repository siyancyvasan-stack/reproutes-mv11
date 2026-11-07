import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { ExportButton } from "../components/common/ExportButton";
import { GlassCard } from "../components/common/GlassCard";
import { Badge } from "../components/common/Badge";
import { Modal } from "../components/common/Modal";
import { ConfirmationDialog } from "../components/common/OverlayComponents";
import { Agent } from "../types";
import { useToast } from "../context/ToastContext";
import {
  assignAgentDestination,
  createAgent,
  deleteAgent,
  updateAgent,
  loadAgents,
} from "../services/domainApi";
import { DestinationLocationPicker } from "../components/map/DestinationLocationPicker";
import { ApiError, apiRequest } from "../services/apiClient";
import {
  Contact,
  callUrl,
  loadContacts,
  whatsappUrl,
} from "../services/contactApi";
import { useAuth } from "../context/AuthContext";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { AgentAvatarModal } from "../components/common/AgentAvatarModal";
import { downloadAgents } from "../services/agentsExport";
import { findSriLankanPlace } from "../services/placeSearch";
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Truck,
  TrendingUp,
  ShoppingBag,
  Check,
  Camera,
  MessageCircle,
  Trash2,
  Pencil,
} from "lucide-react";

export const ManagerAgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [contactByAgent, setContactByAgent] = useState<Record<string, Contact>>(
    {},
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [destinationAgent, setDestinationAgent] = useState<Agent | null>(null);
  const [avatarAgent, setAvatarAgent] = useState<Agent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [shopName, setShopName] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [destinationLatitude, setDestinationLatitude] = useState("");
  const [destinationLongitude, setDestinationLongitude] = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [isSavingDestination, setIsSavingDestination] = useState(false);
  const [isFindingDestination, setIsFindingDestination] = useState(false);
  const [destinationMatch, setDestinationMatch] = useState("");
  const [agentShops, setAgentShops] = useState<Array<Record<string, any>>>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  useEffect(() => {
    void loadContacts()
      .then(({ contacts }) =>
        setContactByAgent(
          Object.fromEntries(
            contacts
              .filter((contact) => contact.role === "AGENT")
              .map((contact) => [contact.id, contact]),
          ),
        ),
      )
      .catch(() => undefined);
  }, []);

  // New Agent Form State
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRoute, setNewRoute] = useState("Route A - Maharagama");
  const [newPassword, setNewPassword] = useState("Agent@123");
  const [newEmployeeCode, setNewEmployeeCode] = useState("TF-101");
  const [newVehicleNo, setNewVehicleNo] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const getNextEmployeeCode = (currentAgents: Agent[]) => {
    const highestCode = currentAgents.reduce((highest, agent) => {
      const match = /^TF-(\d+)$/.exec(agent.employeeCode);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 100);
    return `TF-${String(highestCode + 1).padStart(3, "0")}`;
  };

  useEffect(() => {
    loadAgents([])
      .then(setAgents)
      .catch(() => {
        showToast(
          "Agents Unavailable",
          "Unable to load agents from the database.",
          "error",
        );
      });
  }, [showToast]);

  const filteredAgents = agents.filter((ag) => {
    const matchesSearch =
      ag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ag.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ag.routeAssigned.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "All" || ag.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDeleteAgent = async () => {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAgent(pendingDelete.id);
      setAgents((current) =>
        current.filter((agent) => agent.id !== pendingDelete.id),
      );
      setContactByAgent((current) => {
        const remaining = { ...current };
        delete remaining[pendingDelete.id];
        return remaining;
      });
      setPendingDelete(null);
      window.dispatchEvent(new Event("reproutes:agent-created"));
      showToast(
        "Agent removed",
        `${pendingDelete.name} was removed from the agent roster.`,
        "success",
      );
    } catch (error) {
      showToast(
        "Unable to remove agent",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;
    const normalizedEmail = newEmail.trim().toLowerCase();
    const duplicateEmail = agents.some(
      (agent) => agent.id !== editingAgent?.id && agent.email.toLowerCase() === normalizedEmail,
    );
    if (duplicateEmail) {
      const emailName =
        newName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/^\.+|\.+$/g, "") || "new.agent";
      setFormError(
        `${normalizedEmail} is already registered. Use a unique email such as ${emailName}@reproutes.com.`,
      );
      return;
    }
    let normalizedEmployeeCode = newEmployeeCode.trim().toUpperCase();
    const duplicateEmployeeCode = agents.some(
      (agent) => agent.id !== editingAgent?.id && agent.employeeCode.toUpperCase() === normalizedEmployeeCode,
    );
    if (normalizedEmployeeCode && duplicateEmployeeCode) {
      const nextEmployeeCode = getNextEmployeeCode(agents);
      normalizedEmployeeCode = nextEmployeeCode;
      setNewEmployeeCode(nextEmployeeCode);
    }
    setFormError("");
    setIsCreating(true);
    try {
      const payload = {
        name: newName.trim(),
        email: normalizedEmail,
        ...(editingAgent ? (newPassword ? { password: newPassword } : {}) : { password: newPassword || "Agent@123" }),
        employeeCode: normalizedEmployeeCode || getNextEmployeeCode(agents),
        phone: newPhone.trim() || undefined,
        routeAssigned: newRoute,
        vehicleNo: newVehicleNo.trim() || undefined,
      };
      if (editingAgent) await updateAgent(editingAgent.id, payload);
      else await createAgent({ ...payload, password: newPassword || "Agent@123" });
      const storedAgents = await loadAgents([]);
      const newAgent = storedAgents.find(
        (agent) => agent.email === normalizedEmail,
      );
      if (!newAgent)
        throw new Error(
          "Agent was not returned by the database after creation.",
        );
      setAgents(storedAgents);
      window.dispatchEvent(new Event("reproutes:agent-created"));
      setIsAddModalOpen(false);
      setEditingAgent(null);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewPassword("Agent@123");
      setNewEmployeeCode(getNextEmployeeCode(storedAgents));
      setNewVehicleNo("");
      setFormError("");
      showToast(editingAgent ? "Agent Updated" : "New Agent Added", editingAgent ? `${newName} details updated successfully.` : `${newAgent.name} can now sign in with ${newAgent.email}.`, "success");
    } catch (error) {
      const nextEmployeeCode = getNextEmployeeCode(agents);
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "EMPLOYEE_CODE_ALREADY_EXISTS"
      ) {
        setNewEmployeeCode(nextEmployeeCode);
      }
      const message =
        error instanceof ApiError && error.status === 409
          ? error.code === "EMPLOYEE_CODE_ALREADY_EXISTS"
            ? `This employee code is already assigned. Employee Code was updated to ${nextEmployeeCode}; click Add Agent again.`
            : "This email is already registered. Enter a different email for the new agent."
          : error instanceof Error
            ? error.message
            : "Unable to create this agent.";
      setFormError(message);
      showToast("Agent Creation Failed", message, "error");
    } finally {
      setIsCreating(false);
    }
  };

  const openEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setNewName(agent.name);
    setNewEmail(agent.email);
    setNewPhone(agent.phone ?? "");
    setNewEmployeeCode(agent.employeeCode);
    setNewVehicleNo(agent.vehicleNo ?? "");
    setNewRoute(agent.routeAssigned ?? "");
    setNewPassword("");
    setFormError("");
    setIsAddModalOpen(true);
  };

  const openDestinationModal = (agent: Agent) => {
    setDestinationAgent(agent);
    setShopName(agent.destination?.label ?? "");
    setShopAddress(agent.destinationAddress ?? "");
    setDestinationLatitude(
      agent.destination ? String(agent.destination.lat) : "",
    );
    setDestinationLongitude(
      agent.destination ? String(agent.destination.lng) : "",
    );
    setDestinationError("");
    setDestinationMatch("");
    setSelectedShopId("");
    void apiRequest<any>(`/api/v1/shops?limit=100&salespersonId=${encodeURIComponent(agent.id)}`)
      .then((result) => {
        const shops = result.items ?? [];
        setAgentShops(shops);
        if (shops.length === 1) {
          const shop = shops[0];
          setSelectedShopId(shop.id);
          setShopName(shop.name ?? "");
          setShopAddress(shop.address ?? shop.city ?? "");
          setDestinationLatitude(shop.latitude == null ? "" : String(shop.latitude));
          setDestinationLongitude(shop.longitude == null ? "" : String(shop.longitude));
          setDestinationMatch("Registered shop details loaded automatically.");
        }
      })
      .catch(() => setAgentShops([]));
  };

  const selectRegisteredShop = (shopId: string) => {
    setSelectedShopId(shopId);
    const shop = agentShops.find((item) => item.id === shopId);
    if (!shop) return;
    setShopName(shop.name ?? "");
    setShopAddress(shop.address ?? shop.city ?? "");
    setDestinationLatitude(shop.latitude == null ? "" : String(shop.latitude));
    setDestinationLongitude(shop.longitude == null ? "" : String(shop.longitude));
    setDestinationMatch("Registered shop details loaded automatically.");
    setDestinationError("");
  };

  useEffect(() => {
    if (!destinationAgent || shopAddress.trim().length < 3) return;
    const controller = new AbortController();
    const lookupTimer = window.setTimeout(() => {
      setIsFindingDestination(true);
      void findSriLankanPlace(shopAddress, controller.signal)
        .then((place) => {
          if (!place) {
            setDestinationMatch("Location not found. You can select it on the map instead.");
            return;
          }
          setDestinationLatitude(String(place.latitude));
          setDestinationLongitude(String(place.longitude));
          setDestinationMatch(`Location found: ${place.label}`);
          setDestinationError("");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setDestinationMatch("Could not find this location automatically. Select it on the map instead.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsFindingDestination(false);
        });
    }, 700);
    return () => {
      window.clearTimeout(lookupTimer);
      controller.abort();
      setIsFindingDestination(false);
    };
  }, [destinationAgent, shopAddress]);

  const handleSaveDestination = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!destinationAgent) return;
    const latitude = Number(destinationLatitude);
    const longitude = Number(destinationLongitude);
    if (!shopName.trim()) {
      setDestinationError("Shop Name is required.");
      return;
    }
    if (!shopAddress.trim()) {
      setDestinationError("Shop Address is required.");
      return;
    }
    if (
      !destinationLatitude.trim() ||
      !destinationLongitude.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180 ||
      (latitude === 0 && longitude === 0)
    ) {
      setDestinationError(
        "Select valid destination coordinates. Coordinates 0,0 are not allowed.",
      );
      return;
    }
    setIsSavingDestination(true);
    setDestinationError("");
    try {
      await assignAgentDestination(destinationAgent.id, {
        name: shopName.trim(),
        address: shopAddress.trim(),
        latitude,
        longitude,
      });
      const refreshedAgents = await loadAgents([]);
      setAgents(refreshedAgents);
      setDestinationAgent(null);
      window.dispatchEvent(new Event("reproutes:agent-created"));
      showToast(
        "Destination Assigned",
        `${shopName.trim()} is now assigned to ${destinationAgent.name}.`,
        "success",
      );
    } catch (error) {
      setDestinationError(
        error instanceof Error ? error.message : "Unable to save destination.",
      );
    } finally {
      setIsSavingDestination(false);
    }
  };

  return (
    <ManagerLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-cyan-400" />
            <span>Field Sales Agents Roster</span>
          </h2>
          <p className="text-xs text-slate-400">
            Manage agent assignments, contact information, routes, and
            performance
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ExportButton
            dataset="agents"
            pdf
            formats={["csv", "pdf"]}
            disabled={filteredAgents.length === 0}
            onExport={(format) =>
              downloadAgents(filteredAgents, format as "csv" | "pdf")
            }
          />
          <button
            onClick={() => {
              setEditingAgent(null);
              setNewName("");
              setNewEmail("");
              setNewPhone("");
              setNewEmployeeCode(getNextEmployeeCode(agents));
              setNewPassword("Agent@123");
              setFormError("");
              setIsAddModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Field Agent</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <GlassCard className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, code or route..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl glass-input"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {["All", "Active", "On Break", "Offline"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                statusFilter === st
                  ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                  : "text-slate-400 hover:text-white bg-slate-900/60"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Agents Roster Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAgents.map((agent) => (
          <GlassCard
            key={agent.id}
            interactive
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/agents/${agent.id}/activity`)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                navigate(`/agents/${agent.id}/activity`);
            }}
            className="p-6 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAvatarAgent(agent);
                    }}
                    className="relative shrink-0 rounded-2xl"
                    title={`Change ${agent.name}'s profile image`}
                  >
                    <ProfileAvatar
                      src={agent.avatar}
                      name={agent.name}
                      className="w-12 h-12 rounded-2xl object-cover border-2 border-cyan-500/30 text-xs"
                    />
                    <span className="absolute -bottom-1 -right-1 p-1 rounded-lg bg-cyan-500 text-slate-950 border-2 border-slate-900">
                      <Camera className="w-3 h-3" />
                    </span>
                  </button>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {agent.name}
                    </h3>
                    <p className="text-xs text-cyan-400 font-semibold">
                      {agent.employeeCode}
                    </p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Truck className="w-3 h-3 text-slate-500" />
                      {agent.vehicleNo}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status={agent.status} />
                  <button type="button" onClick={(event) => { event.stopPropagation(); openEditAgent(agent); }} aria-label={`Edit ${agent.name}`} title="Edit agent" className="rounded-lg p-2 text-slate-400 transition hover:bg-cyan-500/15 hover:text-cyan-300"><Pencil className="h-4 w-4" /></button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete(agent);
                    }}
                    aria-label={`Remove ${agent.name}`}
                    title="Remove agent"
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300 border-t border-slate-800 pt-3">
                <p className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{agent.routeAssigned}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-400">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{agent.phone}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-400">
                  <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">{agent.email}</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-center text-xs">
              <div>
                <span className="text-[10px] text-slate-500 font-bold block uppercase">
                  Mileage
                </span>
                <span className="font-extrabold text-cyan-400">
                  {agent.distanceKm} KM
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold block uppercase">
                  Orders
                </span>
                <span className="font-extrabold text-white">
                  {agent.ordersCount}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold block uppercase">
                  Sales
                </span>
                <span className="font-extrabold text-emerald-400">
                  LKR {(agent.todayRevenueLkr / 1000).toFixed(0)}k
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDestinationModal(agent);
              }}
              className="w-full px-3 py-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-300 text-xs font-bold flex items-center justify-center gap-2 hover:bg-cyan-500/15"
            >
              <MapPin className="w-3.5 h-3.5" />
              Assign Destination
            </button>
            {contactByAgent[agent.id] && (
              <div className="grid grid-cols-2 gap-2">
                {contactByAgent[agent.id].whatsappNumber ? (
                  <a
                    onClick={(event) => event.stopPropagation()}
                    href={whatsappUrl(
                      contactByAgent[agent.id].whatsappNumber!,
                      user?.name ?? "Reproutes manager",
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-2 py-2.5 text-xs font-bold text-white"
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
                ) : (
                  <span className="rounded-xl bg-amber-500/10 p-2 text-center text-[10px] text-amber-400">
                    WhatsApp unavailable
                  </span>
                )}
                {contactByAgent[agent.id].phone ? (
                  <a
                    onClick={(event) => event.stopPropagation()}
                    href={callUrl(contactByAgent[agent.id].phone!)}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 px-2 py-2.5 text-xs font-bold text-cyan-300"
                  >
                    <Phone className="h-4 w-4" />
                    Call
                  </a>
                ) : (
                  <span />
                )}
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {/* ADD AGENT MODAL */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingAgent ? "Edit Field Sales Agent" : "Add New Field Sales Agent"}
        stickyActions
        scrollControls
      >
        <form
          onSubmit={handleCreateAgent}
          className="agent-form-contrast space-y-4"
        >
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sunil Shantha"
              className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setFormError("");
              }}
              placeholder="e.g. sunil@reproutes.com"
              className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
            />
            {formError && (
              <p
                className="mt-1.5 text-xs font-semibold text-rose-600"
                role="alert"
              >
                {formError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
                Employee Code
              </label>
              <input
                type="text"
                value={newEmployeeCode}
                onChange={(e) => setNewEmployeeCode(e.target.value)}
                placeholder="e.g. TF-106"
                className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
                Temporary Password
              </label>
              <input
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={editingAgent ? "Leave blank to keep current password" : "Minimum 8 characters"}
                className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
              Vehicle Number
            </label>
            <input
              type="text"
              value={newVehicleNo}
              onChange={(e) => setNewVehicleNo(e.target.value)}
              placeholder="e.g. WP CAB-1000"
              className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
              Phone Number
            </label>
            <input
              type="text"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="+94 77 123 4567"
              className="w-full px-4 py-2.5 text-xs rounded-xl glass-input"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase mb-1">
              Assigned Route
            </label>
            <select
              value={newRoute}
              onChange={(e) => setNewRoute(e.target.value)}
              className="w-full px-4 py-2.5 text-xs rounded-xl glass-input bg-slate-900"
            >
              <option value="Route A - Maharagama & Pannipitiya">
                Route A - Maharagama & Pannipitiya
              </option>
              <option value="Route B - Dehiwala & Mount Lavinia">
                Route B - Dehiwala & Mount Lavinia
              </option>
              <option value="Route C - Nugegoda & Kohuwala">
                Route C - Nugegoda & Kohuwala
              </option>
              <option value="Route D - Colombo 05 & 06">
                Route D - Colombo 05 & 06
              </option>
            </select>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-5 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary"
            >
              {isCreating ? "Creating…" : "Add Agent"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmationDialog
        isOpen={Boolean(pendingDelete)}
        onClose={() => !isDeleting && setPendingDelete(null)}
        onConfirm={handleDeleteAgent}
        title="Remove agent from roster?"
        description={`${pendingDelete?.name ?? "This agent"} will no longer be able to sign in or appear in agent lists. Existing sales and attendance history will be retained.`}
        confirmLabel="Remove agent"
        busy={isDeleting}
        destructive
      />

      {avatarAgent && (
        <AgentAvatarModal
          isOpen
          onClose={() => setAvatarAgent(null)}
          agentId={avatarAgent.id}
          agentName={avatarAgent.name}
          currentAvatar={avatarAgent.avatar}
          onChanged={(avatar) => {
            setAgents((current) =>
              current.map((agent) =>
                agent.id === avatarAgent.id ? { ...agent, avatar } : agent,
              ),
            );
            setAvatarAgent((current) =>
              current ? { ...current, avatar } : current,
            );
          }}
        />
      )}

      <Modal
        isOpen={Boolean(destinationAgent)}
        onClose={() => setDestinationAgent(null)}
        title={`Assign Destination${destinationAgent ? ` — ${destinationAgent.name}` : ""}`}
        maxWidth="2xl"
        tone="light"
        scrollControls
        draggable
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDestinationAgent(null)}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="assign-destination-form"
              disabled={isSavingDestination}
              className="glass-button-primary rounded-xl px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {isSavingDestination ? "Saving…" : "Save Destination"}
            </button>
          </div>
        }
      >
        <form
          id="assign-destination-form"
          onSubmit={handleSaveDestination}
          className="space-y-4 pb-2"
        >
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-900">
              Registered Shop
            </label>
            <select
              value={selectedShopId}
              onChange={(event) => selectRegisteredShop(event.target.value)}
              className="mb-3 h-11 w-full rounded-[10px] border border-indigo-200 bg-indigo-50 px-4 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select a shop registered by this salesperson</option>
              {agentShops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name} — {shop.city}
                </option>
              ))}
            </select>
            {!agentShops.length && (
              <p className="mb-3 text-[11px] text-slate-500">No registered shops found for this salesperson yet.</p>
            )}
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-900">
              Shop Name
            </label>
            <input
              required
              value={shopName}
              onChange={(event) => setShopName(event.target.value)}
              placeholder="Enter assigned shop name"
              className="h-11 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-900">
              Shop Address
            </label>
            <input
              required
              value={shopAddress}
              onChange={(event) => {
                setShopAddress(event.target.value);
                setDestinationMatch("");
              }}
              placeholder="Type place or complete shop address"
              className="h-11 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-xs text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1.5 text-[10px] text-slate-500" aria-live="polite">
              {isFindingDestination
                ? "Finding location and coordinates…"
                : destinationMatch || "Type an address to fill latitude and longitude automatically."}
            </p>
          </div>
          <DestinationLocationPicker
            latitude={
              destinationLatitude ? Number(destinationLatitude) : undefined
            }
            longitude={
              destinationLongitude ? Number(destinationLongitude) : undefined
            }
            onChange={(latitude, longitude) => {
              setDestinationLatitude(String(latitude));
              setDestinationLongitude(String(longitude));
              setDestinationError("");
            }}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-900">
                Latitude
              </label>
              <input
                required
                type="number"
                step="any"
                value={destinationLatitude}
                onChange={(event) => setDestinationLatitude(event.target.value)}
                className="h-11 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-900">
                Longitude
              </label>
              <input
                required
                type="number"
                step="any"
                value={destinationLongitude}
                onChange={(event) =>
                  setDestinationLongitude(event.target.value)
                }
                className="h-11 w-full rounded-[10px] border border-slate-300 bg-white px-4 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          {destinationError && (
            <p className="text-xs font-semibold text-rose-400" role="alert">
              {destinationError}
            </p>
          )}
        </form>
      </Modal>
    </ManagerLayout>
  );
};
