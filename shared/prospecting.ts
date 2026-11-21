import { z } from "zod";
import { Location } from "./geo";

export const BusinessProvider = z.enum([
  "fixture",
  "osm",
  "google_places",
  "firecrawl",
]);
export type BusinessProvider = z.infer<typeof BusinessProvider>;

export const ProspectingScope = z.object({
  category: z.string().min(1),
  area: z.object({
    label: z.string().min(1),
    comuna: z.string().optional(),
    center: z.object({ lat: z.number(), lng: z.number() }),
    radiusKm: z.number().positive().max(20),
  }),
  limit: z.number().int().min(1).max(50),
});
export type ProspectingScope = z.infer<typeof ProspectingScope>;

export const ProspectingJobStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export type ProspectingJobStatus = z.infer<typeof ProspectingJobStatus>;

export const BusinessContact = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
});
export type BusinessContact = z.infer<typeof BusinessContact>;

export const SourceRef = z.object({
  provider: BusinessProvider,
  externalId: z.string().min(1),
  url: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const BusinessCandidate = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  location: Location.optional(),
  contact: BusinessContact,
  openingHours: z.string().optional(),
  source: SourceRef,
});
export type BusinessCandidate = z.infer<typeof BusinessCandidate>;

export const SiteExtraction = z.object({
  description: z.string().optional(),
  offer: z.array(z.string()).max(30),
  openingHours: z.string().optional(),
  contact: BusinessContact,
});
export type SiteExtraction = z.infer<typeof SiteExtraction>;

export const OutreachChannel = z.enum([
  "email",
  "whatsapp",
  "phone",
  "web_form",
]);

export const OutreachDraftStatus = z.enum(["draft", "approved", "discarded"]);

export const OutreachDraft = z.object({
  channel: OutreachChannel,
  recipient: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1).max(4000),
  status: OutreachDraftStatus,
});
export type OutreachDraft = z.infer<typeof OutreachDraft>;

export const ProspectStatus = z.enum([
  "new",
  "agent_drafted",
  "claimed",
  "discarded",
]);
export type ProspectStatus = z.infer<typeof ProspectStatus>;
