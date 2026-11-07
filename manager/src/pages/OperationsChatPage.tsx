import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  FileText,
  Loader2,
  MessageCircle,
  Mic,
  Send,
  Siren,
  Users,
} from "lucide-react";
import { io } from "socket.io-client";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  apiBlob,
  ensureAccessToken,
  getAccessToken,
} from "../services/apiClient";
import {
  AiActionProposal,
  askOperationsAi,
  ChatContact,
  ChatMessage,
  confirmAiProposal,
  loadAiMessages,
  loadChatContacts,
  loadChatMessages,
  loadPendingAiProposals,
  markChatRead,
  sendChatMessage,
} from "../services/operationsApi";
import { Contact, loadContacts } from "../services/contactApi";
import { ContactCards } from "../components/contacts/ContactCards";

type ChatMode = "direct" | "broadcast" | "ai" | "whatsapp";

export const OperationsChatPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const manager = user?.role !== "agent";
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [peer, setPeer] = useState<ChatContact | null>(null);
  const [mode, setMode] = useState<ChatMode>("direct");
  const [whatsappContacts, setWhatsappContacts] = useState<Contact[]>([]);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [proposal, setProposal] = useState<{
    id: string;
    summary: string;
  } | null>(null);
  const [pendingProposals, setPendingProposals] = useState<AiActionProposal[]>(
    [],
  );
  const socketRef = useRef<ReturnType<typeof io>>();
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder>();
  const chunks = useRef<Blob[]>([]);

  const refresh = (selected = peer) =>
    loadChatMessages(mode === "direct" ? selected?.id : "").then(setMessages);
  const refreshProposals = () => {
    if (!manager) return Promise.resolve();
    return loadPendingAiProposals().then(setPendingProposals);
  };
  useEffect(() => {
    void loadChatContacts().then((items) => {
      setContacts(items);
      setPeer(items[0] ?? null);
    });
  }, []);
  useEffect(() => {
    void refreshProposals();
  }, [manager]);
  useEffect(() => {
    if (mode === "ai")
      void loadAiMessages()
        .then(setAiMessages)
        .catch(() =>
          showToast(
            "AI History Unavailable",
            "Saved AI messages could not be loaded.",
            "error",
          ),
        );
  }, [mode]);
  useEffect(() => {
    if (mode !== "whatsapp") return;
    setWhatsappLoading(true);
    setWhatsappError("");
    void loadContacts()
      .then(({ contacts: assignedContacts }) =>
        setWhatsappContacts(assignedContacts),
      )
      .catch((error) =>
        setWhatsappError(
          error instanceof Error
            ? error.message
            : "Assigned contacts could not be loaded.",
        ),
      )
      .finally(() => setWhatsappLoading(false));
  }, [mode]);
  useEffect(() => {
    if (mode !== "ai" && mode !== "whatsapp") void refresh();
  }, [peer?.id, mode]);
  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken()
      .then(() => {
        const configured = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
        socket = io(configured === "same-origin" ? undefined : configured, {
          transports: ["websocket"],
          withCredentials: true,
          auth: (callback) => callback({ token: getAccessToken() }),
        });
        socketRef.current = socket;
        socket.on("chat:message", () => void refresh());
        socket.on("chat:read", () => void refresh());
        socket.on("chat:typing", (event) => {
          if (event.userId === peer?.id) setTyping(event.typing);
        });
        socket.on("ai:proposal", () => {
          if (manager) {
            void refreshProposals();
            showToast(
              "Manager Confirmation Required",
              "A new AI action request is waiting for your approval.",
              "warning",
            );
          }
        });
        socket.on(
          "ai:proposal-confirmed",
          (event: { id: string; requestedBy: string }) => {
            if (manager) void refreshProposals();
            if (event.requestedBy === user?.id) {
              setProposal((current) =>
                current?.id === event.id ? null : current,
              );
              showToast(
                "Request Confirmed",
                "Your manager approved the AI action request.",
                "success",
              );
            }
          },
        );
      })
      .catch(() => undefined);
    return () => socket?.disconnect();
  }, [peer?.id, mode, manager, user?.id]);
  useEffect(() => {
    if (mode === "ai" || mode === "whatsapp") return;
    messages
      .filter(
        (message) =>
          message.senderId !== user?.id &&
          !message.reads.some((read) => read.userId === user?.id),
      )
      .forEach(
        (message) => void markChatRead(message.id).catch(() => undefined),
      );
  }, [messages, user?.id, mode]);

  const send = async (file?: File | Blob, type = "TEXT", name?: string) => {
    if (mode === "ai") {
      const prompt = text.trim();
      if (!prompt) return;
      setText("");
      setBusy(true);
      try {
        const response = await askOperationsAi(prompt);
        setAiMessages((current) => [...current, ...response.messages]);
        setProposal(response.proposal ?? null);
      } catch (error) {
        setAiMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            senderId: "ai",
            broadcast: false,
            type: "AI",
            content: "I could not connect to Operations AI. Please try again.",
            urgent: false,
            createdAt: new Date().toISOString(),
            reads: [],
          },
        ]);
        showToast(
          "AI Unavailable",
          error instanceof Error ? error.message : "Please try again.",
          "error",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!text.trim() && !file) return;
    if (mode === "direct" && !peer) return;
    setBusy(true);
    try {
      await sendChatMessage({
        recipientId: mode === "direct" ? peer?.id : undefined,
        broadcast: mode === "broadcast",
        content: text,
        urgent,
        type,
        file,
        fileName: name,
      });
      setText("");
      setUrgent(false);
      await refresh();
    } catch (error) {
      showToast(
        "Message Not Sent",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const recordVoice = async () => {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    recorder.current = new MediaRecorder(stream);
    recorder.current.ondataavailable = (event) =>
      chunks.current.push(event.data);
    recorder.current.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      void send(
        new Blob(chunks.current, { type: "audio/webm" }),
        "VOICE",
        "voice-message.webm",
      );
    };
    recorder.current.start();
  };
  const openAttachment = async (message: ChatMessage) => {
    const blob = await apiBlob(`/api/v1/chat/attachments/${message.id}`);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const content = (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-cyan-400" />
          Operations Chat & AI
        </h2>
        <p className="text-xs text-slate-400">
          Secure direct communication, urgent broadcasts, files, voice, and live
          operations intelligence
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <GlassCard className="lg:col-span-4 p-4 space-y-3">
          <div className="flex gap-1 p-1 rounded-xl bg-slate-900/60">
            {(
              [
                "direct",
                ...(manager ? ["broadcast"] : []),
                "ai",
                "whatsapp",
              ] as ChatMode[]
            ).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold capitalize ${mode === item ? "bg-cyan-500 text-slate-950" : "text-slate-400"}`}
              >
                {item === "whatsapp" ? "WhatsApp" : item}
              </button>
            ))}
          </div>
          {mode === "direct" &&
            contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => setPeer(contact)}
                className={`w-full p-3 rounded-xl flex items-center gap-3 text-left border ${peer?.id === contact.id ? "bg-indigo-600/20 border-cyan-400" : "bg-slate-900/60 border-slate-800"}`}
              >
                <ProfileAvatar
                  src={contact.avatarUrl}
                  name={contact.name}
                  className="w-9 h-9 rounded-full text-[10px]"
                />
                <span>
                  <span className="text-xs font-bold text-white block">
                    {contact.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {contact.employeeCode || contact.role}
                  </span>
                </span>
              </button>
            ))}
          {mode === "broadcast" && (
            <div className="p-4 text-center">
              <Users className="w-8 h-8 text-cyan-400 mx-auto" />
              <p className="text-xs font-bold text-white mt-2">
                All Sales Agents
              </p>
              <p className="text-[10px] text-slate-400">
                Tenant-wide manager broadcast
              </p>
            </div>
          )}
          {mode === "ai" && (
            <div className="p-4 text-center">
              <Bot className="w-8 h-8 text-cyan-400 mx-auto" />
              <p className="text-xs font-bold text-white mt-2">Operations AI</p>
              <p className="text-[10px] text-slate-400">
                Live attendance, sales, order, shop and agent context
              </p>
            </div>
          )}
          {mode === "whatsapp" && (
            <div className="p-4 text-center">
              <MessageCircle className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="text-xs font-bold text-white mt-2">
                WhatsApp Contacts
              </p>
              <p className="text-[10px] text-slate-400">
                Only people assigned to your work
              </p>
            </div>
          )}
        </GlassCard>
        <GlassCard className="lg:col-span-8 p-4 flex flex-col min-h-[580px]">
          {mode === "whatsapp" ? (
            <div className="flex-1 overflow-y-auto">
              <div className="mb-4">
                <h3 className="text-base font-extrabold text-white">
                  Assigned WhatsApp Contacts
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Open WhatsApp, call, or copy a verified contact number.
                </p>
              </div>
              {whatsappLoading ? (
                <div className="grid min-h-72 place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
                </div>
              ) : whatsappError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300"
                >
                  {whatsappError}
                </div>
              ) : (
                <ContactCards contacts={whatsappContacts} dark />
              )}
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[480px] pr-1">
                {(mode === "ai" ? aiMessages : messages).map((message) => {
                  const ownMessage = message.senderId === user?.id;
                  const aiReply = mode === "ai" && !ownMessage;
                  return (
                    <div
                      key={message.id}
                      className={`max-w-[85%] p-3 rounded-xl text-xs ${ownMessage ? "ml-auto bg-indigo-600/30 border border-indigo-500/30" : aiReply ? "bg-purple-100 border border-purple-300 shadow-sm" : message.urgent ? "bg-rose-500/15 border border-rose-500/30" : "bg-slate-900/70 border border-slate-800"}`}
                    >
                      <p
                        className={`${aiReply ? "text-purple-950 font-medium" : "text-white"} whitespace-pre-wrap`}
                      >
                        {message.urgent && (
                          <Siren className="inline w-3.5 h-3.5 mr-1 text-rose-400" />
                        )}
                        {message.content}
                      </p>
                      {message.attachmentName && (
                        <button
                          type="button"
                          onClick={() => void openAttachment(message)}
                          className="text-cyan-400 mt-2 block"
                        >
                          {message.type === "VOICE"
                            ? "Voice message"
                            : message.attachmentName}
                        </button>
                      )}
                      <p
                        className={`text-[9px] mt-1 ${aiReply ? "text-purple-600" : "text-slate-500"}`}
                      >
                        {new Date(message.createdAt).toLocaleTimeString()}{" "}
                        {mode !== "ai" && ownMessage && message.reads.length
                          ? "· Read"
                          : ""}
                      </p>
                    </div>
                  );
                })}
                {typing && <p className="text-[10px] text-cyan-400">Typing…</p>}
              </div>
              {mode === "ai" &&
                manager &&
                pendingProposals.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
                  >
                    <p className="text-xs font-bold text-amber-300">
                      Manager confirmation required
                    </p>
                    <p className="text-xs text-white mt-1">{item.summary}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Requested by {item.requester?.name ?? "Agent"}
                      {item.requester?.employeeCode
                        ? ` · ${item.requester.employeeCode}`
                        : ""}
                    </p>
                    <button
                      onClick={() =>
                        void confirmAiProposal(item.id).then(() => {
                          void refreshProposals();
                          showToast(
                            "Proposal Confirmed",
                            "The agent has been notified.",
                            "success",
                          );
                        })
                      }
                      className="text-xs font-bold text-white mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500"
                    >
                      Confirm
                    </button>
                  </div>
                ))}
              {proposal && !manager && (
                <div className="p-3 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  <p className="text-xs text-amber-300">
                    Sent to your manager. Waiting for confirmation.
                  </p>
                </div>
              )}
              <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
                {mode !== "ai" && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void send(file, "FILE", file.name);
                      }}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="p-2.5 rounded-xl bg-slate-900 text-cyan-400"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void recordVoice()}
                      className="p-2.5 rounded-xl bg-slate-900 text-cyan-400"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  </>
                )}
                <input
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    if (peer)
                      socketRef.current?.emit("chat:typing", {
                        recipientId: peer.id,
                        typing: Boolean(event.target.value),
                      });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={
                    mode === "ai"
                      ? "Ask about live operations…"
                      : "Type a secure message…"
                  }
                  className="flex-1 px-4 py-2.5 text-xs rounded-xl glass-input"
                />
                {mode !== "ai" && (
                  <button
                    onClick={() => setUrgent(!urgent)}
                    className={`p-2.5 rounded-xl ${urgent ? "bg-rose-500 text-white" : "bg-slate-900 text-rose-400"}`}
                  >
                    <Siren className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => void send()}
                  disabled={busy}
                  className="p-2.5 rounded-xl glass-button-primary text-white"
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
  return <ManagerLayout>{content}</ManagerLayout>;
};
