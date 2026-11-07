import React, { useState } from "react";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useAuth } from "../context/AuthContext";
import { Truck, Navigation, Award, Camera } from "lucide-react";
import { PasskeySettings } from "../components/auth/PasskeySettings";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { AgentAvatarModal } from "../components/common/AgentAvatarModal";

export const AgentProfilePage: React.FC = () => {
  const { user, logout, updateUser } = useAuth();
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  return (
    <AgentLayout>
      <div className="space-y-6">
        <GlassCard className="p-6 text-center space-y-4">
          <button
            type="button"
            onClick={() => setAvatarModalOpen(true)}
            className="relative inline-block mx-auto"
            title="Change profile image"
          >
            <ProfileAvatar
              src={user?.avatar}
              name={user?.name}
              className="w-20 h-20 rounded-2xl object-cover border-4 border-cyan-400/50 shadow-2xl mx-auto text-base"
            />
            <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-400 border-2 border-slate-900" />
            <span className="absolute -bottom-1 -left-1 p-1 rounded-lg bg-cyan-500 text-slate-950 border-2 border-slate-900">
              <Camera className="w-3 h-3" />
            </span>
          </button>

          <div>
            <h2 className="text-xl font-extrabold text-white">{user?.name}</h2>
            <p className="text-xs text-cyan-400 font-bold mt-0.5">
              {user?.employeeCode} • Senior Sales Agent
            </p>
            <p className="text-xs text-slate-400 mt-1">{user?.region}</p>
          </div>
        </GlassCard>

        <GlassCard className="p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Vehicle & Shift Telemetry
          </h3>

          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 font-semibold flex items-center gap-2">
                <Truck className="w-4 h-4 text-cyan-400" />
                Vehicle Registration:
              </span>
              <span className="font-bold text-white">
                WP CAF-3321 (Motorcycle)
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 font-semibold flex items-center gap-2">
                <Navigation className="w-4 h-4 text-cyan-400" />
                Today's Distance Tracked:
              </span>
              <span className="font-extrabold text-cyan-400">42.1 KM</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400 font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                Estimated Commission Today:
              </span>
              <span className="font-extrabold text-emerald-400">LKR 3,125</span>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <PasskeySettings />
        </GlassCard>

        <button
          onClick={logout}
          className="w-full py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 font-bold text-xs hover:bg-rose-500/20 transition-colors"
        >
          Sign Out of Field Agent Portal
        </button>

        {user && (
          <AgentAvatarModal
            isOpen={avatarModalOpen}
            onClose={() => setAvatarModalOpen(false)}
            agentId={user.id}
            agentName={user.name}
            currentAvatar={user.avatar}
            onChanged={(avatar) => updateUser({ avatar })}
          />
        )}
      </div>
    </AgentLayout>
  );
};
