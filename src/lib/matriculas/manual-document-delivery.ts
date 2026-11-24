export interface ManualDocumentDelivery {
  sent: boolean;
  sent_at: string | null;
  sent_by: string | null;
}

/** A staff declaration never substitutes for a Meta delivery acknowledgement. */
export function manualDocumentDelivery(value: unknown, folder: string | null): ManualDocumentDelivery {
  const empty: ManualDocumentDelivery = { sent: false, sent_at: null, sent_by: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const receipt = value as Record<string, unknown>;
  if (receipt.sent !== true || !folder?.startsWith('https://drive.google.com/drive/folders/')
      || receipt.folder_url !== folder || typeof receipt.sent_at !== 'string'
      || !Number.isFinite(Date.parse(receipt.sent_at)) || typeof receipt.sent_by !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.sent_by)) return empty;
  return { sent: true, sent_at: receipt.sent_at, sent_by: receipt.sent_by };
}
