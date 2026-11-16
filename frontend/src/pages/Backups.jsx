import { useCallback, useEffect, useRef, useState } from "react";

import {
    BackupIntegrityError,
    KIND_DUMP,
    KIND_READABLE,
    downloadBackup,
    getBackup,
    kindOf,
    listBackups,
    startBackup,
    startReadableExport,
} from "../services/backupService";
import { exportErrorMessage } from "../utils/downloadFile";
import { formatBytes } from "../utils/formatBytes";
import { formatDateTime } from "../utils/formatDate";

const POLL_MS = 3000;

const STATUS = {
    RUNNING: { label: "Running", badge: "bg-info text-dark" },
    SUCCEEDED: { label: "Succeeded", badge: "bg-success" },
    FAILED: { label: "Failed", badge: "bg-danger" },
};

// Wording per kind, so the page never mixes up a restorable backup with a
// readable export.
const TEXT = {
    [KIND_DUMP]: {
        start: "Take Backup",
        running: "Taking backup...",
        started: "Backup started. This page will tell you when it has finished.",
        succeeded: (b) => `Backup completed successfully (${formatBytes(b.sizeBytes)}, ${formatDuration(b.durationMs)}).`,
        failed: "Backup failed",
        unableToStart: "Unable to start the backup.",
        gone: "Removed by retention",
        icon: "bi-database-down",
    },
    [KIND_READABLE]: {
        start: "Create Readable Export",
        running: "Creating export...",
        started: "Readable export started. This page will tell you when it has finished.",
        succeeded: (b) => `Readable export completed (${formatBytes(b.sizeBytes)}, `
            + `${typeof b.totalRows === "number" ? `${b.totalRows.toLocaleString("en-GB")} rows, ` : ""}`
            + `${formatDuration(b.durationMs)}).`,
        failed: "Readable export failed",
        unableToStart: "Unable to start the readable export.",
        gone: "Expired or removed",
        icon: "bi-file-earmark-spreadsheet",
    },
};

function formatDuration(ms) {

    if (typeof ms !== "number") {
        return "-";
    }

    const seconds = Math.round(ms / 1000);
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function errorText(err, fallback) {

    if (err.response?.status === 403) {
        return "Only an administrator can take or download backups.";
    }

    return err.response?.data?.message || fallback;
}

function History({ kind, rows, loading, downloadingId, onDownload }) {

    const readable = kind === KIND_READABLE;

    if (loading) {
        return <div className="text-muted">Loading...</div>;
    }

    if (rows.length === 0) {
        return (
            <div className="text-muted">
                {readable ? "No readable exports have been created yet." : "No backups have been taken yet."}
            </div>
        );
    }

    return (
        <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
                <thead>
                    <tr>
                        <th>Started</th>
                        <th>By</th>
                        <th>Status</th>
                        <th>Size</th>
                        {readable && <th>Rows</th>}
                        <th>Duration</th>
                        {readable && <th>Kept until</th>}
                        <th className="text-end">File</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((b) => (
                        <tr key={b.id}>
                            <td className="small">{formatDateTime(b.startedAt)}</td>
                            <td className="small">{b.initiatedByName}</td>
                            <td>
                                <span className={`badge ${STATUS[b.status]?.badge || "bg-secondary"}`}>
                                    {STATUS[b.status]?.label || b.status}
                                </span>
                                {b.status === "FAILED" && b.errorMessage && (
                                    <div className="small text-danger mt-1">{b.errorMessage}</div>
                                )}
                            </td>
                            <td className="small">{formatBytes(b.sizeBytes)}</td>
                            {readable && (
                                <td className="small">
                                    {typeof b.totalRows === "number" ? b.totalRows.toLocaleString("en-GB") : "-"}
                                </td>
                            )}
                            <td className="small">{formatDuration(b.durationMs)}</td>
                            {readable && <td className="small">{b.expiresAt ? formatDateTime(b.expiresAt) : "-"}</td>}
                            <td className="text-end">
                                {b.available ? (
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => onDownload(b)}
                                        disabled={downloadingId !== null}
                                        aria-label={readable ? "Download readable export" : "Download"}
                                    >
                                        {downloadingId === b.id ? "Downloading..." : (readable ? "Download .zip" : "Download")}
                                    </button>
                                ) : (
                                    <span className="small text-muted">
                                        {b.status === "SUCCEEDED" ? TEXT[kind].gone : "-"}
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// Admin-only backups page, with two clearly separate tools:
//  - Full backup (.dump): a complete copy of the CRM database for RESTORING it,
//    made on the server, verified, kept in private storage (the newest 14).
//  - Readable export (.zip of CSV files): the CRM's records for VIEWING in
//    Excel. Not a backup - it cannot restore anything. Kept for 30 days at
//    most (the newest 5).
// Only one of the two runs at a time (the server enforces it). The page polls
// until a job finishes and then says clearly whether it worked.
export default function Backups() {

    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(null);
    const startingRef = useRef(false);
    const [running, setRunning] = useState(null); // { id, kind }
    const [downloadingId, setDownloadingId] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const timer = useRef(null);
    const mounted = useRef(true);

    const refresh = useCallback(async () => {

        try {

            const list = await listBackups();

            if (!mounted.current) {
                return null;
            }

            setBackups(list);
            return list;

        } catch (err) {

            console.error(err);

            if (mounted.current) {
                setError(errorText(err, "Unable to load the backups."));
            }

            return null;

        } finally {

            if (mounted.current) {
                setLoading(false);
            }

        }

    }, []);

    const poll = useCallback((id, kind) => {

        clearTimeout(timer.current);
        setRunning({ id, kind });

        timer.current = setTimeout(async function check() {

            try {

                const b = await getBackup(id);

                if (!mounted.current) {
                    return;
                }

                if (b.status === "RUNNING") {
                    timer.current = setTimeout(check, POLL_MS);
                    return;
                }

                setRunning(null);
                const text = TEXT[kindOf(b.kind ? b : { kind })];

                if (b.status === "SUCCEEDED") {
                    setError(null);
                    setNotice(text.succeeded(b));
                } else {
                    setNotice(null);
                    setError(`${text.failed}: ${b.errorMessage || "unknown error"}`);
                }

                refresh();

            } catch (err) {

                console.error(err);

                if (mounted.current) {
                    // a cold start or a blip: keep watching rather than give up
                    timer.current = setTimeout(check, POLL_MS * 2);
                }

            }

        }, POLL_MS);

    }, [refresh]);

    const followRunning = useCallback((list) => {
        const r = list?.find((b) => b.status === "RUNNING");
        if (r) {
            poll(r.id, kindOf(r));
        }
    }, [poll]);

    useEffect(() => {

        mounted.current = true;

        refresh().then(followRunning);

        return () => {
            mounted.current = false;
            clearTimeout(timer.current);
        };

    }, [refresh, followRunning]);

    const handleStart = async (kind) => {

        // The ref closes the gap before React re-renders: two clicks in the
        // same frame both still see starting === null. (The server answers
        // 409 to a second request anyway - this keeps it from being sent.)
        if (startingRef.current || starting || running) {
            return;
        }

        startingRef.current = true;
        setStarting(kind);
        setError(null);
        setNotice(null);

        try {

            const b = kind === KIND_READABLE ? await startReadableExport() : await startBackup();
            setNotice(TEXT[kind].started);
            poll(b.id, kind);
            refresh();

        } catch (err) {

            console.error(err);
            setError(errorText(err, TEXT[kind].unableToStart));

            if (err.response?.status === 409) {
                followRunning(await refresh());
            }

        } finally {

            startingRef.current = false;
            setStarting(null);

        }

    };

    const handleDownload = async (backup) => {

        setDownloadingId(backup.id);
        setError(null);

        try {

            await downloadBackup(backup);

        } catch (err) {

            console.error(err);
            setError(err instanceof BackupIntegrityError
                ? err.message
                : await exportErrorMessage(err, kindOf(backup) === KIND_READABLE ? "this readable export" : "this backup"));

        } finally {

            setDownloadingId(null);

        }

    };

    const busy = starting !== null || running !== null;
    const busyKind = starting || running?.kind || null;

    const startButton = (kind, className) => (
        <button type="button" className={`btn ${className}`} onClick={() => handleStart(kind)} disabled={busy}>
            {busyKind === kind
                ? (<><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />{TEXT[kind].running}</>)
                : (<><i className={`bi ${TEXT[kind].icon} me-2`} />{TEXT[kind].start}</>)}
        </button>
    );

    const runningNote = (kind) => busyKind === kind && running && (
        <span className="small text-muted">
            {kind === KIND_READABLE ? "An export is running." : "A backup is running."} You can leave this page; it
            continues on the server.
        </span>
    );

    const otherRunningNote = (kind) => busy && busyKind && busyKind !== kind && (
        <span className="small text-muted">
            {busyKind === KIND_READABLE ? "A readable export" : "A backup"} is running; only one can run at a time.
        </span>
    );

    const dumps = backups.filter((b) => kindOf(b) === KIND_DUMP);
    const exports = backups.filter((b) => kindOf(b) === KIND_READABLE);

    return (
        <div className="container-fluid">

            <div className="mb-3">
                <h2 className="mb-1">Database backups</h2>
                <p className="text-muted mb-0">
                    Two different tools: a <strong>full backup</strong> to restore the CRM if something goes wrong,
                    and a <strong>readable export</strong> to look at the data in Excel.
                </p>
            </div>

            {error && <div className="alert alert-danger py-2 px-3" role="alert">{error}</div>}
            {notice && <div className="alert alert-success py-2 px-3" role="status">{notice}</div>}

            <section className="card shadow-sm border-0 mb-4" aria-labelledby="full-backup-heading">
                <div className="card-body">
                    <h4 id="full-backup-heading" className="mb-1">
                        Full backup <span className="badge bg-primary align-middle ms-1">.dump</span>
                        <span className="badge bg-success align-middle ms-1">For restoring</span>
                    </h4>
                    <p className="text-muted mb-1">
                        Take Backup saves a complete copy of the CRM's records (leads, opportunities, customers,
                        follow-ups, employees, activity history and settings) to private storage. The newest 14
                        successful backups are kept. Only this file can be used to restore the CRM; it needs
                        PostgreSQL tools to open.
                    </p>
                    <p className="small text-muted mb-3">
                        <strong>Not included:</strong> uploaded document files (brochures, company profiles and other
                        attachments). Only their names and details are in the backup, not the files themselves.
                        Backup files contain personal and business data - store downloaded copies securely and
                        delete them when no longer needed.
                    </p>
                    <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
                        {startButton(KIND_DUMP, "btn-primary")}
                        {runningNote(KIND_DUMP)}
                        {otherRunningNote(KIND_DUMP)}
                    </div>
                    <h5 className="mb-2">Backup history</h5>
                    <History kind={KIND_DUMP} rows={dumps} loading={loading}
                        downloadingId={downloadingId} onDownload={handleDownload} />
                </div>
            </section>

            <section className="card shadow-sm border-0" aria-labelledby="readable-export-heading">
                <div className="card-body">
                    <h4 id="readable-export-heading" className="mb-1">
                        Readable export <span className="badge bg-secondary align-middle ms-1">.zip of CSV files</span>
                        <span className="badge bg-warning text-dark align-middle ms-1">Not a backup - cannot restore</span>
                    </h4>
                    <p className="text-muted mb-1">
                        Create Readable Export saves the CRM's records as spreadsheets you can open in Excel: one CSV
                        file per table, with a README explaining how the tables are linked. Use it to look at, filter
                        or check the data. It <strong>cannot</strong> be used to restore the CRM - use a full backup
                        for that.
                    </p>
                    <p className="small text-muted mb-3">
                        Contact details are included in full. Passwords, mailbox sign-in tokens and other login
                        secrets are never included, and consent / opt-out notes are withheld; the README lists
                        everything that was left out. The newest 5 exports are kept, each for at most 30 days.
                        The files contain personal and business data - store downloaded copies securely and
                        delete them when no longer needed.
                    </p>
                    <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
                        {startButton(KIND_READABLE, "btn-outline-primary")}
                        {runningNote(KIND_READABLE)}
                        {otherRunningNote(KIND_READABLE)}
                    </div>
                    <h5 className="mb-2">Export history</h5>
                    <History kind={KIND_READABLE} rows={exports} loading={loading}
                        downloadingId={downloadingId} onDownload={handleDownload} />
                </div>
            </section>

        </div>
    );
}
