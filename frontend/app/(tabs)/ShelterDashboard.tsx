import React, { useEffect, useState, useMemo } from "react";
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity, Modal, Pressable, Alert,
} from "react-native";
import { useAuth } from "@/context/auth";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type Shelter = {
  id?: string;
  name: string; address: string; neighborhood: string; area: string;
  placeType: string; capacity: number; accessStatus: string;
  isAccessible: boolean; isFull: boolean; hasStairs: boolean;
  petIssueReported: boolean; cleanlinessStatus: string;
  shouldBeOpen: boolean; lastReportAt?: string; lastReportType?: string;
  city?: string;
};

const ACCESS_LABELS: Record<string,string> = { open:"פתוח", closed:"סגור", locked:"נעול", unknown:"לא ידוע" };
const ACCESS_COLORS: Record<string,string> = { open:"#1D9E75", closed:"#E24B4A", locked:"#888780", unknown:"#BA7517" };
const CLEAN_LABELS: Record<string,string>  = { clean:"נקי", dirty:"מלוכלך", unknown:"לא ידוע" };
const CLEAN_COLORS: Record<string,string>  = { clean:"#1D9E75", dirty:"#E24B4A", unknown:"#888780" };
const TYPE_LABELS: Record<string,string>   = { "public shelter":"מקלט ציבורי", school:"בית ספר", parking:"חניון", other:"אחר" };
const REPORT_LABELS: Record<string,string> = { access:"גישה", capacity:"תפוסה", cleanliness:"ניקיון", pet_issue:"חיות", damage:"נזק", other:"כללי" };
const CITIES = ["כל הערים", "Be'er Sheva"];
const AREAS  = ["כל האזורים", "צפון", "דרום", "מזרח", "מערב"];
const TYPES  = ["כל הסוגים", "public shelter", "school", "parking", "other"];
const CHIPS  = ["דווח לאחרונה", "מלאים", "ידידותי לחיות 🐾", "נגישים ♿", "הכול"];

function Badge({ value, labels, colors }: { value:string; labels:Record<string,string>; colors:Record<string,string> }) {
  const c = colors[value] || "#888";
  return (
    <View style={[bd.wrap, { borderColor:c+"66", backgroundColor:c+"18" }]}>
      <View style={[bd.dot, { backgroundColor:c }]} />
      <Text style={[bd.txt, { color:c }]}>{labels[value] || value}</Text>
    </View>
  );
}
const bd = StyleSheet.create({
  wrap: { flexDirection:"row", alignItems:"center", gap:4, paddingHorizontal:8, paddingVertical:4, borderRadius:14, borderWidth:0.5, alignSelf:"center" },
  dot:  { width:6, height:6, borderRadius:3 },
  txt:  { fontSize:12, fontWeight:"500" },
});

function Dropdown({ label, value, options, onChange, labelMap }:{
  label:string; value:string; options:string[];
  onChange:(v:string)=>void; labelMap?:Record<string,string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex:1 }}>
      <TouchableOpacity style={dr.btn} onPress={()=>setOpen(true)}>
        <Text style={dr.arrow}>▾</Text>
        <Text style={dr.val} numberOfLines={1}>{labelMap?.[value]??value}</Text>
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={()=>setOpen(false)}>
        <Pressable style={dr.overlay} onPress={()=>setOpen(false)}>
          <View style={dr.menu}>
            <Text style={dr.menuTitle}>{label}</Text>
            {options.map(o=>(
              <TouchableOpacity key={o} style={dr.item} onPress={()=>{ onChange(o); setOpen(false); }}>
                <Text style={[dr.itemTxt, value===o && dr.itemOn]}>{labelMap?.[o]??o}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
const dr = StyleSheet.create({
  btn:      { flexDirection:"row", justifyContent:"space-between", alignItems:"center", backgroundColor:"#242424", borderRadius:10, paddingHorizontal:16, paddingVertical:14, borderWidth:0.5, borderColor:"#3a3a3a" },
  val:      { color:"#ddd", fontSize:17, flex:1, textAlign:"right" },
  arrow:    { color:"#666", fontSize:13, marginLeft:6 },
  overlay:  { flex:1, backgroundColor:"#00000099", justifyContent:"center", padding:32 },
  menu:     { backgroundColor:"#242424", borderRadius:14, borderWidth:0.5, borderColor:"#3a3a3a", overflow:"hidden" },
  menuTitle:{ color:"#666", fontSize:12, textAlign:"right", paddingHorizontal:20, paddingTop:14, paddingBottom:8 },
  item:     { paddingHorizontal:20, paddingVertical:16, borderBottomWidth:0.5, borderBottomColor:"#333" },
  itemTxt:  { color:"#aaa", fontSize:17, textAlign:"right" },
  itemOn:   { color:"#fff", fontWeight:"500" },
});

const COLS = [
  { key:"lastReport",   heb:"דיווח אחרון",   width:110 },
  { key:"reportType",   heb:"סוג דיווח",      width:95  },
  { key:"cleanliness",  heb:"ניקיון",         width:100 },
  { key:"accessStatus", heb:"סטטוס",          width:100 },
  { key:"isFull",       heb:"עומס",           width:90  },
  { key:"shouldBeOpen", heb:"מצב נדרש",       width:85  },
  { key:"capacity",     heb:"קיבולת",         width:75  },
  { key:"neighborhood", heb:"שכונה",          width:110 },
  { key:"address",      heb:"כתובת",          width:160 },
  { key:"name",         heb:"שם המקלט",       width:170 },
];
const TOTAL_W = COLS.reduce((sum,c)=>sum+c.width, 0);

const ROW_H = 72;

function timeAgo(dateStr: string): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "עכשיו";
  if (mins < 60)  return `לפני ${mins} דק'`;
  if (hours < 24) return `לפני ${hours} שע'`;
  return `לפני ${days} ימים`;
}

export default function ShelterDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [loading,  setLoading ] = useState(true);
  const [search,   setSearch  ] = useState("");
  const [city,     setCity    ] = useState("כל הערים");
  const [area,     setArea    ] = useState("כל האזורים");
  const [type,     setType    ] = useState("כל הסוגים");
  const [chip,     setChip    ] = useState("הכול");
  const [showAdd,  setShowAdd ] = useState(false);
  const [newShelter, setNewShelter] = useState({
    name:"", address:"", neighborhood:"", area:"", capacity:"",
  });

  const handleAdd = async () => {
    if (!newShelter.name || !newShelter.address) {
      Alert.alert("שגיאה", "שם וכתובת חובה");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/shelters`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
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
        Alert.alert("שגיאה", err.detail || "הוספה נכשלה");
        return;
      }
      Alert.alert("נוסף", "מקלט נוסף בהצלחה");
      setShowAdd(false);
      setNewShelter({ name:"", address:"", neighborhood:"", area:"", capacity:"" });
      load();
    } catch {
      Alert.alert("שגיאה", "תקלה בחיבור לשרת");
    }
  };

  const handleDelete = (shelter: Shelter) => {
    Alert.alert("מחיקה", `למחוק את ${shelter.name}?`, [
      { text:"ביטול", style:"cancel" },
      { text:"מחק", style:"destructive", onPress: async () => {
        try {
          const res = await fetch(`${API_URL}/shelters/${shelter.id}?user_id=${user?.id}`, { method:"DELETE" });
          if (!res.ok) {
            const err = await res.json();
            Alert.alert("שגיאה", err.detail || "מחיקה נכשלה");
            return;
          }
          load();
        } catch {
          Alert.alert("שגיאה", "תקלה בחיבור לשרת");
        }
      }},
    ]);
  };

  const load = async () => {
    try {
      setLoading(true);
      const p = new URLSearchParams();
      if (city !== "כל הערים")    p.append("city", city);
      if (area !== "כל האזורים") p.append("area", area);
      if (type !== "כל הסוגים")  p.append("place_type", type);
      const res  = await fetch(`${API_URL}/shelters?${p}`);
      const data = await res.json();
      setShelters(data.shelters || []);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [city, area, type]);

  const filtered = useMemo(() => {
    let list = shelters;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.neighborhood?.toLowerCase().includes(q)
      );
    }
    if (chip === "נגישים ♿")          list = list.filter(s => s.isAccessible && !s.hasStairs);
    if (chip === "ידידותי לחיות 🐾")  list = list.filter(s => !s.petIssueReported);
    if (chip === "מלאים")              list = list.filter(s => s.isFull);
    if (chip === "דווח לאחרונה")       list = list.filter(s => !!s.lastReportAt);
    return list;
  }, [shelters, search, chip]);

  const openCount   = filtered.filter(s => s.accessStatus === "open").length;
  const fullCount   = filtered.filter(s => s.isFull).length;
  const closedCount = filtered.filter(s => s.accessStatus === "closed" || s.accessStatus === "locked").length;

  return (
    <View style={s.container}>

      {/* כרטיסי סטטוס — סה"כ ימין, סגורים שמאל */}
      <View style={s.statsRow}>
        {[
          { label:"סגורים / נעולים", value:closedCount,     color:"#E24B4A", main:false },
          { label:"עמוסים / מלאים",  value:fullCount,       color:"#BA7517", main:false },
          { label:"פנויים",           value:openCount,       color:"#1D9E75", main:false },
          { label:"סה״כ מקלטים",     value:filtered.length, color:"#fff",    main:true  },
        ].map(c => (
          <View key={c.label} style={[s.statCard, c.main && s.statMain]}>
            <Text style={s.statLabel}>{c.label}</Text>
            <Text style={[s.statValue, { color:c.color }]}>{c.value}</Text>
          </View>
        ))}
      </View>

      {/* כפתור הוספה לאדמין */}
      {isAdmin && (
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={s.addBtnTxt}>+ הוסף מקלט</Text>
        </TouchableOpacity>
      )}

      {/* חיפוש */}
      <View style={s.searchRow}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.searchInput}
          placeholder="...חיפוש לפי שם, כתובת או שכונה"
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

      {/* Dropdowns — סוג | אזורים | ערים (מימין לשמאל) */}
    <View style={s.dropRow}>
  <Dropdown label="סוג מקום" value={type} options={TYPES}  onChange={setType} labelMap={TYPE_LABELS} />
  <View style={{width:10}}/>
  <Dropdown label="אזור"     value={area} options={AREAS}  onChange={setArea} />
  <View style={{width:10}}/>
  <Dropdown label="עיר"      value={city} options={CITIES} onChange={setCity} />
</View>

      {/* Chips — קבועות מתחת ל-dropdowns */}
      <View style={s.chipsRow}>
        {CHIPS.map(c => (
          <TouchableOpacity key={c} style={[s.chip, chip===c && s.chipOn]} onPress={() => setChip(c)}>
            <Text style={[s.chipTxt, chip===c && s.chipTxtOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* טבלה */}
      {loading ? (
        <ActivityIndicator style={{marginTop:40}} color="#378ADD"/>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator style={{flex:1}}>
          <View style={{width: TOTAL_W + (isAdmin ? 50 : 0)}}>
            {/* כותרות */}
            <View style={[s.headerRow, {width: TOTAL_W + (isAdmin ? 50 : 0)}]}>
              {isAdmin && <View style={{width:50}} />}
              {COLS.map(c => (
                <Text key={c.key} style={[s.headerCell, {width:c.width}]}>{c.heb}</Text>
              ))}
            </View>
            {/* שורות */}
          <ScrollView style={{height: ROW_H * 6}} nestedScrollEnabled>
              {filtered.length === 0
                ? <Text style={s.empty}>לא נמצאו מקלטים</Text>
                : filtered.map((item, i) => (
                  <View key={i} style={[s.row, i%2===0 && s.rowAlt, {minHeight:ROW_H, width: TOTAL_W + (isAdmin ? 50 : 0)}]}>

                  {/* כפתור מחיקה לאדמין */}
                  {isAdmin && (
                    <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(item)}>
                      <Text style={s.delTxt}>🗑</Text>
                    </TouchableOpacity>
                  )}

                  {/* דיווח אחרון */}
<View style={[s.cellV, {width:COLS[0].width}]}>
  <Text style={[s.cell, {color:"#777", fontSize:15}]} numberOfLines={1}>
    {timeAgo(item.lastReportAt || "")}
  </Text>
</View>

{/* סוג דיווח */}
<View style={[s.cellV, {width:COLS[1].width}]}>
  <Text style={[s.cell, {color:"#666", fontSize:15}]}>
    {item.lastReportType ? REPORT_LABELS[item.lastReportType] || item.lastReportType : "—"}
  </Text>
</View>

                    {/* סטטוס ניקיון */}
                    <View style={[s.cellV, {width:COLS[2].width}]}>
                      <Badge value={item.cleanlinessStatus||"unknown"} labels={CLEAN_LABELS} colors={CLEAN_COLORS}/>
                    </View>

                    {/* סטטוס גישה */}
                    <View style={[s.cellV, {width:COLS[3].width}]}>
                      <Badge value={item.accessStatus||"unknown"} labels={ACCESS_LABELS} colors={ACCESS_COLORS}/>
                    </View>

                    {/* מלא / פנוי */}
                    <View style={[s.cellV, {width:COLS[4].width}]}>
                      <Badge
                        value={item.isFull ? "full" : "available"}
                        labels={{full:"מלא", available:"פנוי"}}
                        colors={{full:"#E24B4A", available:"#1D9E75"}}
                      />
                    </View>

                    {/* אמור להיות פתוח */}
                    <View style={[s.cellV, {width:COLS[5].width}]}>
                      <Text style={{fontSize:20, textAlign:"center", color: item.shouldBeOpen ? "#1D9E75" : "#E24B4A"}}>
                        {item.shouldBeOpen ? "✓" : "✗"}
                      </Text>
                    </View>

                    {/* קיבולת */}
                    <Text style={[s.cell, s.center, {width:COLS[6].width}]}>{item.capacity}</Text>

                    {/* שכונה */}
                  <View style={[s.cellV, {width:COLS[7].width}]}>
  <Text style={s.cell} numberOfLines={1}>{item.neighborhood || "—"}</Text>
</View>

                    {/* כתובת */}
                    <Text style={[s.cell, {width:COLS[8].width}]} numberOfLines={1}>{item.address}</Text>

                   {/* שם */}
                    <View style={[s.cellV, {width:COLS[9].width}]}>
                    <Text style={[s.bold, {color:"#fff", textAlign:"right", paddingHorizontal:8}]} numberOfLines={1}>
    {item.name}
  </Text>
  <View style={{flexDirection:"row", gap:4, paddingHorizontal:8, marginTop:2, justifyContent:"flex-end"}}>
    {item.isAccessible && !item.hasStairs && <Text style={{fontSize:14}}>♿</Text>}
    {!item.petIssueReported               && <Text style={{fontSize:14}}>🐾</Text>}
  </View>
</View>

                  </View>
                ))
              }
            </ScrollView>
          </View>
        </ScrollView>
      )}

      {/* ספירה למטה */}
      <Text style={s.countLabel}>מציג {filtered.length} מקלטים</Text>

      {/* מודל הוספה */}
      <Modal transparent visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowAdd(false)}>
          <Pressable style={s.modalCard} onPress={(e)=>e.stopPropagation()}>
            <Text style={s.modalTitle}>הוספת מקלט חדש</Text>
            <TextInput style={s.modalInput} placeholder="שם המקלט" placeholderTextColor="#666"
              value={newShelter.name} onChangeText={t => setNewShelter({...newShelter, name:t})} />
            <TextInput style={s.modalInput} placeholder="כתובת" placeholderTextColor="#666"
              value={newShelter.address} onChangeText={t => setNewShelter({...newShelter, address:t})} />
            <TextInput style={s.modalInput} placeholder="שכונה" placeholderTextColor="#666"
              value={newShelter.neighborhood} onChangeText={t => setNewShelter({...newShelter, neighborhood:t})} />
            <TextInput style={s.modalInput} placeholder="אזור" placeholderTextColor="#666"
              value={newShelter.area} onChangeText={t => setNewShelter({...newShelter, area:t})} />
            <TextInput style={s.modalInput} placeholder="קיבולת" placeholderTextColor="#666"
              keyboardType="numeric"
              value={newShelter.capacity} onChangeText={t => setNewShelter({...newShelter, capacity:t})} />
            <View style={{flexDirection:"row", gap:10, marginTop:10}}>
              <TouchableOpacity style={[s.modalBtn, {backgroundColor:"#1D9E75"}]} onPress={handleAdd}>
                <Text style={s.modalBtnTxt}>הוסף</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, {backgroundColor:"#444"}]} onPress={() => setShowAdd(false)}>
                <Text style={s.modalBtnTxt}>ביטול</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: { flex:1, backgroundColor:"#181818", padding:14, paddingTop:1 },
  statsRow:    { flexDirection:"row", gap:12, marginBottom:18 },
  statCard:    { flex:1, backgroundColor:"#242424", borderRadius:16, padding:18, alignItems:"center", borderWidth:0.5, borderColor:"#333" },
  statMain:    { flex:1.3, borderColor:"#444" },
  statLabel:   { fontSize:12, color:"#666", marginBottom:10, textAlign:"center" },
  statValue:   { fontSize:28, fontWeight:"500" },
  searchRow:   { flexDirection:"row", alignItems:"center", backgroundColor:"#242424", borderRadius:14, paddingHorizontal:16, marginBottom:14, borderWidth:0.5, borderColor:"#333", height:56 },
  searchIcon:  { fontSize:18, marginLeft:10 },
  searchInput: { flex:1, color:"#fff", fontSize:16, textAlign:"right" },
  clearBtn:    { padding:8 },
  clearTxt:    { color:"#666", fontSize:16 },
  dropRow:     { flexDirection:"row", marginBottom:12 },
 chipsRow: { flexDirection:"row", gap:10, marginBottom:14, flexWrap:"wrap", justifyContent:"flex-end" },
  chip:        { paddingHorizontal:18, paddingVertical:10, borderRadius:24, borderWidth:0.5, borderColor:"#333", backgroundColor:"#242424" },
  chipOn:      { borderColor:"#777", backgroundColor:"#2e2e2e" },
  chipTxt:     { fontSize:18, color:"#666" },
  chipTxtOn:   { color:"#fff" },
  headerRow:   { flexDirection:"row", backgroundColor:"#242424", borderTopLeftRadius:12, borderTopRightRadius:12, borderWidth:0.5, borderColor:"#333", paddingVertical:12, justifyContent:"flex-end" },
 headerCell: { fontSize:13, color:"#888", fontWeight:"500", textAlign:"center", paddingHorizontal:4, paddingVertical:10 },
  row: { flexDirection:"row", paddingVertical:10, borderBottomWidth:0.5, borderBottomColor:"#222", backgroundColor:"#1c1c1c", alignItems:"center" },
  rowAlt:      { backgroundColor:"#1f1f1f" },
 cell: { fontSize:13, color:"#ccc", paddingHorizontal:4, textAlign:"center" },
  bold: { color:"#fff", fontWeight:"500", fontSize:14 },
  center:      { textAlign:"center" },
 cellV: { paddingHorizontal:8, justifyContent:"center", alignItems:"center" },
  icon:        { fontSize:20 },
  empty:       { color:"#666", textAlign:"center", padding:40, fontSize:16 },
  countLabel:  { fontSize:13, color:"#555", textAlign:"right", marginTop:12 },
  addBtn:      { backgroundColor:"#1D9E75", paddingVertical:12, borderRadius:10, alignItems:"center", marginBottom:12 },
  addBtnTxt:   { color:"#fff", fontWeight:"600", fontSize:16 },
  delBtn:      { width:50, alignItems:"center", justifyContent:"center" },
  delTxt:      { fontSize:18 },
  modalOverlay:{ flex:1, backgroundColor:"#000000aa", justifyContent:"center", padding:24 },
  modalCard:   { backgroundColor:"#242424", borderRadius:16, padding:20, borderWidth:0.5, borderColor:"#3a3a3a" },
  modalTitle:  { color:"#fff", fontSize:18, fontWeight:"600", marginBottom:14, textAlign:"right" },
  modalInput:  { backgroundColor:"#1c1c1c", color:"#fff", borderRadius:8, paddingHorizontal:12, paddingVertical:10, marginBottom:10, fontSize:15, textAlign:"right", borderWidth:0.5, borderColor:"#333" },
  modalBtn:    { flex:1, paddingVertical:12, borderRadius:8, alignItems:"center" },
  modalBtnTxt: { color:"#fff", fontWeight:"600", fontSize:15 },
});