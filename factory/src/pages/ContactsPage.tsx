import React from "react";
import { Headphones, Loader2 } from "lucide-react";
import { FactoryLayout } from "../components/layout/FactoryLayout";
import { ContactCards } from "../components/contacts/ContactCards";
import { Contact, loadContacts } from "../services/contactApi";

const Content = ({
  dark = false,
  filter,
}: {
  dark?: boolean;
  filter?: (contact: Contact) => boolean;
}) => {
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    void loadContacts()
      .then((result) =>
        setContacts(filter ? result.contacts.filter(filter) : result.contacts),
      )
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Unable to load contacts.",
        ),
      )
      .finally(() => setLoading(false));
  }, [filter]);
  return (
    <section>
      <div className="mb-6">
        <h2
          className={`flex items-center gap-2 text-2xl font-extrabold ${dark ? "text-white" : "text-slate-950"}`}
        >
          <Headphones className="h-7 w-7 text-cyan-500" />
          Contacts / Support
        </h2>
        <p
          className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}
        >
          One-tap help from the people assigned to your work.
        </p>
      </div>
      {loading ? (
        <div className="grid min-h-48 place-items-center">
          <Loader2 className="animate-spin text-cyan-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-500">
          {error}
        </div>
      ) : (
        <ContactCards contacts={contacts} dark={dark} />
      )}
    </section>
  );
};
export const AgentContactsPage = () => (
  <FactoryLayout>
    <Content />
  </FactoryLayout>
);
const factoryManagerOnly = (contact: Contact) =>
  contact.role === "FACTORY_MANAGER";
export const ManagerContactsPage = () => (
  <FactoryLayout>
    <Content dark filter={factoryManagerOnly} />
  </FactoryLayout>
);
export { Content as ContactsContent };
