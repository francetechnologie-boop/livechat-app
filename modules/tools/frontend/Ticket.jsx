import React, { useEffect, useMemo, useState } from "react";

const sources = [
  "Livechat",
  "Email",
  "Téléphone / VoIP",
  "SMS",
  "Formulaire Web",
  "Réseaux sociaux",
  "Commandes / Panier",
  "API / Webhook",
  "Alertes système",
];

const ingestionSteps = [
  "1) Webhook / polling des canaux",
  "2) Parser (email, SMS, ordre)",
  "3) Déduplication contact",
  "4) Enrichissement (commande, client)",
  "5) Règles de routage / assignation",
];

const queues = [
  "Support produit",
  "Livraison / Transporteur",
  "Paiement / Finance",
  "Réclamations",
];

const entityBlocks = [
  {
    title: "Tickets",
    items: [
      "id (PK)",
      "contact_id (FK)",
      "source_id (FK)",
      "queue_id (FK)",
      "status (NEW, OPEN, PENDING, SOLVED, CLOSED)",
      "priority",
      "type (TRACKING, CLAIM, PAYMENT, OTHER)",
      "subject / tracking_number / order_id",
      "assigned_agent_id",
      "created_at / updated_at",
    ],
  },
  {
    title: "Contacts",
    items: ["id (PK)", "name", "phones[]", "emails[]", "tags[]", "notes", "timestamps"],
  },
  {
    title: "Messages / Conversation",
    items: [
      "id",
      "ticket_id (FK)",
      "sender (customer / agent / system)",
      "body / attachments[]",
      "channel_meta",
      "created_at",
    ],
  },
  {
    title: "Agents",
    items: ["id", "name", "email", "role", "skills[]", "availability_status"],
  },
  {
    title: "Templates / Macros",
    items: ["id", "name", "content", "category", "language"],
  },
  {
    title: "SLA & Règles d’escalade",
    items: ["Temps première réponse", "Temps de résolution", "Escalade automatique"],
  },
  {
    title: "Intégrations externes",
    items: ["E-commerce (commandes)", "Transporteurs", "Téléphonie / SMS", "Auth / SSO"],
  },
];

const statuses = ["NEW", "OPEN", "PENDING", "SOLVED", "CLOSED"];
const priorityOptions = ["low", "normal", "high"];

const wireframes = [
  {
    title: "Sources config",
    details: [
      "Connecteurs (Livechat, Email, Twilio, Facebook...)",
      "Mapping des champs",
      "Signatures / tokens",
    ],
  },
  {
    title: "Rules & automations",
    details: [
      "Si 'tracking' → type TRACKING + regex tracking_number",
      "Si order_id → lier la commande et placer dans la file Orders",
      "Si priorité haute et SLA à risque → escalade vers le manager",
    ],
  },
];

function stripHtmlTags(value) {
  if (!value) return "";
  return String(value)
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodySnippet(text, html) {
  const trimmedText = text ? String(text).trim() : "";
  if (trimmedText) return trimmedText;
  const stripped = stripHtmlTags(html);
  return stripped;
}

function formatRecipientValue(value) {
  if (!value && value !== 0) return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatRecipientValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    if (value.email) return String(value.email).trim();
    if (value.address) return String(value.address).trim();
    return "";
  }
  return String(value).trim();
}

const boardDetails = [
  "Colonnes : NEW / OPEN / PENDING / SOLVED / CLOSED",
  "Cartes : résumé, priorité, agent assigné, tags",
];

const ticketDetail = [
  "Gauche : pane de conversation",
  "Droite : métadonnées (statut, priorité, file, contact, commande, SLA)",
];

const ticketTabs = [
  { id: "tickets", label: "Tickets" },
  { id: "contexte", label: "Contexte & règles" },
];

const ticketActions = [
  { id: "make-devis", label: "Faire un devis" },
  { id: "tracking", label: "Tracking" },
  { id: "relance-virement", label: "Envoyer relance virement bancaire" },
  { id: "ask-house-number", label: "Demander numéro de maison" },
  { id: "create-claim", label: "Créer une réclamation" },
  { id: "other-cases", label: "Autres cas" },
  { id: "ask-phone-transport", label: "Demander n° téléphone transporteur" },
];

const ticketActionsById = ticketActions.reduce((acc, action) => {
  acc[action.id] = action;
  return acc;
}, {});

function TicketCard({ title, children, className = "" }) {
  return (
    <div
      className={`bg-white dark:bg-background-dark border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm p-4 flex flex-col gap-3 ${className}`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </div>
      <div className="text-sm text-gray-700 dark:text-gray-100 space-y-2">{children}</div>
    </div>
  );
}

const DEFAULT_ORIGIN_LABELS = {
  email: "Email",
  call: "Appel",
  sms: "SMS",
  manual: "Ajouté manuellement",
  liveticket: "Livechat",
};

const EMAIL_SOURCE_TOKENS = ["email", "gmail", "smtp", "imap", "mail"];

function normalizeSource(value) {
  if (!value) return "";
  return String(value).toLowerCase();
}

function isEmailDetail(detail) {
  if (!detail) return false;
  const source = normalizeSource(detail.source);
  if (EMAIL_SOURCE_TOKENS.some((token) => source.includes(token))) return true;
  const channelSource = normalizeSource(detail.channel_meta?.source);
  if (EMAIL_SOURCE_TOKENS.some((token) => channelSource.includes(token))) return true;
  if (detail.channel_meta?.from) return true;
  return false;
}

function getOriginLabel(detail) {
  if (!detail) return "Inconnu";
  if (detail.source) {
    const normalized = normalizeSource(detail.source);
    return DEFAULT_ORIGIN_LABELS[normalized] || detail.source;
  }
  if (detail.channel_meta?.source) {
    const normalized = normalizeSource(detail.channel_meta.source);
    return DEFAULT_ORIGIN_LABELS[normalized] || detail.channel_meta.source;
  }
  if (detail.channel_meta?.from) {
    return "Email";
  }
  return "Inconnu";
}

function TicketDetailPanel({
  detail,
  detailLoading,
  detailError,
  isCreateMode = false,
  onCancelCreate,
  onTicketCreated,
}) {
  const ticketBody = detail ? extractBodySnippet(detail.body_text, detail.body_html) : "";
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [ticketCreateState, setTicketCreateState] = useState({ busy: false, message: "", error: "" });
  const getCreateFormValues = () => ({
    subject: detail?.subject || "",
    from: detail?.channel_meta?.from || detail?.customer_email || "",
    to: formatRecipientValue(detail?.channel_meta?.to) || "",
    queue: detail?.queue || queues[0] || "",
    priority: detail?.priority || "normal",
    body: ticketBody,
  });
  const [ticketForm, setTicketForm] = useState(getCreateFormValues);

  useEffect(() => {
    setIsExpanded(false);
    setSelectedAction(null);
    setActionMessage("");
  }, [detail?.id]);

  useEffect(() => {
    if (isCreateMode) {
      setTicketForm(getCreateFormValues());
      setTicketCreateState({ busy: false, message: "", error: "" });
    }
  }, [isCreateMode, detail, ticketBody]);

  const maxLines = 30;
  const ticketLines = ticketBody ? ticketBody.split(/\r?\n/) : [];
  const hasOverflow = ticketLines.length > maxLines;
  const visibleLines = isExpanded || !hasOverflow ? ticketLines : ticketLines.slice(0, maxLines);
  const previewText = visibleLines.join("\n");
  const handleFormChange = (field, value) => {
    setTicketForm((prev) => ({ ...prev, [field]: value }));
  };
  const submitTicketCreation = async () => {
    setTicketCreateState({ busy: true, message: "", error: "" });
    const payload = {
      messageId: detail?.id ? String(detail.id) : `manual-${Date.now()}`,
      threadId: detail?.thread_id || detail?.channel_meta?.threadId || null,
      subject: ticketForm.subject,
      from: ticketForm.from,
      to: ticketForm.to || null,
      date: detail?.received_at || new Date().toISOString(),
      snippet:
        detail?.body_text?.slice(0, 200) || ticketForm.body?.slice(0, 200) || "",
      body_text: ticketForm.body,
      queue: ticketForm.queue,
      priority: ticketForm.priority,
      source: detail?.source || "manual",
    };
    try {
      const resp = await fetch("/api/tools/email/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setTicketCreateState({
          busy: false,
          message: data.message || "Ticket créé avec succès.",
          error: "",
        });
        if (typeof onTicketCreated === "function") {
          onTicketCreated();
        }
        return;
      }
      setTicketCreateState({
        busy: false,
        message: "",
        error: data?.message || data?.error || "Impossible de créer le ticket.",
      });
    } catch (error) {
      setTicketCreateState({
        busy: false,
        message: "",
        error: error?.message || "Erreur réseau pendant la création du ticket.",
      });
    }
  };

  return (
    <TicketCard title="Ticket detail view" className="h-full w-full">
      {detailError && <div className="text-xs text-red-600">{detailError}</div>}
      {detailLoading ? (
        <div className="text-sm text-gray-500">Chargement du ticket...</div>
      ) : isCreateMode ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Créer un ticket
            </div>
            {onCancelCreate && (
              <button
                type="button"
                onClick={onCancelCreate}
                className="text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-300"
              >
                Annuler
              </button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Sujet
              <input
                value={ticketForm.subject}
                onChange={(event) => handleFormChange("subject", event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              De (email)
              <input
                value={ticketForm.from}
                onChange={(event) => handleFormChange("from", event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Destinataires
              <input
                value={ticketForm.to}
                onChange={(event) => handleFormChange("to", event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              File
              <select
                value={ticketForm.queue}
                onChange={(event) => handleFormChange("queue", event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {queues.map((queueItem) => (
                  <option key={queueItem} value={queueItem}>
                    {queueItem}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Priorité
              <select
                value={ticketForm.priority}
                onChange={(event) => handleFormChange("priority", event.target.value)}
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Corps du ticket
            </div>
            <textarea
              rows={6}
              value={ticketForm.body}
              onChange={(event) => handleFormChange("body", event.target.value)}
              className="w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none dark:bg-background-dark dark:border-white/10 dark:text-white"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
              {ticketCreateState.message && (
                <p className="text-emerald-600 dark:text-emerald-300">{ticketCreateState.message}</p>
              )}
              {ticketCreateState.error && (
                <p className="text-red-600 dark:text-red-300">{ticketCreateState.error}</p>
              )}
            </div>
            <button
              type="button"
              onClick={submitTicketCreation}
              disabled={ticketCreateState.busy}
              className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {ticketCreateState.busy ? "Création…" : "Créer un ticket"}
            </button>
          </div>
        </div>
      ) : detail ? (
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-100">
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Sujet</span>
            <span className="ml-2 truncate">{detail.subject || "(sans sujet)"}</span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Queue</span>
            <span className="ml-2 truncate">{detail.queue || "—"}</span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Statut</span>
            <StatusBadge value={detail.status} />
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Origine</span>
            <span className="ml-2 truncate">{getOriginLabel(detail)}</span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Email source</span>
            <span className="ml-2 truncate">{detail.channel_meta?.from || detail.customer_email || "—"}</span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Emails destinataires</span>
            <span className="ml-2 truncate">
              {formatRecipientValue(detail.channel_meta?.to) || "—"}
            </span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Client</span>
            <span className="ml-2 truncate">{detail.customer_email || "—"}</span>
          </div>
          <div className="flex items-center justify-between rounded border p-2">
            <span className="font-semibold text-xs uppercase text-gray-500">Créé</span>
            <span className="ml-2 truncate">{formatDateTime(detail.created_at)}</span>
          </div>
          <div className="col-span-2 border-t border-gray-100 pt-3 dark:border-white/5 space-y-3">
            <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Contenu complet
              </div>
              <div className="mt-2 text-[12px] text-gray-700 dark:text-gray-200">
                {ticketBody ? (
                  <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed max-h-[360px] overflow-auto">
                    {previewText}
                  </pre>
                ) : (
                  <span className="text-xs text-gray-400">Aucun contenu disponible.</span>
                )}
              </div>
            </div>
            {hasOverflow && (
              <div className="flex items-center justify-end gap-2 text-xs">
                <span className="text-gray-500 dark:text-gray-400">
                  {isExpanded ? "Affichage complet" : "Affichage limité à 30 lignes"}
                </span>
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="px-2 py-1 rounded border text-[11px] uppercase tracking-wide text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  {isExpanded ? "Réduire" : "Voir plus"}
                </button>
              </div>
            )}
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Actions à envisager
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ticketActions.map((action) => {
                  const active = selectedAction === action.id;
                  const isEmailTicket = isEmailDetail(detail);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        setSelectedAction(action.id);
                        setActionMessage("");
                        if (action.id === "make-devis") {
                          if (isEmailTicket) {
                            const url = `${window.location.origin}/#/tools/Devis?ticket_id=${detail?.id}`;
                            window.open(url, "_blank");
                            setActionMessage("Ouvre la section Devis (ticket email).");
                          } else {
                            setActionMessage("Le ticket n’est pas issu d’un email.");
                          }
                        }
                      }}
                      aria-pressed={active}
                      className={`w-full rounded border px-3 py-1 text-left text-xs font-semibold transition ${
                        active
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      }`}
                    >
                      {action.label}
                    </button>
                  );
                })}
              </div>
              {selectedAction && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Action sélectionnée : {ticketActionsById[selectedAction]?.label || "—"}
                </div>
              )}
              {actionMessage && (
                <div className="text-xs italic text-gray-500 dark:text-gray-400">{actionMessage}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <BulletList items={ticketDetail} />
      )}
    </TicketCard>
  );
}

function BulletList({ items }) {
  return (
    <ul className="list-disc pl-4 space-y-1">
      {items.map((item) => (
        <li key={item} className="text-sm text-gray-600 dark:text-gray-300">
          {item}
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ value }) {
  const cls = STATUS_BADGES[String(value || "").toUpperCase()] || "bg-gray-50 text-gray-800 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold border ${cls}`}>
      {String(value || "unknown").toUpperCase()}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function ChipRow({ items }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="px-2 py-0.5 text-[11px] font-medium rounded-full border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

const STATUS_BADGES = {
  NEW: "bg-blue-50 text-blue-700 border-blue-100",
  OPEN: "bg-amber-50 text-amber-700 border-amber-100",
  PENDING: "bg-purple-50 text-purple-700 border-purple-100",
  SOLVED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  CLOSED: "bg-gray-100 text-gray-700 border-gray-200",
};

function RecentTicketsPanel({
  tickets,
  loadTickets,
  ticketsLoading,
  ticketsError,
  recentTicketsReady,
  onDetail,
  onAddTicket,
  isCreateMode,
}) {
  const handleAddClick = () => {
    if (typeof onAddTicket === "function") {
      onAddTicket();
    }
  };

  return (
    <section className="panel bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-100">Derniers tickets (limite 12)</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleAddClick}
            disabled={isCreateMode}
            className="text-xs px-3 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreateMode ? "Mode création" : "Ajouter un ticket"}
          </button>
          <button
            type="button"
            onClick={loadTickets}
            disabled={ticketsLoading}
            className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-60"
          >
            {ticketsLoading ? "Rafraîchissement…" : "Rafraîchir"}
          </button>
        </div>
      </div>
      {ticketsError && <div className="text-xs text-red-600">{ticketsError}</div>}
      {ticketsLoading ? (
        <div className="text-sm text-gray-500">Chargement des tickets…</div>
      ) : (
        <div className="overflow-auto">
          {recentTicketsReady ? (
            <table className="min-w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-2 py-2 text-left">ID</th>
                    <th className="px-2 py-2 text-left">Sujet</th>
                    <th className="px-2 py-2 text-left">File</th>
                    <th className="px-2 py-2 text-left">Statut</th>
                    <th className="px-2 py-2 text-left">Client</th>
                    <th className="px-2 py-2 text-left">Créé</th>
                    <th className="px-2 py-2 text-left">Actions</th>
                  </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-t border-gray-100">
                    <td className="px-2 py-1 text-[11px] text-gray-600">#{ticket.id}</td>
                    <td className="px-2 py-1 text-[12px] text-gray-800">{ticket.subject || "(sans sujet)"}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-600">{ticket.queue}</td>
                    <td className="px-2 py-1">
                      <StatusBadge value={ticket.status} />
                    </td>
                    <td className="px-2 py-1 text-[11px] text-gray-600">{ticket.customer_email || "-"}</td>
                    <td className="px-2 py-1 text-[11px] text-gray-600">{formatDateTime(ticket.created_at)}</td>
                    <td className="px-2 py-1">
                      <button
                        className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        onClick={() => onDetail(ticket.id)}
                      >
                        Détails
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-gray-500">Aucun ticket récent.</div>
          )}
        </div>
      )}
    </section>
  );
}

export default function Ticket() {
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [activeTab, setActiveTab] = useState(ticketTabs[0].id);

  const loadTickets = async () => {
    setTicketsLoading(true);
    setTicketsError("");
    try {
      const resp = await fetch("/api/tools/tickets?limit=12", { credentials: "include" });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setTickets(Array.isArray(data.items) ? data.items : []);
        return;
      }
      throw new Error(data?.message || data?.error || "unable_to_fetch");
    } catch (error) {
      setTickets([]);
      setTicketsError(error?.message || "Impossible de charger les tickets.");
    } finally {
      setTicketsLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTicketDetail = async (ticketId) => {
    setIsCreateMode(false);
    if (!ticketId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const resp = await fetch(`/api/tools/tickets/${ticketId}`, { credentials: "include" });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        setDetail(data.ticket || null);
        return;
      }
      throw new Error(data?.message || data?.error || "detail_error");
    } catch (error) {
      setDetail(null);
      setDetailError(error?.message || "Impossible de charger le ticket.");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAddTicket = () => {
    setDetail(null);
    setIsCreateMode(true);
  };

  const handleTicketCreated = () => {
    loadTickets();
    setIsCreateMode(false);
  };

  const recentTicketsReady = useMemo(() => Array.isArray(tickets) && tickets.length > 0, [tickets]);

  return (
    <div className="p-6 pt-4 space-y-6 overflow-auto">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white/80 p-1 text-sm dark:border-white/10 dark:bg-white/5">
        {ticketTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1 font-semibold rounded-full transition ${
                active
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "tickets" && (
      <div className="space-y-4">
        <RecentTicketsPanel
          tickets={tickets}
          loadTickets={loadTickets}
          ticketsLoading={ticketsLoading}
          ticketsError={ticketsError}
          recentTicketsReady={recentTicketsReady}
          onDetail={loadTicketDetail}
          onAddTicket={handleAddTicket}
          isCreateMode={isCreateMode}
        />
        <TicketDetailPanel
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          isCreateMode={isCreateMode}
          onCancelCreate={() => setIsCreateMode(false)}
          onTicketCreated={handleTicketCreated}
        />
      </div>
    )}

      {activeTab === "contexte" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <TicketCard title="Sources de tickets">
              <BulletList items={sources} />
            </TicketCard>
            <TicketCard title="Pipeline d’ingestion">
              <BulletList items={ingestionSteps} />
            </TicketCard>
            <TicketCard title="Queues / files d’attente">
              <BulletList items={queues} />
            </TicketCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {entityBlocks.map((block) => (
              <TicketCard key={block.title} title={block.title}>
                <BulletList items={block.items} />
              </TicketCard>
            ))}
          </div>

          <TicketCard title="Workflow & board">
            <div className="space-y-1">
              <ChipRow items={statuses} />
              <BulletList items={boardDetails} />
            </div>
          </TicketCard>

          <TicketCard title="Sources config & règles">
            {wireframes.map((wireframe) => (
              <div key={wireframe.title}>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {wireframe.title}
                </div>
                <BulletList items={wireframe.details} />
              </div>
            ))}
          </TicketCard>
        </div>
      )}
    </div>
  );
}
