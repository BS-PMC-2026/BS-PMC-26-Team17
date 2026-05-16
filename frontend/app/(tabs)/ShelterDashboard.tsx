import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/auth";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Shelter = {
  id?: string;
  name: string;
  address: string;
  neighborhood: string;
  area: string;
  placeType: string;
  capacity: number;
  accessStatus: string;
  isAccessible: boolean;
  isFull: boolean;
  hasStairs: boolean;
  petIssueReported: boolean;
  cleanlinessStatus: string;
  shouldBeOpen: boolean;
  isActive: boolean;
  isVisibleOnMap: boolean;
  lastReportAt?: string;
  lastReportType?: string;
  city?: string;
};

type Report = {
  id?: string;
  shelterId?: string;
  reportCategory?: string;
  reportType?: string;
  description?: string;
  createdAt?: string;
  forwardedAt?: string;
  resolvedAt?: string;
  handledBy?: string;
  callbackNumber?: string;
  status?: string;
};

const ACCESS_LABELS: Record<string, string> = {
  open: "Open",
  closed: "Closed",
  locked: "Locked",
  unknown: "Unknown",
};
const ACCESS_COLORS: Record<string, string> = {
  open: "#1D9E75",
  closed: "#E24B4A",
  locked: "#888780",
  unknown: "#BA7517",
};
const CLEAN_LABELS: Record<string, string> = {
  clean: "Clean",
  dirty: "Dirty",
  unknown: "Unknown",
};
const CLEAN_COLORS: Record<string, string> = {
  clean: "#1D9E75",
  dirty: "#E24B4A",
  unknown: "#888780",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  forwarded: "Forwarded",
  done: "Done",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "#BA7517",
  forwarded: "#378ADD",
  done: "#1D9E75",
};
const TYPE_LABELS: Record<string, string> = {
  "public shelter": "Public Shelter",
  school: "School",
  parking: "Parking",
  other: "Other",
};
const REPORT_LABELS: Record<string, string> = {
  access: "Access",
  capacity: "Capacity",
  cleanliness: "Cleanliness",
  pet_issue: "Pets",
  damage: "Damage",
  other: "General",
};
const CITIES = ["All Cities", "Be'er Sheva"];
const AREAS = ["All Areas", "North", "South", "East", "West"];
const TYPES = ["All Types", "public shelter", "school", "parking", "other"];
const STATUSES = ["All Status", "open", "closed", "locked", "unknown"];
const STATUS_DROPDOWN_LABELS: Record<string, string> = {
  "All Status": "All Status",
  ...ACCESS_LABELS,
};
const CHIPS = [
  "All",
  "Inactive",
  "Pet Friendly 🐾",
  "Accessible ♿",
  "Recently Reported",
];

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function Badge({
  value,
  labels,
  colors,
}: {
  value: string;
  labels: Record<string, string>;
  colors: Record<string, string>;
}) {
  const c = colors[value] || "#888";
  return (
    <View
      style={[bd.wrap, { borderColor: c + "66", backgroundColor: c + "18" }]}
    >
      <View style={[bd.dot, { backgroundColor: c }]} />
      <Text style={[bd.txt, { color: c }]}>{labels[value] || value}</Text>
    </View>
  );
}
const bd = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 0.5,
    alignSelf: "center",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  txt: { fontSize: 12, fontWeight: "500" },
});

function Dropdown({
  label,
  value,
  options,
  onChange,
  labelMap,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  labelMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={dr.btn} onPress={() => setOpen(true)}>
        <Text style={dr.arrow}>▾</Text>
        <Text style={dr.val} numberOfLines={1}>
          {labelMap?.[value] ?? value}
        </Text>
      </TouchableOpacity>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={dr.overlay} onPress={() => setOpen(false)}>
          <View style={dr.menu}>
            <Text style={dr.menuTitle}>{label}</Text>
            {options.map((o) => (
              <TouchableOpacity
                key={o}
                style={dr.item}
                onPress={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                <Text style={[dr.itemTxt, value === o && dr.itemOn]}>
                  {labelMap?.[o] ?? o}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
const dr = StyleSheet.create({
  btn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#242424",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
  },
  val: { color: "#ddd", fontSize: 17, flex: 1, textAlign: "left" },
  arrow: { color: "#666", fontSize: 13, marginLeft: 6 },
  overlay: {
    flex: 1,
    backgroundColor: "#00000099",
    justifyContent: "center",
    padding: 32,
  },
  menu: {
    backgroundColor: "#242424",
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
    overflow: "hidden",
  },
  menuTitle: {
    color: "#666",
    fontSize: 12,
    textAlign: "left",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  item: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "#333",
  },
  itemTxt: { color: "#aaa", fontSize: 17, textAlign: "left" },
  itemOn: { color: "#fff", fontWeight: "500" },
});

const COLS = [
  { key: "name",             heb: "Shelter Name", width: 130 },
  { key: "address",          heb: "Address",      width: 130 },
  { key: "neighborhood",     heb: "Neighborhood", width: 110 },
  { key: "capacity",         heb: "Capacity",     width: 75  },
  { key: "shouldBeOpen",     heb: "Required",     width: 90  },
  { key: "accessStatus",     heb: "Status",       width: 100 },
  { key: "cleanliness",      heb: "Cleanliness",  width: 110 },
  { key: "isAccessible",     heb: "Accessible",   width: 90  },
  { key: "hasStairs",        heb: "Stairs",       width: 80  },
  { key: "petIssueReported", heb: "Pets",         width: 80  },
  { key: "lastReport",       heb: "Last Report",  width: 110 },
];
const TOTAL_W = COLS.reduce((sum, c) => sum + c.width, 0);

const ROW_H = 72;

function timeAgo(dateStr: string): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  return `${days} days ago`;
}

const CHIP_DEFAULT = { backgroundColor: "#2a2a2a", borderColor: "#444" };
const CHIP_ACTIVE = { backgroundColor: "#3d3d3d", borderColor: "#999" };

export default function ShelterDashboard() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("All Cities");
  const [area, setArea] = useState("All Areas");
  const [type, setType] = useState("All Types");
  const [status, setStatus] = useState("All Status");
  const [chips, setChips] = useState<string[]>([]);
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [selectedShelter, setSelectedShelter] = useState<Shelter | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [doneInputs, setDoneInputs] = useState<Record<string, { resolvedAt: string; handledBy: string }>>({});
  const [statusMenuOpen, setStatusMenuOpen] = useState<string | null>(null);

  type EditForm = {
    name: string;
    address: string;
    capacity: string;
    accessStatus: string;
    shouldBeOpen: boolean;
    cleanlinessStatus: string;
    isAccessible: boolean;
    hasStairs: boolean;
    petIssueReported: boolean;
  };
  const [editShelter, setEditShelter] = useState<Shelter | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const openEditModal = (shelter: Shelter) => {
    setEditShelter(shelter);
    setEditForm({
      name: shelter.name,
      address: shelter.address,
      capacity: String(shelter.capacity ?? ""),
      accessStatus: shelter.accessStatus || "unknown",
      shouldBeOpen: shelter.shouldBeOpen ?? true,
      cleanlinessStatus: shelter.cleanlinessStatus || "unknown",
      isAccessible: shelter.isAccessible ?? false,
      hasStairs: shelter.hasStairs ?? false,
      petIssueReported: shelter.petIssueReported ?? false,
    });
  };

  const handleSaveEdit = async () => {
    if (!editShelter?.id || !editForm || !user?.id) return;
    setEditSaving(true);
    try {
      const res = await fetch(`${API_URL}/shelters/${editShelter.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          name: editForm.name.trim(),
          address: editForm.address.trim(),
          capacity: parseInt(editForm.capacity) || 0,
          accessStatus: editForm.accessStatus,
          shouldBeOpen: editForm.shouldBeOpen,
          cleanlinessStatus: editForm.cleanlinessStatus,
          isAccessible: editForm.isAccessible,
          hasStairs: editForm.hasStairs,
          petIssueReported: editForm.petIssueReported,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        Alert.alert("Error", err.detail || "Failed to save changes");
        return;
      }
      setEditShelter(null);
      setEditForm(null);
      load();
    } catch {
      Alert.alert("Error", "Failed to connect to server");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = (shelter: Shelter) => {
    Alert.alert("Delete", `Delete ${shelter.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(
              `${API_URL}/shelters/${shelter.id}?user_id=${user?.id}`,
              { method: "DELETE" },
            );
            if (!res.ok) {
              const err = await res.json();
              Alert.alert("Error", err.detail || "Failed to delete");
              return;
            }
            load();
          } catch {
            Alert.alert("Error", "Failed to connect to server");
          }
        },
      },
    ]);
  };

  const load = async () => {
    try {
      setLoading(true);
      const p = new URLSearchParams();
      if (city !== "All Cities") p.append("city", city);
      if (area !== "All Areas") p.append("area", area);
      if (type !== "All Types") p.append("place_type", type);
      if (status !== "All Status") p.append("status", status);
      const sheltersRes = await fetch(`${API_URL}/shelters?${p}`);
      const sheltersData = await sheltersRes.json();
      setShelters(sheltersData.shelters || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // Fetch reports in background after table is visible
    fetch(`${API_URL}/reports`)
      .then((r) => r.json())
      .then((d) => setAllReports(d.reports || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [city, area, type, status]);

  const openShelterDetail = (shelter: Shelter) => {
    setSelectedShelter(shelter);
    setActiveTab("active");
    setDoneInputs({});
  };

  const updateReportStatus = async (
    reportId: string,
    status: string,
    extra?: { resolvedAt?: string; handledBy?: string },
  ) => {
    if (!user?.id) return;
    const body: Record<string, string> = { user_id: user.id, status };
    if (extra?.resolvedAt) body.resolvedAt = extra.resolvedAt;
    if (extra?.handledBy) body.handledBy = extra.handledBy;
    if (status === "forwarded") body.forwardedAt = new Date().toISOString();
    try {
      const res = await fetch(`${API_URL}/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        Alert.alert("Error", err.detail || "Failed to update report");
        return;
      }
      setAllReports((prev) =>
        prev.map((r) => {
          if (r.id !== reportId) return r;
          return {
            ...r,
            status,
            ...(extra?.resolvedAt ? { resolvedAt: extra.resolvedAt } : {}),
            ...(extra?.handledBy  ? { handledBy:  extra.handledBy  } : {}),
            ...(status === "forwarded" ? { forwardedAt: body.forwardedAt } : {}),
          };
        })
      );
      setDoneInputs((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
    } catch {
      Alert.alert("Error", "Failed to connect to server");
    }
  };

  const reportCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allReports.forEach((r) => {
      if (r.shelterId && r.status !== "done") {
        counts[r.shelterId] = (counts[r.shelterId] || 0) + 1;
      }
    });
    return counts;
  }, [allReports]);

  const shelterOverrides = useMemo(() => {
    const accessCnt: Record<string, number> = {};
    const petCnt:    Record<string, number> = {};
    const cleanCnt:  Record<string, number> = {};
    allReports.forEach((r) => {
      if (!r.shelterId || r.status === "done") return;
      if (r.reportCategory === "access")      accessCnt[r.shelterId] = (accessCnt[r.shelterId] || 0) + 1;
      if (r.reportCategory === "pet_issue")   petCnt[r.shelterId]    = (petCnt[r.shelterId]    || 0) + 1;
      if (r.reportCategory === "cleanliness") cleanCnt[r.shelterId]  = (cleanCnt[r.shelterId]  || 0) + 1;
    });
    const result: Record<string, { accessStatus?: string; petIssueReported?: boolean; cleanlinessStatus?: string }> = {};
    const ids = new Set([...Object.keys(accessCnt), ...Object.keys(petCnt), ...Object.keys(cleanCnt)]);
    ids.forEach((id) => {
      result[id] = {
        ...(accessCnt[id] >= 1 ? { accessStatus: "locked" }     : {}),
        ...(petCnt[id]    >= 1 ? { petIssueReported: true }     : {}),
        ...(cleanCnt[id]  >= 2 ? { cleanlinessStatus: "dirty" } : {}),
      };
    });
    return result;
  }, [allReports]);

  const lastReportByShelterId = useMemo(() => {
    const latest: Record<string, string> = {};
    allReports.forEach((r) => {
      if (!r.shelterId || !r.createdAt) return;
      const prev = latest[r.shelterId];
      if (!prev || new Date(r.createdAt) > new Date(prev)) {
        latest[r.shelterId] = r.createdAt;
      }
    });
    return latest;
  }, [allReports]);

  const filtered = useMemo(() => {
    let list = shelters;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.address?.toLowerCase().includes(q) ||
          s.neighborhood?.toLowerCase().includes(q),
      );
    }
    if (status !== "All Status")
      list = list.filter((s) => {
        const ov = shelterOverrides[s.id || ""] || {};
        return (ov.accessStatus ?? s.accessStatus ?? "unknown") === status;
      });
    if (chips.includes("Inactive"))
      list = list.filter((s) => !s.isActive);
    if (chips.includes("Pet Friendly 🐾"))
      list = list.filter((s) => {
        const hasPetIssue = shelterOverrides[s.id || ""]?.petIssueReported ?? s.petIssueReported;
        return !hasPetIssue;
      });
    if (chips.includes("Accessible ♿"))
      list = list.filter((s) => s.isAccessible && !s.hasStairs);
    if (chips.includes("Recently Reported"))
      list = list.filter((s) => !!lastReportByShelterId[s.id || ""]);
    return list;
  }, [shelters, search, chips, status, shelterOverrides, lastReportByShelterId]);

  const totalCount = filtered.filter((s) => s.isVisibleOnMap).length;
  const openCount = filtered.filter(
    (s) =>
      s.isActive &&
      s.shouldBeOpen &&
      (s.accessStatus === "open" || s.accessStatus === "unknown"),
  ).length;
  const fullCount = filtered.filter((s) => s.isActive && s.isFull).length;
  const closedCount = filtered.filter(
    (s) =>
      (s.isActive && s.shouldBeOpen && s.accessStatus === "locked") ||
      !s.shouldBeOpen,
  ).length;

  const shelterReports = useMemo(
    () => allReports.filter((r) => r.shelterId === selectedShelter?.id),
    [allReports, selectedShelter],
  );

  const activeReports = shelterReports.filter((r) => r.status !== "done" && !r.resolvedAt);
  const historyReports = shelterReports.filter((r) => r.status === "done" && !!r.resolvedAt);
  const tabReports = activeTab === "active" ? activeReports : historyReports;

  return (
    <View style={[s.container, { paddingTop: Math.max(0, insets.top - 10) }]}>
      {/* Status cards */}
      <View style={s.statsRow}>
        {[
          { label: "Closed",         value: closedCount, color: "#E24B4A", main: false },
          { label: "Full",           value: fullCount,   color: "#BA7517", main: false },
          { label: "Available",      value: openCount,   color: "#1D9E75", main: false },
          { label: "Total Shelters", value: totalCount,  color: "#fff",    main: true  },
        ].map((c) => (
          <View key={c.label} style={[s.statCard, c.main && s.statMain]}>
            <Text style={s.statLabel}>{c.label}</Text>
            <Text style={[s.statValue, { color: c.color }]}>{c.value}</Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.searchInput}
          placeholder="Search by name, address or neighborhood..."
          placeholderTextColor="#666"
          value={search}
          onChangeText={setSearch}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch("")} style={s.clearBtn}>
            <Text style={s.clearTxt}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Dropdowns */}
      <View style={s.dropRow}>
        <Dropdown label="City"       value={city}   options={CITIES}    onChange={setCity} />
        <View style={{ width: 10 }} />
        <Dropdown label="Area"       value={area}   options={AREAS}     onChange={setArea} />
        <View style={{ width: 10 }} />
        <Dropdown label="Status"     value={status} options={STATUSES}  onChange={setStatus} labelMap={STATUS_DROPDOWN_LABELS} />
      </View>

      {/* Chips */}
      <View style={s.chipsRow}>
        {CHIPS.map((c) => {
          const isAll = c === "All";
          const isOn = isAll ? chips.length === 0 : chips.includes(c);
          return (
            <TouchableOpacity
              key={c}
              style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, borderWidth: 0.5, ...(isOn ? CHIP_ACTIVE : CHIP_DEFAULT) }}
              onPress={() => {
                if (isAll) {
                  setChips([]);
                } else {
                  setChips((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                  );
                }
              }}
            >
              <Text style={{ fontSize: 16, color: isOn ? "#ffffff" : "#aaaaaa" }}>{c}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Table */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#378ADD" />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
          <View style={{ width: TOTAL_W + (isAdmin ? 90 : 0) }}>
            {/* Header row */}
            <View style={[s.headerRow, { width: TOTAL_W + (isAdmin ? 90 : 0) }]}>
              {COLS.map((c) => (
                <Text key={c.key} style={[s.headerCell, { width: c.width }]}>
                  {c.heb}
                </Text>
              ))}
              {isAdmin && <View style={{ width: 90 }} />}
            </View>
            {/* Data rows */}
            <ScrollView style={{ height: ROW_H * 6 }} nestedScrollEnabled>
              {filtered.length === 0 ? (
                <Text style={s.empty}>No shelters found</Text>
              ) : (
                filtered.map((item, i) => (
                  <View
                    key={i}
                    style={[
                      s.row,
                      i % 2 === 0 && s.rowAlt,
                      { minHeight: ROW_H, width: TOTAL_W + (isAdmin ? 90 : 0), borderLeftWidth: 3, borderLeftColor: "#BA7517" },
                    ]}
                  >
                    {/* Clickable area — all cells except delete */}
                    <TouchableOpacity
                      style={{ flexDirection: "row", flex: 1, alignItems: "center" }}
                      onPress={() => openShelterDetail(item)}
                      activeOpacity={0.7}
                    >
                      {/* Name */}
                      <View style={[s.cellV, { width: COLS[0].width, alignItems: "flex-start" }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 6 }}>
                          <Text style={[s.bold, { color: "#fff" }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          {(reportCounts[item.id || ""] || 0) > 0 && (() => {
                            const cnt = reportCounts[item.id || ""];
                            return (
                              <View style={{ backgroundColor: "#BA7517", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 }}>
                                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                                  {cnt} {cnt === 1 ? "report" : "reports"}
                                </Text>
                              </View>
                            );
                          })()}
                        </View>
                        <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 8, marginTop: 2 }}>
                          {item.isAccessible && !item.hasStairs && <Text style={{ fontSize: 14 }}>♿</Text>}
                          {!item.petIssueReported && <Text style={{ fontSize: 14 }}>🐾</Text>}
                        </View>
                      </View>

                      {/* Address */}
                      <Text style={[s.cell, { width: COLS[1].width }]} numberOfLines={1}>
                        {item.address}
                      </Text>

                      {/* Neighborhood */}
                      <View style={[s.cellV, { width: COLS[2].width }]}>
                        <Text style={s.cell} numberOfLines={1}>
                          {item.neighborhood || "—"}
                        </Text>
                      </View>

                      {/* Capacity */}
                      <Text style={[s.cell, s.center, { width: COLS[3].width }]}>
                        {item.capacity}
                      </Text>

                      {/* Should be open */}
                      <View style={[s.cellV, { width: COLS[4].width }]}>
                        <Text style={{ fontSize: 20, textAlign: "center", color: item.shouldBeOpen ? "#1D9E75" : "#E24B4A" }}>
                          {item.shouldBeOpen ? "✓" : "✗"}
                        </Text>
                      </View>

                      {/* Access status */}
                      {(() => {
                        const ov = shelterOverrides[item.id || ""] || {};
                        const val = ov.accessStatus ?? item.accessStatus ?? "unknown";
                        return (
                          <View style={[s.cellV, { width: COLS[5].width }]}>
                            <Badge value={val} labels={ACCESS_LABELS} colors={ACCESS_COLORS} />
                          </View>
                        );
                      })()}

                      {/* Cleanliness */}
                      {(() => {
                        const ov = shelterOverrides[item.id || ""] || {};
                        const val = ov.cleanlinessStatus ?? item.cleanlinessStatus ?? "unknown";
                        return (
                          <View style={[s.cellV, { width: COLS[6].width }]}>
                            <Badge value={val} labels={CLEAN_LABELS} colors={CLEAN_COLORS} />
                          </View>
                        );
                      })()}

                      {/* Accessible */}
                      <View style={[s.cellV, { width: COLS[7].width }]}>
                        <Text style={{ fontSize: 20, textAlign: "center", color: item.isAccessible ? "#1D9E75" : "#E24B4A" }}>
                          {item.isAccessible ? "✓" : "✗"}
                        </Text>
                      </View>

                      {/* Stairs */}
                      <View style={[s.cellV, { width: COLS[8].width }]}>
                        <Text style={{ fontSize: 20, textAlign: "center", color: item.hasStairs ? "#E24B4A" : "#1D9E75" }}>
                          {item.hasStairs ? "✓" : "✗"}
                        </Text>
                      </View>

                      {/* Pets */}
                      {(() => {
                        const ov = shelterOverrides[item.id || ""] || {};
                        const hasPetIssue = ov.petIssueReported ?? item.petIssueReported;
                        return (
                          <View style={[s.cellV, { width: COLS[9].width }]}>
                            <Text style={{ fontSize: 20, textAlign: "center", color: hasPetIssue ? "#E24B4A" : "#1D9E75" }}>
                              {hasPetIssue ? "✗" : "✓"}
                            </Text>
                          </View>
                        );
                      })()}

                      {/* Last report */}
                      <View style={[s.cellV, { width: COLS[10].width }]}>
                        <Text style={[s.cell, { color: "#777", fontSize: 15 }]} numberOfLines={1}>
                          {timeAgo(lastReportByShelterId[item.id || ""] || "")}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Admin action buttons */}
                    {isAdmin && (
                      <>
                        <TouchableOpacity style={s.editBtn} onPress={() => openEditModal(item)}>
                          <Text style={s.editBtnTxt}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(item)}>
                          <Text style={s.delTxt}>🗑</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Bottom count */}
      <Text style={s.countLabel}>Showing {filtered.length} shelters</Text>

      {/* Edit Shelter Modal */}
      <Modal
        visible={!!editShelter}
        animationType="slide"
        onRequestClose={() => { setEditShelter(null); setEditForm(null); }}
      >
        <ScrollView
          style={[ed.container, { paddingTop: insets.top }]}
          contentContainerStyle={ed.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={ed.header}>
            <Text style={ed.title} numberOfLines={1}>
              Edit Shelter — {editShelter?.name}
            </Text>
            <TouchableOpacity style={md.closeBtn} onPress={() => { setEditShelter(null); setEditForm(null); }}>
              <Text style={md.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {editForm && (
            <>
              {/* Name */}
              <Text style={ed.label}>Shelter Name</Text>
              <TextInput
                style={ed.input}
                value={editForm.name}
                onChangeText={(t) => setEditForm((f) => f && { ...f, name: t })}
                placeholder="Shelter name"
                placeholderTextColor="#555"
              />

              {/* Address */}
              <Text style={ed.label}>Address</Text>
              <TextInput
                style={ed.input}
                value={editForm.address}
                onChangeText={(t) => setEditForm((f) => f && { ...f, address: t })}
                placeholder="Street and number"
                placeholderTextColor="#555"
              />

              {/* Capacity */}
              <Text style={ed.label}>Capacity</Text>
              <TextInput
                style={ed.input}
                value={editForm.capacity}
                onChangeText={(t) => setEditForm((f) => f && { ...f, capacity: t })}
                placeholder="Number of people"
                placeholderTextColor="#555"
                keyboardType="numeric"
              />

              {/* Access Status */}
              <Text style={ed.label}>Access Status</Text>
              <View style={ed.optRow}>
                {(["open", "closed", "locked", "unknown"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[ed.opt, editForm.accessStatus === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, accessStatus: v })}
                  >
                    <Text style={[ed.optTxt, editForm.accessStatus === v && ed.optTxtOn]}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Should Be Open */}
              <Text style={ed.label}>Should Be Open</Text>
              <View style={ed.optRow}>
                {([true, false] as const).map((v) => (
                  <TouchableOpacity
                    key={String(v)}
                    style={[ed.opt, editForm.shouldBeOpen === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, shouldBeOpen: v })}
                  >
                    <Text style={[ed.optTxt, editForm.shouldBeOpen === v && ed.optTxtOn]}>{v ? "Yes" : "No"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Cleanliness */}
              <Text style={ed.label}>Cleanliness Status</Text>
              <View style={ed.optRow}>
                {(["clean", "dirty", "unknown"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[ed.opt, editForm.cleanlinessStatus === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, cleanlinessStatus: v })}
                  >
                    <Text style={[ed.optTxt, editForm.cleanlinessStatus === v && ed.optTxtOn]}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Accessible */}
              <Text style={ed.label}>Wheelchair Accessible</Text>
              <View style={ed.optRow}>
                {([true, false] as const).map((v) => (
                  <TouchableOpacity
                    key={String(v)}
                    style={[ed.opt, editForm.isAccessible === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, isAccessible: v })}
                  >
                    <Text style={[ed.optTxt, editForm.isAccessible === v && ed.optTxtOn]}>{v ? "Yes" : "No"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Has Stairs */}
              <Text style={ed.label}>Has Stairs</Text>
              <View style={ed.optRow}>
                {([true, false] as const).map((v) => (
                  <TouchableOpacity
                    key={String(v)}
                    style={[ed.opt, editForm.hasStairs === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, hasStairs: v })}
                  >
                    <Text style={[ed.optTxt, editForm.hasStairs === v && ed.optTxtOn]}>{v ? "Yes" : "No"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Pet Issue */}
              <Text style={ed.label}>Pet Issue</Text>
              <View style={ed.optRow}>
                {([false, true] as const).map((v) => (
                  <TouchableOpacity
                    key={String(v)}
                    style={[ed.opt, editForm.petIssueReported === v && ed.optOn]}
                    onPress={() => setEditForm((f) => f && { ...f, petIssueReported: v })}
                  >
                    <Text style={[ed.optTxt, editForm.petIssueReported === v && ed.optTxtOn]}>
                      {v ? "Issue reported" : "No issue"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Buttons */}
              <View style={ed.btnRow}>
                <TouchableOpacity
                  style={[ed.saveBtn, editSaving && { opacity: 0.6 }]}
                  onPress={handleSaveEdit}
                  disabled={editSaving}
                >
                  <Text style={ed.saveBtnTxt}>{editSaving ? "Saving…" : "Save"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={ed.cancelBtn}
                  onPress={() => { setEditShelter(null); setEditForm(null); }}
                  disabled={editSaving}
                >
                  <Text style={ed.cancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </Modal>

      {/* Shelter Detail Modal */}
      <Modal
        visible={!!selectedShelter}
        animationType="slide"
        onRequestClose={() => setSelectedShelter(null)}
      >
        <View style={[md.container, { paddingTop: insets.top }]}>
          {/* Header */}
          <View style={md.header}>
            <View style={{ flex: 1 }}>
              <Text style={md.shelterName} numberOfLines={1}>{selectedShelter?.name}</Text>
              <Text style={md.shelterAddress} numberOfLines={1}>{selectedShelter?.address}</Text>
              <View style={{ flexDirection: "row", gap: 12, marginTop: 8, alignItems: "center" }}>
                <Text style={md.metaText}>Capacity: {selectedShelter?.capacity}</Text>
                {selectedShelter?.accessStatus && (
                  <Badge
                    value={selectedShelter.accessStatus}
                    labels={ACCESS_LABELS}
                    colors={ACCESS_COLORS}
                  />
                )}
              </View>
            </View>
            <TouchableOpacity style={md.closeBtn} onPress={() => setSelectedShelter(null)}>
              <Text style={md.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={md.tabRow}>
            <TouchableOpacity
              style={[md.tab, activeTab === "active" && md.tabOn]}
              onPress={() => setActiveTab("active")}
            >
              <Text style={[md.tabTxt, activeTab === "active" && md.tabTxtOn]}>
                Active ({activeReports.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[md.tab, activeTab === "history" && md.tabOn]}
              onPress={() => setActiveTab("history")}
            >
              <Text style={[md.tabTxt, activeTab === "history" && md.tabTxtOn]}>
                History ({historyReports.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Reports list */}
          {tabReports.length === 0 ? (
            <Text style={md.empty}>No reports</Text>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={md.reportsList}>
              {tabReports.map((report) => {
                const rid = report.id || "";
                const isDoneMode = !!doneInputs[rid];
                return (
                  <View key={rid} style={md.reportCard}>
                    {/* Category · Type + status badge */}
                    <View style={md.reportHeader}>
                      <Text style={md.reportType}>
                        {report.reportCategory || "—"} · {report.reportType || "—"}
                      </Text>
                      {report.status && (
                        <Badge
                          value={report.status}
                          labels={STATUS_LABELS}
                          colors={STATUS_COLORS}
                        />
                      )}
                    </View>

                    {/* Description */}
                    {!!report.description && (
                      <Text style={md.reportDesc}>{report.description}</Text>
                    )}

                    {/* Phone */}
                    {!!report.callbackNumber && (
                      <Text style={md.metaLine}>📞 {report.callbackNumber}</Text>
                    )}

                    {/* Handled by */}
                    {!!report.handledBy && (
                      <Text style={md.metaLine}>👤 {report.handledBy}</Text>
                    )}

                    {/* Timestamps */}
                    <View style={md.timestamps}>
                      <Text style={md.timeLabel}>Created: {formatDate(report.createdAt)}</Text>
                      {!!report.forwardedAt && (
                        <Text style={md.timeLabel}>Forwarded: {formatDate(report.forwardedAt)}</Text>
                      )}
                      {!!report.resolvedAt && (
                        <Text style={md.timeLabel}>Resolved: {formatDate(report.resolvedAt)}</Text>
                      )}
                    </View>

                    {/* Status update — admin + active tab + not done */}
                    {isAdmin && activeTab === "active" && report.status !== "done" && (
                      <View style={{ marginTop: 12 }}>
                        {/* Update Status button */}
                        {statusMenuOpen !== rid && !isDoneMode && (
                          <TouchableOpacity
                            style={md.updateBtn}
                            onPress={() => setStatusMenuOpen(rid)}
                          >
                            <Text style={md.updateBtnTxt}>Update Status ▾</Text>
                          </TouchableOpacity>
                        )}

                        {/* Forward-only menu */}
                        {statusMenuOpen === rid && !isDoneMode && (
                          <View style={md.statusBtnRow}>
                            {report.status === "pending" && (
                              <TouchableOpacity
                                style={[md.statusBtn, { borderColor: STATUS_COLORS.forwarded }]}
                                onPress={() => {
                                  updateReportStatus(rid, "forwarded");
                                  setStatusMenuOpen(null);
                                }}
                              >
                                <Text style={[md.statusBtnTxt, { color: STATUS_COLORS.forwarded }]}>Forwarded</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={[md.statusBtn, { borderColor: STATUS_COLORS.done }]}
                              onPress={() => {
                                setDoneInputs((prev) => ({ ...prev, [rid]: { resolvedAt: "", handledBy: "" } }));
                                setStatusMenuOpen(null);
                              }}
                            >
                              <Text style={[md.statusBtnTxt, { color: STATUS_COLORS.done }]}>Done</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[md.statusBtn, { borderColor: "#444" }]}
                              onPress={() => setStatusMenuOpen(null)}
                            >
                              <Text style={[md.statusBtnTxt, { color: "#777" }]}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Done inputs */}
                        {isDoneMode && (
                          <View style={{ gap: 8 }}>
                            <TextInput
                              style={md.doneInput}
                              placeholder="Resolved at (e.g. 2025-05-01 14:00)"
                              placeholderTextColor="#555"
                              value={doneInputs[rid]?.resolvedAt || ""}
                              onChangeText={(t) =>
                                setDoneInputs((prev) => ({ ...prev, [rid]: { ...prev[rid], resolvedAt: t } }))
                              }
                            />
                            <TextInput
                              style={md.doneInput}
                              placeholder="Handled by (name)"
                              placeholderTextColor="#555"
                              value={doneInputs[rid]?.handledBy || ""}
                              onChangeText={(t) =>
                                setDoneInputs((prev) => ({ ...prev, [rid]: { ...prev[rid], handledBy: t } }))
                              }
                            />
                            <View style={md.statusBtnRow}>
                              <TouchableOpacity
                                style={[md.statusBtn, { flex: 1, borderColor: STATUS_COLORS.done }]}
                                onPress={() => updateReportStatus(rid, "done", doneInputs[rid])}
                              >
                                <Text style={[md.statusBtnTxt, { color: STATUS_COLORS.done }]}>Confirm Done</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[md.statusBtn, { borderColor: "#444" }]}
                                onPress={() =>
                                  setDoneInputs((prev) => { const n = { ...prev }; delete n[rid]; return n; })
                                }
                              >
                                <Text style={[md.statusBtnTxt, { color: "#777" }]}>Cancel</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#181818",
    padding: 14,
    paddingTop: 1,
  },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 18, marginTop: -8 },
  statCard: {
    flex: 1,
    height: 100,
    backgroundColor: "#242424",
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 14,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    borderWidth: 0.5,
    borderColor: "#333",
  },
  statMain: { flex: 1.3, borderColor: "#444" },
  statLabel: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    height: 32,
  },
  statValue: { fontSize: 28, fontWeight: "500" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#242424",
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: "#333",
    height: 56,
  },
  searchIcon: { fontSize: 18, marginLeft: 10 },
  searchInput: { flex: 1, color: "#fff", fontSize: 16, textAlign: "left" },
  clearBtn: { padding: 8 },
  clearTxt: { color: "#666", fontSize: 16 },
  dropRow: { flexDirection: "row", marginBottom: 12 },
  chipsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#242424",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 0.5,
    borderColor: "#333",
    paddingVertical: 12,
    justifyContent: "flex-start",
  },
  headerCell: {
    fontSize: 13,
    color: "#888",
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: "#222",
    backgroundColor: "#1c1c1c",
    alignItems: "center",
  },
  rowAlt: { backgroundColor: "#1f1f1f" },
  cell: {
    fontSize: 13,
    color: "#ccc",
    paddingHorizontal: 4,
    textAlign: "center",
  },
  bold: { color: "#fff", fontWeight: "500", fontSize: 14 },
  center: { textAlign: "center" },
  cellV: {
    paddingHorizontal: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  icon: { fontSize: 20 },
  empty: { color: "#666", textAlign: "center", padding: 40, fontSize: 16 },
  countLabel: { fontSize: 13, color: "#555", textAlign: "left", marginTop: 12 },
  editBtn: { width: 40, alignItems: "center", justifyContent: "center" },
  editBtnTxt: { fontSize: 16 },
  delBtn: { width: 50, alignItems: "center", justifyContent: "center" },
  delTxt: { fontSize: 18 },
});

const md = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#181818" },
  header: {
    flexDirection: "row",
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: "#333",
    alignItems: "flex-start",
  },
  shelterName: { fontSize: 20, fontWeight: "700", color: "#fff" },
  shelterAddress: { fontSize: 14, color: "#888", marginTop: 2 },
  metaText: { fontSize: 13, color: "#aaa" },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  closeTxt: { color: "#aaa", fontSize: 16 },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#2a2a2a",
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "#333",
    backgroundColor: "#242424",
  },
  tabOn: { borderColor: "#BA7517", backgroundColor: "#BA751722" },
  tabTxt: { color: "#888", fontSize: 15, fontWeight: "500" },
  tabTxtOn: { color: "#BA7517" },
  empty: { color: "#666", textAlign: "center", padding: 40, fontSize: 16 },
  reportsList: { padding: 16, gap: 14 },
  reportCard: {
    backgroundColor: "#242424",
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: "#333",
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  reportType: { fontSize: 14, fontWeight: "600", color: "#ddd", flex: 1 },
  reportDesc: { fontSize: 14, color: "#aaa", marginBottom: 8, lineHeight: 20 },
  metaLine: { fontSize: 13, color: "#888", marginTop: 4 },
  timestamps: { marginTop: 8, gap: 2 },
  timeLabel: { fontSize: 12, color: "#555" },
  updateBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: "#555",
    backgroundColor: "#2a2a2a",
  },
  updateBtnTxt: { color: "#ccc", fontSize: 13, fontWeight: "600" },
  statusBtnRow: { flexDirection: "row", gap: 8 },
  statusBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: "center",
    justifyContent: "center",
  },
  statusBtnTxt: { fontSize: 13, fontWeight: "600" },
  doneInput: {
    backgroundColor: "#1c1c1c",
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
    borderRadius: 8,
    padding: 10,
    color: "#fff",
    fontSize: 14,
  },
});

const ed = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#181818" },
  content: { padding: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: { fontSize: 18, fontWeight: "700", color: "#fff", flex: 1, marginRight: 12 },
  label: { fontSize: 13, color: "#888", marginBottom: 8, marginTop: 18 },
  input: {
    backgroundColor: "#242424",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
  },
  optRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
    backgroundColor: "#242424",
  },
  optOn: { borderColor: "#1D9E75", backgroundColor: "#1D9E7522" },
  optTxt: { fontSize: 14, color: "#888" },
  optTxtOn: { color: "#1D9E75", fontWeight: "600" },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 32 },
  saveBtn: {
    flex: 1,
    backgroundColor: "#1D9E75",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: "#444",
  },
  cancelBtnTxt: { color: "#aaa", fontSize: 16, fontWeight: "600" },
});
