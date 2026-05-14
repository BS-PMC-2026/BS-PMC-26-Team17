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
  lastReportAt?: string;
  lastReportType?: string;
  city?: string;
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
const CHIPS = [
  "Recently Reported",
  "Full",
  "Pet Friendly 🐾",
  "Accessible ♿",
  "All",
];

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
  { key: "lastReport", heb: "Last Report", width: 110 },
  { key: "reportType", heb: "Report Type", width: 100 },
  { key: "cleanliness", heb: "Cleanliness", width: 110 },
  { key: "accessStatus", heb: "Status", width: 100 },
  { key: "isFull", heb: "Occupancy", width: 90 },
  { key: "shouldBeOpen", heb: "Required", width: 90 },
  { key: "capacity", heb: "Capacity", width: 75 },
  { key: "neighborhood", heb: "Neighborhood", width: 110 },
  { key: "address", heb: "Address", width: 160 },
  { key: "name", heb: "Shelter Name", width: 170 },
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
  const [chip, setChip] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [newShelter, setNewShelter] = useState({
    name: "",
    address: "",
    neighborhood: "",
    area: "",
    capacity: "",
  });

  const handleAdd = async () => {
    if (!newShelter.name || !newShelter.address) {
      Alert.alert("Error", "Name and address are required");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/shelters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user?.id,
          name: newShelter.name,
          address: newShelter.address,
          neighborhood: newShelter.neighborhood,
          area: newShelter.area,
          capacity: parseInt(newShelter.capacity) || 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        Alert.alert("Error", err.detail || "Failed to add shelter");
        return;
      }
      Alert.alert("Added", "Shelter added successfully");
      setShowAdd(false);
      setNewShelter({
        name: "",
        address: "",
        neighborhood: "",
        area: "",
        capacity: "",
      });
      load();
    } catch {
      Alert.alert("Error", "Failed to connect to server");
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
      const res = await fetch(`${API_URL}/shelters?${p}`);
      const data = await res.json();
      setShelters(data.shelters || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [city, area, type]);

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
    if (chip === "Accessible ♿")
      list = list.filter((s) => s.isAccessible && !s.hasStairs);
    if (chip === "Pet Friendly 🐾")
      list = list.filter((s) => !s.petIssueReported);
    if (chip === "Full") list = list.filter((s) => s.isFull);
    if (chip === "Recently Reported")
      list = list.filter((s) => !!s.lastReportAt);
    return list;
  }, [shelters, search, chip]);

  const openCount = filtered.filter((s) => s.accessStatus === "open").length;
  const fullCount = filtered.filter((s) => s.isFull).length;
  const closedCount = filtered.filter(
    (s) => s.accessStatus === "closed" || s.accessStatus === "locked",
  ).length;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Status cards — total on right, closed on left */}
      <View style={s.statsRow}>
        {[
          {
            label: "Closed / Locked",
            value: closedCount,
            color: "#E24B4A",
            main: false,
          },
          {
            label: "Busy / Full",
            value: fullCount,
            color: "#BA7517",
            main: false,
          },
          {
            label: "Available",
            value: openCount,
            color: "#1D9E75",
            main: false,
          },
          {
            label: "Total Shelters",
            value: filtered.length,
            color: "#fff",
            main: true,
          },
        ].map((c) => (
          <View key={c.label} style={[s.statCard, c.main && s.statMain]}>
            <Text style={s.statLabel}>{c.label}</Text>
            <Text style={[s.statValue, { color: c.color }]}>{c.value}</Text>
          </View>
        ))}
      </View>

      {/* Admin add button */}
      {isAdmin && (
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={s.addBtnTxt}>+ Add Shelter</Text>
        </TouchableOpacity>
      )}

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

      {/* Dropdowns — Type | Area | City */}
      <View style={s.dropRow}>
        <Dropdown
          label="Place Type"
          value={type}
          options={TYPES}
          onChange={setType}
          labelMap={TYPE_LABELS}
        />
        <View style={{ width: 10 }} />
        <Dropdown
          label="Area"
          value={area}
          options={AREAS}
          onChange={setArea}
        />
        <View style={{ width: 10 }} />
        <Dropdown
          label="City"
          value={city}
          options={CITIES}
          onChange={setCity}
        />
      </View>

      {/* Chips — sit below dropdowns */}
      <View style={s.chipsRow}>
        {CHIPS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[s.chip, chip === c && s.chipOn]}
            onPress={() => setChip(c)}
          >
            <Text style={[s.chipTxt, chip === c && s.chipTxtOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Table */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#378ADD" />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={{ flex: 1 }}
        >
          <View style={{ width: TOTAL_W + (isAdmin ? 50 : 0) }}>
            {/* Headers */}
            <View
              style={[s.headerRow, { width: TOTAL_W + (isAdmin ? 50 : 0) }]}
            >
              {isAdmin && <View style={{ width: 50 }} />}
              {COLS.map((c) => (
                <Text key={c.key} style={[s.headerCell, { width: c.width }]}>
                  {c.heb}
                </Text>
              ))}
            </View>
            {/* Rows */}
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
                      { minHeight: ROW_H, width: TOTAL_W + (isAdmin ? 50 : 0) },
                    ]}
                  >
                    {/* Admin delete button */}
                    {isAdmin && (
                      <TouchableOpacity
                        style={s.delBtn}
                        onPress={() => handleDelete(item)}
                      >
                        <Text style={s.delTxt}>🗑</Text>
                      </TouchableOpacity>
                    )}

                    {/* Last report */}
                    <View style={[s.cellV, { width: COLS[0].width }]}>
                      <Text
                        style={[s.cell, { color: "#777", fontSize: 15 }]}
                        numberOfLines={1}
                      >
                        {timeAgo(item.lastReportAt || "")}
                      </Text>
                    </View>

                    {/* Report type */}
                    <View style={[s.cellV, { width: COLS[1].width }]}>
                      <Text style={[s.cell, { color: "#666", fontSize: 15 }]}>
                        {item.lastReportType
                          ? REPORT_LABELS[item.lastReportType] ||
                            item.lastReportType
                          : "—"}
                      </Text>
                    </View>

                    {/* Cleanliness status */}
                    <View style={[s.cellV, { width: COLS[2].width }]}>
                      <Badge
                        value={item.cleanlinessStatus || "unknown"}
                        labels={CLEAN_LABELS}
                        colors={CLEAN_COLORS}
                      />
                    </View>

                    {/* Access status */}
                    <View style={[s.cellV, { width: COLS[3].width }]}>
                      <Badge
                        value={item.accessStatus || "unknown"}
                        labels={ACCESS_LABELS}
                        colors={ACCESS_COLORS}
                      />
                    </View>

                    {/* Full / Available */}
                    <View style={[s.cellV, { width: COLS[4].width }]}>
                      <Badge
                        value={item.isFull ? "full" : "available"}
                        labels={{ full: "Full", available: "Available" }}
                        colors={{ full: "#E24B4A", available: "#1D9E75" }}
                      />
                    </View>

                    {/* Should be open */}
                    <View style={[s.cellV, { width: COLS[5].width }]}>
                      <Text
                        style={{
                          fontSize: 20,
                          textAlign: "center",
                          color: item.shouldBeOpen ? "#1D9E75" : "#E24B4A",
                        }}
                      >
                        {item.shouldBeOpen ? "✓" : "✗"}
                      </Text>
                    </View>

                    {/* Capacity */}
                    <Text style={[s.cell, s.center, { width: COLS[6].width }]}>
                      {item.capacity}
                    </Text>

                    {/* Neighborhood */}
                    <View style={[s.cellV, { width: COLS[7].width }]}>
                      <Text style={s.cell} numberOfLines={1}>
                        {item.neighborhood || "—"}
                      </Text>
                    </View>

                    {/* Address */}
                    <Text
                      style={[s.cell, { width: COLS[8].width }]}
                      numberOfLines={1}
                    >
                      {item.address}
                    </Text>

                    {/* Name */}
                    <View style={[s.cellV, { width: COLS[9].width }]}>
                      <Text
                        style={[
                          s.bold,
                          {
                            color: "#fff",
                            textAlign: "left",
                            paddingHorizontal: 8,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 4,
                          paddingHorizontal: 8,
                          marginTop: 2,
                          justifyContent: "flex-start",
                        }}
                      >
                        {item.isAccessible && !item.hasStairs && (
                          <Text style={{ fontSize: 14 }}>♿</Text>
                        )}
                        {!item.petIssueReported && (
                          <Text style={{ fontSize: 14 }}>🐾</Text>
                        )}
                      </View>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* Bottom count */}
      <Text style={s.countLabel}>Showing {filtered.length} shelters</Text>

      {/* Add modal */}
      <Modal
        transparent
        visible={showAdd}
        animationType="slide"
        onRequestClose={() => setShowAdd(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowAdd(false)}>
          <Pressable style={s.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={s.modalTitle}>Add New Shelter</Text>
            <TextInput
              style={s.modalInput}
              placeholder="Shelter name"
              placeholderTextColor="#666"
              value={newShelter.name}
              onChangeText={(t) => setNewShelter({ ...newShelter, name: t })}
            />
            <TextInput
              style={s.modalInput}
              placeholder="Address"
              placeholderTextColor="#666"
              value={newShelter.address}
              onChangeText={(t) => setNewShelter({ ...newShelter, address: t })}
            />
            <TextInput
              style={s.modalInput}
              placeholder="Neighborhood"
              placeholderTextColor="#666"
              value={newShelter.neighborhood}
              onChangeText={(t) =>
                setNewShelter({ ...newShelter, neighborhood: t })
              }
            />
            <TextInput
              style={s.modalInput}
              placeholder="Area"
              placeholderTextColor="#666"
              value={newShelter.area}
              onChangeText={(t) => setNewShelter({ ...newShelter, area: t })}
            />
            <TextInput
              style={s.modalInput}
              placeholder="Capacity"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={newShelter.capacity}
              onChangeText={(t) =>
                setNewShelter({ ...newShelter, capacity: t })
              }
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: "#1D9E75" }]}
                onPress={handleAdd}
              >
                <Text style={s.modalBtnTxt}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalBtn, { backgroundColor: "#444" }]}
                onPress={() => setShowAdd(false)}
              >
                <Text style={s.modalBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
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
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 18 },
  statCard: {
    flex: 1,
    backgroundColor: "#242424",
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    borderWidth: 0.5,
    borderColor: "#333",
  },
  statMain: { flex: 1.3, borderColor: "#444" },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 10,
    textAlign: "center",
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
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 0.5,
    borderColor: "#333",
    backgroundColor: "#242424",
  },
  chipOn: { borderColor: "#777", backgroundColor: "#2e2e2e" },
  chipTxt: { fontSize: 18, color: "#666" },
  chipTxtOn: { color: "#fff" },
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
  addBtn: {
    backgroundColor: "#1D9E75",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  addBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 16 },
  delBtn: { width: 50, alignItems: "center", justifyContent: "center" },
  delTxt: { fontSize: 18 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#242424",
    borderRadius: 16,
    padding: 20,
    borderWidth: 0.5,
    borderColor: "#3a3a3a",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 14,
    textAlign: "left",
  },
  modalInput: {
    backgroundColor: "#1c1c1c",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 15,
    textAlign: "left",
    borderWidth: 0.5,
    borderColor: "#333",
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalBtnTxt: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
