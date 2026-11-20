import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import StatusBadge from "../components/ui/StatusBadge";
import FilterPanel from "../components/list/FilterPanel";
import ManageColumnsMenu from "../components/list/ManageColumnsMenu";
import BulkActionBar from "../components/list/BulkActionBar";
import RecordLink from "../components/list/RecordLink";
import ListPagination from "../components/list/ListPagination";

import useServerList, { serializeFilters } from "../hooks/useServerList";
import usePersistedColumns from "../hooks/usePersistedColumns";
import { formatDateTime } from "../utils/formatDate";
import { companyText, linkNote, relatedOf } from "../utils/followUpRelated";
import { downloadBlob, exportCountNotice, exportErrorMessage } from "../utils/downloadFile";
import {
    FOLLOWUP_VIEWS,
    FOLLOWUP_VIEW_KEYS,
    filtersForView,
    resolveFollowUpView,
    statusOptionsForView,
    summaryFilters,
} from "../utils/followUpViews";

import {
    getAllFollowUps,
    bulkDeleteFollowUps,
    exportFollowUps,
    getFollowUpSummary
} from "../services/followupService";
import { getAllActivityTypes } from "../services/activityTypeService";
import { getAllEmployees } from "../services/employeeService";

const FOLLOWUP_STATUS_OPTIONS = [
    { value: "PENDING", label: "Pending" },
    { value: "COMPLETED", label: "Completed" },
    { value: "MISSED", label: "Missed" },
    { value: "CANCELLED", label: "Cancelled" },
];

const ALL_FOLLOWUP_COLUMNS = [
    // Company / lead through the follow-up's own lead or, for an opportunity
    // follow-up (no lead of its own), its opportunity's lead - see related.
    {
        key: "lead", label: "Company / Lead",
        render: (row) => {
            const r = relatedOf(row);
            return (
                <div>
                    {r?.leadId
                        ? <RecordLink to={`/leads/${r.leadId}`} className="record-link">{companyText(r)}</RecordLink>
                        : <span className="text-muted">{companyText(r)}</span>}
                    <div className="small text-muted">
                        {[r?.contactPerson, linkNote(r)].filter(Boolean).join(" · ")}
                    </div>
                </div>
            );
        }
    },
    {
        key: "opportunity", label: "Opportunity",
        render: (row) => {
            const r = relatedOf(row);
            if (!r?.opportunityId) {
                return <span className="text-muted">-</span>;
            }
            return (
                <div>
                    <RecordLink to={`/opportunities/${r.opportunityId}`} className="record-link">
                        {r.opportunityTitle || "(untitled)"}
                    </RecordLink>
                    <div className="small text-muted">
                        {[`#${r.opportunityId}`, r.opportunityStage].filter(Boolean).join(" · ")}
                    </div>
                </div>
            );
        }
    },
    { key: "employee", label: "Employee", sortable: true, render: (row) => row.employee?.name || "-" },
    {
        key: "activity", label: "Activity", sortable: true, sortKey: "activityType",
        render: (row) => (
            <RecordLink to={`/followups/${row.id}`} className="record-link">
                {row.activityType?.name || "-"}
            </RecordLink>
        )
    },
    {
        key: "scheduledDate", label: "Scheduled", sortable: true,
        render: (row) => row.scheduledDate ? formatDateTime(row.scheduledDate) : "-"
    },
    { key: "status", label: "Status", sortable: true, render: (row) => <StatusBadge status={row.status} /> },
];

const DEFAULT_VISIBLE_FOLLOWUP_COLUMNS = ALL_FOLLOWUP_COLUMNS.map((c) => c.key);

export default function FollowUps() {

    const navigate = useNavigate();
    const location = useLocation();

    // Backend is the source of truth (FOLLOWUP_DELETE/FOLLOWUP_EXPORT are
    // ADMIN-only permissions - see FollowUpService) - this only controls
    // whether the checkbox/bulk-delete/export affordances are shown at all,
    // same "UX/defense-in-depth guard" rationale as AdminRoute.
    const isAdmin = localStorage.getItem("role") === "ADMIN";

    // The view (Open / History / All) is an explicit URL parameter - see
    // utils/followUpViews. Open, the default, is the absence of the parameter.
    const [searchParams, setSearchParams] = useSearchParams();
    const rawFilters = searchParams.get("filters");

    const urlFilters = useMemo(() => {

        try {
            const parsed = JSON.parse(rawFilters || "{}");
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }

    }, [rawFilters]);

    const view = resolveFollowUpView(searchParams.get("view"), urlFilters);

    // A pre-views link that only carried a status filter (e.g. status=COMPLETED)
    // is shown as All. Make that explicit in the URL once, so clearing the filter
    // afterwards keeps the view the user is looking at instead of flipping to Open.
    const viewParam = searchParams.get("view");

    useEffect(() => {

        if (!viewParam && view !== "open") {

            setSearchParams((prev) => {
                const params = new URLSearchParams(prev);
                params.set("view", view);
                return params;
            }, { replace: true });
        }

    }, [viewParam, view, setSearchParams]);

    // A new fetchFn per view also resets the row selection (useServerList), so a
    // ticked row from one view can never be exported or deleted from another.
    const fetchFollowUps = useCallback(
        (args) => getAllFollowUps({ ...args, filters: filtersForView(view, args.filters) }),
        [view]
    );

    const initialSort = useMemo(() => FOLLOWUP_VIEWS[view].sort, [view]);

    const list = useServerList({
        fetchFn: fetchFollowUps,
        initialSort
    });

    // Switching view keeps the search and the other filters, drops the Status
    // filter (each view decides its own statuses), returns to page 1 and to the
    // view's default sort.
    function changeView(next) {

        setSearchParams((prev) => {

            const params = new URLSearchParams(prev);

            if (next === "open") params.delete("view");
            else params.set("view", next);

            const serialized = serializeFilters(summaryFilters(urlFilters));
            if (serialized) params.set("filters", serialized);
            else params.delete("filters");

            params.delete("page");
            params.delete("sort");

            return params;

        }, { replace: true });

    }

    // Exact totals for the tabs and cards: same search and filters as the list,
    // without the status (the counts are per status). Refetched when the search
    // or a filter changes, or after a delete - not on every page click.
    const searchTerm = searchParams.get("q") || "";
    const scopeKey = JSON.stringify(summaryFilters(urlFilters));
    const [summary, setSummary] = useState(null);
    const [summaryTick, setSummaryTick] = useState(0);

    useEffect(() => {

        let cancelled = false;

        getFollowUpSummary({ search: searchTerm, filters: JSON.parse(scopeKey) })
            .then((result) => { if (!cancelled) setSummary(result); })
            .catch(() => { if (!cancelled) setSummary(null); });

        return () => { cancelled = true; };

    }, [searchTerm, scopeKey, summaryTick]);

    const columns = usePersistedColumns(
        "crm.columns.followups", ALL_FOLLOWUP_COLUMNS, DEFAULT_VISIBLE_FOLLOWUP_COLUMNS
    );

    const [activityTypes, setActivityTypes] = useState([]);
    const [employees, setEmployees] = useState([]);

    useEffect(() => {

        getAllActivityTypes().then(setActivityTypes).catch(() => {});
        getAllEmployees().then(setEmployees).catch(() => {});

    }, []);

    // Multi-select: any chosen value within a filter (OR), all filters (AND).
    const filterDefs = useMemo(() => {

        const defs = [
            {
                key: "activityTypeId", label: "Activity Type", type: "multiselect",
                options: activityTypes.map((a) => ({ value: a.id, label: a.name }))
            },
        ];

        // Open is a single status, so there is nothing to choose there.
        const statusOptions = statusOptionsForView(view, FOLLOWUP_STATUS_OPTIONS);

        if (statusOptions.length > 1) {
            defs.splice(1, 0, { key: "status", label: "Status", type: "multiselect", options: statusOptions });
        }

        if (employees.length > 0) {
            defs.push({
                key: "assignedEmployeeId", label: "Assigned Employee", type: "multiselect",
                options: employees.map((e) => ({ value: e.id, label: e.name }))
            });
        }

        defs.push({
            key: "scheduled", label: "Follow-up Date", type: "daterange",
            fromKey: "scheduledFrom", toKey: "scheduledTo"
        });

        return defs;

    }, [activityTypes, employees, view]);

    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [exporting, setExporting] = useState(false);

    async function handleBulkDelete() {

        if (!window.confirm(`Delete ${list.selectedIds.length} selected follow-up(s)?`)) {
            return;
        }

        setBulkDeleting(true);

        try {

            const result = await bulkDeleteFollowUps(list.selectedIds);

            if (result.skippedIds && result.skippedIds.length > 0) {
                alert(
                    `Deleted ${result.succeededIds.length}. Skipped ${result.skippedIds.length} ` +
                    "(not authorized or no longer exist) - they are still selected."
                );
            }

            // Deleted records leave the selection; skipped ones stay ticked.
            list.removeFromSelection(result.succeededIds || []);
            setSummaryTick((t) => t + 1);
            await list.reload();

        } catch (error) {

            console.error(error);
            alert("Unable to delete the selected follow-ups.");

        } finally {

            setBulkDeleting(false);

        }

    }

    async function handleExport(selectedOnly) {

        setExporting(true);

        try {

            const blob = await exportFollowUps({
                sort: list.sort,
                filters: { search: list.search || undefined, ...filtersForView(view, list.filters) },
                selection: selectedOnly ? list.selection : null,
            });

            downloadBlob(blob, "followups.xlsx");

            const notice = exportCountNotice(
                blob, selectedOnly ? list.selectedCount : list.totalElements, "follow-ups");

            if (notice) {
                alert(notice);
            }

        } catch (error) {

            console.error(error);
            alert(await exportErrorMessage(error, "follow-ups"));

        } finally {

            setExporting(false);

        }

    }

    // All of these come from the server (list total, summary counts), never from
    // the rows on the current page.
    const totalFollowUps = list.totalElements;
    const shown = (n) => (summary ? n : "-");

    const tabCounts = {
        open: summary?.pending,
        history: summary ? summary.completed + summary.missed + summary.cancelled : undefined,
        all: summary?.total,
    };

    return (

        <>

            <PageHeader
                title="Follow Ups"
                subtitle={`${list.totalElements} Follow Up(s) Found`}
                // No "Add Follow Up" here: follow-ups are scheduled from the
                // opportunity's (or lead's) own page, which links them to that
                // record. This page lists and manages existing follow-ups.
            />

            <div className="row mb-4">

                <div className="col-md-3">
                    <div className="card shadow-sm border-0">
                        <div className="card-body">
                            <small className="text-muted">{FOLLOWUP_VIEWS[view].label} Follow Ups</small>
                            <h3>{totalFollowUps}</h3>
                        </div>
                    </div>
                </div>

                <div className="col-md-3">
                    <div className="card shadow-sm border-0">
                        <div className="card-body">
                            <small className="text-muted">Pending</small>
                            <h3 className="text-warning">{shown(summary?.pending)}</h3>
                        </div>
                    </div>
                </div>

                <div className="col-md-3">
                    <div className="card shadow-sm border-0">
                        <div className="card-body">
                            <small className="text-muted">Completed</small>
                            <h3 className="text-success">{shown(summary?.completed)}</h3>
                        </div>
                    </div>
                </div>

                <div className="col-md-3">
                    <div className="card shadow-sm border-0">
                        <div className="card-body">
                            <small className="text-muted">Pending due today</small>
                            <h3>{shown(summary?.dueToday)}</h3>
                        </div>
                    </div>
                </div>

            </div>

            <ul className="nav nav-tabs mb-3" role="tablist" aria-label="Follow-up view">

                {FOLLOWUP_VIEW_KEYS.map((key) => (
                    <li className="nav-item" role="presentation" key={key}>
                        <button
                            type="button"
                            role="tab"
                            className={`nav-link${view === key ? " active" : ""}`}
                            aria-selected={view === key}
                            title={FOLLOWUP_VIEWS[key].hint}
                            onClick={() => changeView(key)}
                        >
                            {FOLLOWUP_VIEWS[key].label}
                            {tabCounts[key] !== undefined && (
                                <span className="badge text-bg-light border ms-2">{tabCounts[key]}</span>
                            )}
                        </button>
                    </li>
                ))}

            </ul>

            <div className="card shadow-sm border-0 mb-3">

                <div className="card-body">

                    <div className="d-flex flex-wrap gap-2 align-items-center">

                        <div className="flex-grow-1" style={{ minWidth: "240px" }}>

                            <div className="input-group">

                                <span className="input-group-text bg-white">
                                    <i className="bi bi-search"></i>
                                </span>

                                <input
                                    className="form-control border-start-0"
                                    placeholder="Search by lead, opportunity, employee, activity or remarks..."
                                    value={list.search}
                                    onChange={(e) => list.setSearch(e.target.value)}
                                />

                            </div>

                        </div>

                        <FilterPanel
                            filterDefs={filterDefs}
                            filters={list.filters}
                            onChange={list.setFilters}
                            onClear={list.clearFilters}
                        />

                        <ManageColumnsMenu
                            allColumns={columns.allColumns}
                            visibleKeys={columns.visibleKeys}
                            onToggle={columns.toggleColumn}
                            onReset={columns.resetColumns}
                        />

                        {isAdmin && (
                            <div className="dropdown">

                                <button
                                    className="btn btn-outline-secondary dropdown-toggle"
                                    type="button"
                                    data-bs-toggle="dropdown"
                                    disabled={exporting}
                                >
                                    <i className="bi bi-download me-2"></i>
                                    Export
                                </button>

                                <ul className="dropdown-menu dropdown-menu-end">
                                    <li>
                                        <button className="dropdown-item" onClick={() => handleExport(false)}>
                                            Export all matching
                                        </button>
                                    </li>
                                    <li>
                                        <button
                                            className="dropdown-item"
                                            disabled={list.selectedCount === 0}
                                            onClick={() => handleExport(true)}
                                        >
                                            Export selected ({list.selectedCount})
                                        </button>
                                    </li>
                                </ul>

                            </div>
                        )}

                    </div>

                </div>

            </div>

            {isAdmin && (
                <BulkActionBar
                    count={list.selectedCount}
                    onClear={list.clearSelection}
                    allMatching={list.allMatching}
                    excludedCount={list.excludedIds.length}
                    pageFullySelected={list.pageFullySelected}
                    pageRowCount={list.data.length}
                    totalElements={list.totalElements}
                    onSelectAllMatching={list.selectAllMatching}
                    pageSelectedCount={list.pageSelectedCount}
                    notice={list.selectionNotice}
                    onDismissNotice={list.dismissSelectionNotice}
                    actions={[
                        {
                            key: "export", label: "Export Selected", icon: "bi-download",
                            variant: "btn-outline-secondary", onClick: () => handleExport(true), disabled: exporting
                        },
                        {
                            key: "delete", label: "Delete", icon: "bi-trash",
                            variant: "btn-outline-danger", onClick: handleBulkDelete, disabled: bulkDeleting,
                            unavailableForAllMatching:
                                "Delete only works on records you tick individually, so nothing is deleted by accident."
                        },
                    ]}
                />
            )}

            <DataTable
                columns={columns.visibleColumns}
                data={list.data}
                loading={list.loading}
                selectable={isAdmin}
                selectedIds={list.selectedIds}
                isRowSelected={list.isSelected}
                onToggleSelect={list.toggleSelect}
                onToggleSelectAll={list.toggleSelectAll}
                sort={list.sort}
                onSortChange={list.toggleSort}
                onRowClick={(row) => navigate(`/followups/${row.id}`, { state: { from: location.pathname + location.search } })}
            />

            {!list.loading && list.data.length === 0 && (
                <div className="alert alert-light border text-center mt-3">
                    <i className="bi bi-search me-2"></i>
                    {view === "open"
                        ? "No pending follow ups. Completed, missed and cancelled ones are under History."
                        : "No matching follow ups found."}
                </div>
            )}

            <ListPagination
                page={list.page}
                pageSize={list.pageSize}
                totalPages={list.totalPages}
                totalElements={list.totalElements}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
            />

        </>

    );

}
