import { findDriveFilesByName, downloadDriveFile } from "../lib/googleDriveClient";
import { getSupabaseAdminClient } from "../lib/supabaseAdmin";

type AttachmentRow = {
  id: string;
  raw_attachment_id: string | null;
  file_ref: string;
  file_name: string | null;
  file_kind: string | null;
  mime_type: string | null;
};

type RawAttachmentRow = {
  id: string;
  drive_file_id: string | null;
};

const driveFileIdByName = new Map<string, string>();

async function getAttachment(attachmentId: string): Promise<AttachmentRow> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("id,raw_attachment_id,file_ref,file_name,file_kind,mime_type")
    .eq("id", attachmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error leyendo adjunto: ${error.message}`);
  }

  if (!data) {
    throw new Error("Adjunto no encontrado.");
  }

  return data as AttachmentRow;
}

async function getRawAttachment(rawAttachmentId: string | null): Promise<RawAttachmentRow | null> {
  if (!rawAttachmentId) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("raw_appsheet_attachments")
    .select("id,drive_file_id")
    .eq("id", rawAttachmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error leyendo adjunto raw: ${error.message}`);
  }

  return data as RawAttachmentRow | null;
}

async function resolveDriveFileId(attachment: AttachmentRow): Promise<string | null> {
  const rawAttachment = await getRawAttachment(attachment.raw_attachment_id);
  if (rawAttachment?.drive_file_id) {
    return rawAttachment.drive_file_id;
  }

  const fileName = attachment.file_name ?? attachment.file_ref.split(/[\\/]/).pop();
  if (!fileName) {
    return null;
  }

  const cached = driveFileIdByName.get(fileName);
  if (cached) {
    return cached;
  }

  const matches = await findDriveFilesByName(fileName);
  const match = matches.find((file) => file.mimeType.startsWith("image/")) ?? matches[0];

  if (!match) {
    return null;
  }

  driveFileIdByName.set(fileName, match.id);
  return match.id;
}

export async function getAttachmentImage(attachmentId: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const attachment = await getAttachment(attachmentId);

  if (attachment.file_kind !== "image") {
    throw new Error("El adjunto no es una imagen.");
  }

  const driveFileId = await resolveDriveFileId(attachment);
  if (!driveFileId) {
    throw new Error("No se pudo resolver el archivo en Drive.");
  }

  const downloaded = await downloadDriveFile(driveFileId);

  return {
    body: downloaded.buffer,
    contentType: downloaded.mimeType ?? attachment.mime_type ?? "application/octet-stream"
  };
}
