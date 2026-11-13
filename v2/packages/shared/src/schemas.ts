import { z } from "zod";

export const feedAddressSchema = z.url({ protocol: /^https?$/ }).max(2048);
export const addFeedSchema = z.object({
  url: feedAddressSchema,
  title: z.string().trim().min(1).max(200).optional()
}).strict();
export const entryStateSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  saved: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0, "At least one state must be supplied");
export const cursorSchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  beforeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  feedId: z.uuid().optional()
}).refine(x=>Boolean(x.before)===Boolean(x.beforeId),
  "before and beforeId must be supplied together");
export type AddFeedInput = z.infer<typeof addFeedSchema>;
export type EntryStateInput = z.infer<typeof entryStateSchema>;

export function canonicalFeedUrl(raw: string): string {
  const parsed = feedAddressSchema.parse(raw);
  const url = new URL(parsed);
  if (url.username || url.password) throw new Error("Credentials in URLs are not supported");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.toString();
}
