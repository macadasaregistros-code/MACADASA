import { google, type drive_v3 } from "googleapis";
import { config } from "dotenv";

config();

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  modifiedTime?: string;
};

let cachedDriveClient: drive_v3.Drive | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Configure it in .env or in the server runtime.`
    );
  }

  return value;
}

export function getGoogleDriveClient(): drive_v3.Drive {
  if (cachedDriveClient) {
    return cachedDriveClient;
  }

  const email = getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"]
  });

  cachedDriveClient = google.drive({ version: "v3", auth });
  return cachedDriveClient;
}

function normalizeDriveFile(file: drive_v3.Schema$File): DriveFile | null {
  if (!file.id || !file.name || !file.mimeType) {
    return null;
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents ?? undefined,
    webViewLink: file.webViewLink ?? undefined,
    modifiedTime: file.modifiedTime ?? undefined
  };
}

export async function listDriveFiles(query: string): Promise<DriveFile[]> {
  const drive = getGoogleDriveClient();
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: query,
      spaces: "drive",
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "nextPageToken,files(id,name,mimeType,parents,webViewLink,modifiedTime)"
    });

    for (const file of response.data.files ?? []) {
      const normalizedFile = normalizeDriveFile(file);
      if (normalizedFile) {
        files.push(normalizedFile);
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

export async function listDriveFolderItems(folderId: string): Promise<DriveFile[]> {
  return listDriveFiles(`'${folderId}' in parents and trashed = false`);
}

export async function listVisibleGoogleSheets(): Promise<DriveFile[]> {
  return listDriveFiles(
    "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
  );
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findDriveFoldersByName(folderName: string): Promise<DriveFile[]> {
  return listDriveFiles(
    [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `name = '${escapeDriveQueryValue(folderName)}'`
    ].join(" and ")
  );
}

export async function findDriveFilesByName(fileName: string): Promise<DriveFile[]> {
  return listDriveFiles(
    [
      "trashed = false",
      `name = '${escapeDriveQueryValue(fileName)}'`
    ].join(" and ")
  );
}

export async function downloadDriveFile(fileId: string): Promise<{
  buffer: Buffer;
  mimeType: string | null;
}> {
  const drive = getGoogleDriveClient();
  const metadata = await drive.files.get({
    fileId,
    fields: "id,name,mimeType",
    supportsAllDrives: true
  });
  const response = await drive.files.get(
    {
      fileId,
      alt: "media",
      supportsAllDrives: true
    },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(response.data as ArrayBuffer),
    mimeType: metadata.data.mimeType ?? null
  };
}
