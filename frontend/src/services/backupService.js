import api from "./api";

import { downloadBlob } from "../utils/downloadFile";

// Database backups ("Take Backup") and readable data exports. ADMIN only - the
// backend enforces it on every one of these calls (403 for anyone else), the
// route guard is only UX.
//
// kind "DUMP"            = full, restorable backup (.dump)
// kind "READABLE_EXPORT" = ZIP of CSV files for viewing in Excel (NOT restorable)
// Rows from before readable exports existed have no kind: they are dumps.

export const KIND_DUMP = "DUMP";
export const KIND_READABLE = "READABLE_EXPORT";

export const kindOf = (backup) => (backup?.kind === KIND_READABLE ? KIND_READABLE : KIND_DUMP);

// Newest of both kinds; split them with kindOf().
export const listBackups = async () => {
    const response = await api.get("/admin/backups");
    return response.data;
};

export const getBackup = async (id) => {
    const response = await api.get(`/admin/backups/${id}`);
    return response.data;
};

// Starts a full backup in the background: 202 with { id, status: "RUNNING" }.
// 409 while another backup or export is running, 503 when backups are not configured.
export const startBackup = async () => {
    const response = await api.post("/admin/backups");
    return response.data;
};

// Starts a readable data export the same way (same 202 / 409 / 503).
export const startReadableExport = async () => {
    const response = await api.post("/admin/backups/readable");
    return response.data;
};

async function sha256Hex(blob) {

    const subtle = globalThis.crypto?.subtle;

    if (!subtle || typeof blob.arrayBuffer !== "function") {
        return null; // cannot check here (e.g. a non-HTTPS origin); size is still checked
    }

    const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class BackupIntegrityError extends Error {}

// Fetches the file through the authenticated API (never a public link), checks
// it is complete - same size and SHA-256 as recorded when it was made - and
// only then saves it. Works for both kinds.
export const downloadBackup = async (backup) => {

    const response = await api.get(`/admin/backups/${backup.id}/download`, {
        responseType: "blob",
        timeout: 10 * 60 * 1000,
    });

    const blob = response.data;

    if (typeof backup.sizeBytes === "number" && blob.size !== backup.sizeBytes) {
        throw new BackupIntegrityError("The downloaded file is incomplete. Please try again.");
    }

    const actual = await sha256Hex(blob);

    if (actual && backup.sha256 && actual !== backup.sha256.toLowerCase()) {
        throw new BackupIntegrityError("The downloaded file does not match its checksum. Please try again.");
    }

    const fallback = kindOf(backup) === KIND_READABLE
        ? `crm-readable-export-${backup.id}.zip`
        : `crm-backup-${backup.id}.dump`;

    downloadBlob(blob, backup.fileName || fallback);
};
