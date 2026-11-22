"use client";

import { Button } from "@ui-sdk/react/button";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Textarea } from "@ui-sdk/react/textarea";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBuilderAccess, builderError } from "./agent-builder-access";

type Detail = FunctionReturnType<typeof api.agentBuilder.get>;
const panel = "space-y-6 rounded-4xl border border-border bg-card p-6 sm:p-8";

export function AgentBuilderEditor({ agentId }: { agentId: string }) {
  return (
    <AgentBuilderAccess>
      <EditorLoader agentId={agentId as Id<"agents">} />
    </AgentBuilderAccess>
  );
}
function EditorLoader({ agentId }: { agentId: Id<"agents"> }) {
  const detail = useQuery(api.agentBuilder.get, { agentId });
  if (!detail) return <p role="status">Cargando tu agente…</p>;
  return (
    <div className="space-y-8">
      <SourceSection detail={detail} />
      <ProfileSection key={agentId} detail={detail} />
      <TestSection detail={detail} />
    </div>
  );
}

function SourceSection({ detail }: { detail: Detail }) {
  const agentId = detail.agent._id;
  const addWebsite = useMutation(api.agentBuilder.addWebsite);
  const addText = useMutation(api.agentBuilder.addText);
  const generateUploadUrl = useMutation(api.agentBuilder.generateUploadUrl);
  const addPdf = useMutation(api.agentBuilder.addPdf);
  const remove = useMutation(api.agentBuilder.removeSource);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(operation: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice("Información actualizada.");
    } catch (error) {
      setError(builderError(error));
    } finally {
      setPending(false);
    }
  }
  const full = detail.sources.length >= 10;
  return (
    <section className={panel} aria-labelledby="teach-title">
      <div>
        <h2 id="teach-title" className="text-2xl font-semibold">
          1. Enséñale
        </h2>
        <p className="mt-2 text-subtle-foreground">
          Comparte la información que puede usar para responder. No agregues
          contraseñas ni datos privados de otras personas.
        </p>
      </div>
      <Tabs defaultValue="website">
        <TabsList aria-label="Cómo agregar información">
          <TabsTab value="website">Sitio web</TabsTab>
          <TabsTab value="pdf">PDF</TabsTab>
          <TabsTab value="text">Texto</TabsTab>
        </TabsList>
        <TabsPanel value="website" className="pt-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await addWebsite({
                  agentId,
                  url: /^[a-z][a-z\d+.-]*:/i.test(url.trim())
                    ? url.trim()
                    : `https://${url.trim()}`,
                });
                setUrl("");
              });
            }}
          >
            <Field name="website">
              <FieldLabel>Dirección de tu sitio web</FieldLabel>
              <Input
                value={url}
                onValueChange={setUrl}
                placeholder="minegocio.cl"
                required
                maxLength={2000}
                inputMode="url"
              />
              <FieldDescription>
                Leeremos esta página. Puedes agregar otras páginas por separado.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={pending || full || !url.trim()}>
              Agregar sitio web
            </Button>
          </form>
        </TabsPanel>
        <TabsPanel value="pdf" className="pt-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!file) return;
              const form = event.currentTarget;
              if (full) {
                setError(
                  "Llegaste a 10 fuentes. Quita una antes de subir un PDF.",
                );
                return;
              }
              if (
                file.size > 10 * 1024 * 1024 ||
                file.type !== "application/pdf"
              ) {
                setError("Elige un archivo PDF de hasta 10 MB.");
                return;
              }
              void run(async () => {
                const uploadUrl = await generateUploadUrl({ agentId });
                const response = await fetch(uploadUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/pdf" },
                  body: file,
                });
                if (!response.ok) throw new Error("upload failed");
                const uploaded: { storageId: Id<"_storage"> } =
                  await response.json();
                await addPdf({
                  agentId,
                  storageId: uploaded.storageId,
                  filename: file.name,
                });
                setFile(null);
                form.reset();
              });
            }}
          >
            <Field name="pdf">
              <FieldLabel>Selecciona un PDF</FieldLabel>
              <Input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <FieldDescription>
                Hasta 10 MB y 200 páginas. Debe tener texto seleccionable; no
                podemos leer fotos de documentos.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={pending || full || !file}>
              {pending ? "Subiendo…" : "Agregar PDF"}
            </Button>
          </form>
        </TabsPanel>
        <TabsPanel value="text" className="pt-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await addText({ agentId, label, text });
                setLabel("");
                setText("");
              });
            }}
          >
            <Field name="source-label">
              <FieldLabel>Nombre de esta información</FieldLabel>
              <Input
                value={label}
                onValueChange={setLabel}
                placeholder="Horarios y servicios"
                required
                maxLength={200}
              />
            </Field>
            <Field name="source-text">
              <FieldLabel>¿Qué debe saber?</FieldLabel>
              <Textarea
                value={text}
                onValueChange={setText}
                rows={5}
                required
                maxLength={20000}
                placeholder="Abrimos de lunes a viernes de 9:00 a 18:00…"
              />
            </Field>
            <Button
              type="submit"
              disabled={pending || full || !label.trim() || !text.trim()}
            >
              Agregar texto
            </Button>
          </form>
        </TabsPanel>
      </Tabs>
      <div>
        <h3 className="font-semibold">
          Su información ({detail.sources.length}/10)
        </h3>
        {full && (
          <p className="mt-2 text-sm text-subtle-foreground">
            Llegaste a 10 fuentes. Quita una para agregar otra.
          </p>
        )}
        {!detail.sources.length ? (
          <p className="mt-3 text-subtle-foreground">
            Todavía no le has dado información. Empieza con una página, un
            documento o unas líneas de texto.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {detail.sources.map((source) => (
              <li
                key={source._id}
                className="flex items-start justify-between gap-3 py-4"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium">{source.label}</p>
                  <p
                    className="mt-1 flex items-center gap-2 text-sm text-subtle-foreground"
                    role="status"
                  >
                    {source.status === "processing" && (
                      <LoaderCircle
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    )}
                    {source.status === "ready"
                      ? "Listo"
                      : source.status === "processing"
                        ? "Procesando…"
                        : "Falló"}
                  </p>
                  {source.error && (
                    <p className="mt-2 text-sm text-destructive">
                      {source.error}
                    </p>
                  )}
                </div>
                <Button
                  disabled={pending}
                  aria-label={`Quitar ${source.label}`}
                  onClick={() => run(() => remove({ sourceId: source._id }))}
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-subtle-foreground">
          {notice}
        </p>
      )}
    </section>
  );
}

function ProfileSection({ detail }: { detail: Detail }) {
  const categories = useQuery(api.directory.categories, {});
  const suggest = useAction(api.agentBuilder.draftProfile);
  const update = useMutation(api.agentBuilder.updateProfile);
  const [fields, setFields] = useState({
    name: detail.agent.name,
    description: detail.agent.description,
    purpose: detail.agent.purpose,
    category: detail.agent.primaryCategory,
    instructions: detail.instructions,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function change(key: keyof typeof fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice("Tienes cambios sin guardar.");
  }
  async function generate() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const suggestion = await suggest({ agentId: detail.agent._id });
      setFields((current) => ({ ...current, ...suggestion }));
      setNotice(
        "Preparamos una propuesta. Revísala y presiona Guardar perfil para aplicarla.",
      );
    } catch (error) {
      setError(builderError(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className={panel} aria-labelledby="profile-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="profile-title" className="text-2xl font-semibold">
            2. Su perfil
          </h2>
          <p className="mt-2 text-subtle-foreground">
            Así se presentará. Tú tienes la última palabra.
          </p>
        </div>
        <Button disabled={pending} onClick={generate}>
          {pending ? "Preparando…" : "Redactar con IA"}
        </Button>
      </div>
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          try {
            await update({ agentId: detail.agent._id, ...fields });
            setNotice("Perfil guardado. Ya puedes probar los cambios.");
          } catch (error) {
            setError(builderError(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Field name="profile-name">
          <FieldLabel>Nombre</FieldLabel>
          <Input
            value={fields.name}
            onValueChange={(value) => change("name", value)}
            required
            maxLength={120}
          />
        </Field>
        <Field name="description">
          <FieldLabel>Descripción</FieldLabel>
          <Textarea
            value={fields.description}
            onValueChange={(value) => change("description", value)}
            required
            maxLength={1000}
            rows={3}
          />
          <FieldDescription>
            Una presentación breve para quienes lo encuentren en el directorio.
          </FieldDescription>
        </Field>
        <Field name="purpose">
          <FieldLabel>¿En qué puede ayudar?</FieldLabel>
          <Textarea
            value={fields.purpose}
            onValueChange={(value) => change("purpose", value)}
            required
            maxLength={1000}
            rows={3}
          />
        </Field>
        <Select
          name="category"
          value={fields.category}
          onValueChange={(value) => change("category", value ?? "")}
          required
        >
          <SelectLabel>Categoría</SelectLabel>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories?.map((category) => (
              <SelectItem key={category.slug} value={category.slug}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Field name="instructions">
          <FieldLabel>Cómo debe comportarse</FieldLabel>
          <Textarea
            value={fields.instructions}
            onValueChange={(value) => change("instructions", value)}
            rows={5}
            maxLength={8000}
          />
          <FieldDescription>
            Por ejemplo: responde de forma amable y breve; si no sabes algo,
            invita a contactarnos.
          </FieldDescription>
        </Field>
        <Button
          type="submit"
          data-variant="solid"
          disabled={pending || !categories || !fields.category}
        >
          Guardar perfil
        </Button>
        {notice && (
          <p role="status" className="text-sm text-subtle-foreground">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

function TestSection({ detail }: { detail: Detail }) {
  const testChat = useAction(api.agentBuilder.testChat);
  const publish = useMutation(api.agentBuilder.publish);
  const unpublish = useMutation(api.agentBuilder.unpublish);
  const [history, setHistory] = useState<
    { id: string; role: "user" | "assistant"; content: string }[]
  >([]);
  const [question, setQuestion] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [publishPending, setPublishPending] = useState(false);
  const [error, setError] = useState("");
  const active = detail.agent.status === "active";
  return (
    <section className={panel} aria-labelledby="test-title">
      <div>
        <h2 id="test-title" className="text-2xl font-semibold">
          3. Pruébalo y publícalo
        </h2>
        <p className="mt-2 text-subtle-foreground">
          Hazle una pregunta como si fueras un cliente. Usará la información
          lista y el último perfil guardado.
        </p>
      </div>
      <div className="rounded-3xl border border-border p-4">
        <section
          className="max-h-80 space-y-3 overflow-y-auto"
          aria-live="polite"
          aria-label="Conversación de prueba"
        >
          {!history.length && (
            <p className="text-subtle-foreground">
              Por ejemplo: «¿Qué servicios ofrecen y a qué hora abren?»
            </p>
          )}
          {history.map((message) => (
            <div
              key={message.id}
              className={`rounded-2xl p-3 ${message.role === "user" ? "ml-6 bg-muted" : "mr-6 border border-border"}`}
            >
              <p className="mb-1 text-xs font-semibold">
                {message.role === "user" ? "Tú" : detail.agent.name}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {message.content}
              </p>
            </div>
          ))}
          {chatPending && <p role="status">Preparando respuesta…</p>}
        </section>
        <form
          className="mt-4 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (chatPending || !question.trim()) return;
            setChatPending(true);
            setError("");
            const content = question.trim();
            try {
              const answer = await testChat({
                agentId: detail.agent._id,
                question: content,
                history: history
                  .slice(-20)
                  .map(({ role, content }) => ({ role, content })),
              });
              setHistory((current) => [
                ...current,
                { id: crypto.randomUUID(), role: "user", content },
                { id: crypto.randomUUID(), role: "assistant", content: answer },
              ]);
              setQuestion("");
            } catch (error) {
              setError(builderError(error));
            } finally {
              setChatPending(false);
            }
          }}
        >
          <Field name="question">
            <FieldLabel>Tu pregunta de prueba</FieldLabel>
            <Input
              value={question}
              onValueChange={setQuestion}
              required
              maxLength={2000}
              placeholder="¿Cuáles son sus horarios?"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={chatPending || !question.trim()}>
              Enviar pregunta
            </Button>
            <Button
              disabled={chatPending || !history.length}
              onClick={() => setHistory([])}
            >
              Empezar de nuevo
            </Button>
          </div>
        </form>
      </div>
      <div className="rounded-3xl bg-muted p-5">
        <p className="font-semibold">
          {active
            ? "Tu agente está publicado"
            : "Tu agente es un borrador privado"}
        </p>
        <p className="mt-2 text-sm text-subtle-foreground">
          {active
            ? "Ya aparece en el directorio y otras personas pueden encontrarlo."
            : "Solo tú puedes verlo aquí. Publícalo cuando estés conforme para que otras personas puedan encontrarlo."}{" "}
          Puedes cambiarlo u ocultarlo en cualquier momento.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            data-variant={active ? "solid" : "brand"}
            disabled={publishPending}
            onClick={async () => {
              setPublishPending(true);
              setError("");
              try {
                if (active) await unpublish({ agentId: detail.agent._id });
                else await publish({ agentId: detail.agent._id });
              } catch (error) {
                setError(builderError(error));
              } finally {
                setPublishPending(false);
              }
            }}
          >
            {publishPending
              ? "Guardando…"
              : active
                ? "Ocultar del directorio"
                : "Publicar en el directorio"}
          </Button>
          {active && (
            <Button render={<Link href={`/directory/${detail.agent.slug}`} />}>
              Ver en el directorio
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
