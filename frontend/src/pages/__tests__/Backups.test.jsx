// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const service = vi.hoisted(() => {
    class BackupIntegrityError extends Error {}
    return {
        BackupIntegrityError,
        listBackups: vi.fn(),
        getBackup: vi.fn(),
        startBackup: vi.fn(),
        startReadableExport: vi.fn(),
        downloadBackup: vi.fn(),
        KIND_DUMP: "DUMP",
        KIND_READABLE: "READABLE_EXPORT",
        kindOf: (b) => (b?.kind === "READABLE_EXPORT" ? "READABLE_EXPORT" : "DUMP"),
    };
});

vi.mock("../../services/backupService", () => service);

import Backups from "../Backups";
import { formatBytes } from "../../utils/formatBytes";

const DONE = {
    id: 7, status: "SUCCEEDED", startedAt: "2026-11-11T10:00:00", finishedAt: "2026-11-11T10:00:30",
    durationMs: 30000, sizeBytes: 2 * 1024 * 1024, sha256: "ab".repeat(32), initiatedByName: "Admin One",
    available: true, fileName: "crm-backup-20261111T100000Z-7.dump",
};
const FAILED = {
    id: 6, status: "FAILED", startedAt: "2026-11-10T10:00:00", initiatedByName: "Admin One",
    available: false, errorMessage: "pg_dump failed (exit 1): server version mismatch",
};
const REMOVED = { ...DONE, id: 2, available: false, fileName: "crm-backup-old-2.dump" };

const EXPORT_DONE = {
    id: 20, kind: "READABLE_EXPORT", status: "SUCCEEDED", startedAt: "2026-11-15T09:00:00",
    finishedAt: "2026-11-15T09:00:12", durationMs: 12000, sizeBytes: 300 * 1024, sha256: "cd".repeat(32),
    totalRows: 12345, initiatedByName: "Admin One", available: true, expiresAt: "2026-12-15T09:00:12",
    fileName: "crm-readable-export-20261115T090000Z-20.zip",
};
const EXPORT_EXPIRED = { ...EXPORT_DONE, id: 19, available: false, expiresAt: null };

beforeEach(() => {
    vi.clearAllMocks();
    service.listBackups.mockResolvedValue([DONE, FAILED, REMOVED]);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("Database backups (admin)", () => {

    it("lists the history and says that uploaded document files are not included", async () => {
        render(<Backups />);

        expect(await screen.findByText("pg_dump failed (exit 1): server version mismatch")).toBeTruthy();
        expect(screen.getByText(/Not included:/)).toBeTruthy();
        expect(screen.getByText(/uploaded document files/)).toBeTruthy();
        expect(screen.getAllByText("Succeeded", { selector: "span" })).toHaveLength(2);
        expect(screen.getByText("Failed", { selector: "span" })).toBeTruthy();
        expect(screen.getByText("Removed by retention")).toBeTruthy();
        expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
    });

    it("takes a backup, disables the button while it runs, and reports success", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        service.startBackup.mockResolvedValue({ id: 8, status: "RUNNING" });
        service.getBackup
            .mockResolvedValueOnce({ id: 8, status: "RUNNING" })
            .mockResolvedValueOnce({ ...DONE, id: 8, sizeBytes: 1536, durationMs: 4000 });

        render(<Backups />);
        const button = await screen.findByRole("button", { name: /Take Backup/ });
        fireEvent.click(button);

        await screen.findByText(/Backup started/);
        expect(screen.getByRole("button", { name: /Taking backup/ }).disabled).toBe(true);
        expect(service.startBackup).toHaveBeenCalledTimes(1);

        // a second click while running does nothing
        fireEvent.click(screen.getByRole("button", { name: /Taking backup/ }));
        expect(service.startBackup).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

        expect(await screen.findByText("Backup completed successfully (1.5 KB, 4 s).")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Take Backup/ }).disabled).toBe(false);
    });

    it("sends only one request for two clicks in the same frame (before React re-renders)", async () => {
        let resolve;
        service.startBackup.mockReturnValue(new Promise((r) => { resolve = r; }));
        service.getBackup.mockResolvedValue({ id: 9, status: "RUNNING" });

        render(<Backups />);
        const button = await screen.findByRole("button", { name: /Take Backup/ });
        // both dispatched synchronously: the button is not disabled yet for the second
        act(() => {
            button.click();
            button.click();
        });

        expect(service.startBackup).toHaveBeenCalledTimes(1);
        await act(async () => { resolve({ id: 9, status: "RUNNING" }); });
    });

    it("reports a failed backup with its reason", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        service.startBackup.mockResolvedValue({ id: 9, status: "RUNNING" });
        service.getBackup.mockResolvedValue({ id: 9, status: "FAILED", errorMessage: "Not enough free disk space" });

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: /Take Backup/ }));
        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

        expect(await screen.findByText("Backup failed: Not enough free disk space")).toBeTruthy();
    });

    it("shows the server's message when a backup is already running, and follows that one", async () => {
        service.listBackups
            .mockResolvedValueOnce([DONE])
            .mockResolvedValue([{ id: 10, status: "RUNNING", startedAt: "2026-11-11T11:00:00", initiatedByName: "Other Admin" }, DONE]);
        service.startBackup.mockRejectedValue({
            response: { status: 409, data: { message: "A backup is already in progress. Please wait for it to finish." } },
        });
        service.getBackup.mockResolvedValue({ id: 10, status: "RUNNING" });

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: /Take Backup/ }));

        expect(await screen.findByText("A backup is already in progress. Please wait for it to finish.")).toBeTruthy();
        await waitFor(() => expect(screen.getByRole("button", { name: /Taking backup/ }).disabled).toBe(true));
    });

    it("resumes watching a backup that is already running when the page opens", async () => {
        service.listBackups.mockResolvedValue([{ id: 11, status: "RUNNING", startedAt: "2026-11-11T11:00:00", initiatedByName: "A" }]);
        service.getBackup.mockResolvedValue({ id: 11, status: "RUNNING" });

        render(<Backups />);

        await waitFor(() => expect(screen.getByRole("button", { name: /Taking backup/ }).disabled).toBe(true));
        expect(screen.getByText(/You can leave this page/)).toBeTruthy();
    });

    it("explains a 403 instead of failing silently", async () => {
        service.listBackups.mockRejectedValue({ response: { status: 403 } });

        render(<Backups />);

        expect(await screen.findByText("Only an administrator can take or download backups.")).toBeTruthy();
    });

    it("downloads through the service, and reports an incomplete file", async () => {
        service.downloadBackup.mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new service.BackupIntegrityError("The downloaded file is incomplete. Please try again."));

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: "Download" }));
        await waitFor(() => expect(service.downloadBackup).toHaveBeenCalledWith(DONE));

        await waitFor(() => expect(screen.getByRole("button", { name: "Download" }).disabled).toBe(false));
        fireEvent.click(screen.getByRole("button", { name: "Download" }));
        expect(await screen.findByText("The downloaded file is incomplete. Please try again.")).toBeTruthy();
    });

    it("formats sizes", () => {
        expect(formatBytes(undefined)).toBe("-");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    });

    // ---- readable exports ------------------------------------------------

    it("shows full backups and readable exports as two clearly separate tools", async () => {
        service.listBackups.mockResolvedValue([EXPORT_DONE, DONE, EXPORT_EXPIRED, FAILED]);

        render(<Backups />);

        expect(await screen.findByRole("heading", { name: /Full backup/ })).toBeTruthy();
        expect(screen.getByText("For restoring")).toBeTruthy();
        expect(screen.getByRole("heading", { name: /Readable export/ })).toBeTruthy();
        expect(screen.getByText("Not a backup - cannot restore")).toBeTruthy();

        // each history only lists its own kind
        const exportsSection = screen.getByRole("heading", { name: /Readable export/ }).closest("section");
        const dumpsSection = screen.getByRole("heading", { name: /Full backup/ }).closest("section");
        expect(within(exportsSection).getAllByText("12,345")).toHaveLength(2);
        expect(within(exportsSection).getByText("Expired or removed")).toBeTruthy();
        expect(within(exportsSection).queryByText(/pg_dump failed/)).toBeNull();
        expect(within(dumpsSection).getByText(/pg_dump failed/)).toBeTruthy();
        expect(within(dumpsSection).queryByText("12,345")).toBeNull();

        expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: "Download readable export" })).toHaveLength(1);
    });

    it("creates a readable export, disables both buttons while it runs, and reports success", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        service.listBackups.mockResolvedValue([DONE]);
        service.startReadableExport.mockResolvedValue({ id: 21, kind: "READABLE_EXPORT", status: "RUNNING" });
        service.getBackup
            .mockResolvedValueOnce({ id: 21, kind: "READABLE_EXPORT", status: "RUNNING" })
            .mockResolvedValueOnce({ ...EXPORT_DONE, id: 21, sizeBytes: 2048, durationMs: 9000, totalRows: 1500 });

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: /Create Readable Export/ }));

        await screen.findByText(/Readable export started/);
        expect(service.startReadableExport).toHaveBeenCalledTimes(1);
        expect(service.startBackup).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: /Creating export/ }).disabled).toBe(true);
        expect(screen.getByRole("button", { name: /Take Backup/ }).disabled).toBe(true);
        expect(screen.getByText(/only one can run at a time/)).toBeTruthy();

        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

        expect(await screen.findByText("Readable export completed (2.0 KB, 1,500 rows, 9 s).")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Create Readable Export/ }).disabled).toBe(false);
        expect(screen.getByRole("button", { name: /Take Backup/ }).disabled).toBe(false);
    });

    it("reports a failed readable export with its reason, never as a backup", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        service.listBackups.mockResolvedValue([]);
        service.startReadableExport.mockResolvedValue({ id: 22, kind: "READABLE_EXPORT", status: "RUNNING" });
        service.getBackup.mockResolvedValue({
            id: 22, kind: "READABLE_EXPORT", status: "FAILED",
            errorMessage: "The readable export is larger than the 50 MB limit for one file in backup storage",
        });

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: /Create Readable Export/ }));
        await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

        expect(await screen.findByText(
            "Readable export failed: The readable export is larger than the 50 MB limit for one file in backup storage")).toBeTruthy();
        expect(screen.queryByText(/^Backup failed/)).toBeNull();
    });

    it("resumes watching a readable export that is already running when the page opens", async () => {
        service.listBackups.mockResolvedValue([{ id: 23, kind: "READABLE_EXPORT", status: "RUNNING", startedAt: "2026-11-15T09:00:00", initiatedByName: "A" }]);
        service.getBackup.mockResolvedValue({ id: 23, kind: "READABLE_EXPORT", status: "RUNNING" });

        render(<Backups />);

        await waitFor(() => expect(screen.getByRole("button", { name: /Creating export/ }).disabled).toBe(true));
        expect(screen.getByRole("button", { name: /Take Backup/ }).disabled).toBe(true);
        expect(screen.getByText(/An export is running/)).toBeTruthy();
    });

    it("downloads a readable export through the same checked download", async () => {
        service.listBackups.mockResolvedValue([EXPORT_DONE]);
        service.downloadBackup.mockResolvedValue(undefined);

        render(<Backups />);
        fireEvent.click(await screen.findByRole("button", { name: "Download readable export" }));

        await waitFor(() => expect(service.downloadBackup).toHaveBeenCalledWith(EXPORT_DONE));
    });
});
