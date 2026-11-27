"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Search, Trash2, Star, Loader2, Crosshair } from "lucide-react";
import type { StoreLocation } from "@/lib/merchant-takeout/types";
import { loadAMap } from "./amap-loader";
import { defaultLocationCosts } from "./location-cost-form";

const POI_CATEGORIES = [
  { code: "120000", label: "住宅区" },
  { code: "120200", label: "写字楼" },
  { code: "141200", label: "学校" },
  { code: "060100", label: "商场" },
  { code: "050000", label: "餐饮" },
] as const;

const DEFAULT_CENTER: [number, number] = [121.4737, 31.2304]; // 上海

interface LocationEditorProps {
  locations: StoreLocation[];
  onChange: (locations: StoreLocation[]) => void;
}

export default function LocationEditor({ locations, onChange }: LocationEditorProps) {
  const [amap, setAmap] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(
    locations.find((l) => l.selected)?.id ?? locations[0]?.id ?? null,
  );

  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [queryingPoi, setQueryingPoi] = useState(false);

  // 手动降级表单
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualLat, setManualLat] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const geocoderRef = useRef<any>(null);

  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const current = locations.find((l) => l.id === currentId) ?? locations[0] ?? null;

  const patchLocation = (id: string, patch: Partial<StoreLocation>) => {
    const next = locationsRef.current.map((l) => (l.id === id ? { ...l, ...patch } : l));
    onChange(next);
  };

  const createLocation = (partial: {
    name: string;
    address: string;
    lng: number;
    lat: number;
  }) => {
    const isFirst = locationsRef.current.length === 0;
    const loc: StoreLocation = {
      id: (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      name: partial.name,
      address: partial.address,
      lng: partial.lng,
      lat: partial.lat,
      deliveryRadius: 3,
      poi: [],
      competitors: "",
      selected: isFirst,
      costs: defaultLocationCosts(),
    };
    onChange([loc, ...locationsRef.current]);
    setCurrentId(loc.id);
  };

  const removeLocation = (id: string) => {
    const next = locationsRef.current.filter((l) => l.id !== id);
    if (next.length > 0 && id === currentId) setCurrentId(next[0].id);
    onChange(next);
  };

  const markSelected = (id: string) => {
    onChange(locationsRef.current.map((l) => ({ ...l, selected: l.id === id })));
    setCurrentId(id);
  };

  // ---- 加载 AMap（单例） ----
  useEffect(() => {
    let cancelled = false;
    loadAMap()
      .then((A) => {
        if (!cancelled) setAmap(A);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "高德地图不可用");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 创建地图实例 ----
  useEffect(() => {
    if (!amap || !containerRef.current) return;
    const first = locationsRef.current[0];
    const center: [number, number] = first ? [first.lng, first.lat] : DEFAULT_CENTER;
    const map = new amap.Map(containerRef.current, { zoom: 13, center });
    mapRef.current = map;

    map.on("click", (e: any) => {
      const lng = e.lnglat.getLng();
      const lat = e.lnglat.getLat();
      if (!geocoderRef.current) geocoderRef.current = new amap.Geocoder({});
      geocoderRef.current.getAddress(
        [lng, lat],
        (status: string, result: any) => {
          const addr =
            status === "complete" && result.regeocode
              ? result.regeocode.formattedAddress
              : "地图选点";
          createLocation({ name: addr, address: addr, lng, lat });
        },
      );
    });

    return () => {
      map.destroy();
      mapRef.current = null;
      circleRef.current = null;
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amap]);

  // ---- 同步标记 + 配送半径圆 ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !amap) return;
    markersRef.current.forEach((m) => map.remove(m));
    markersRef.current = [];
    locations.forEach((loc) => {
      const marker = new amap.Marker({ position: [loc.lng, loc.lat], title: loc.name });
      marker.on("click", () => setCurrentId(loc.id));
      marker.setMap(map);
      markersRef.current.push(marker);
    });
    if (circleRef.current) {
      map.remove(circleRef.current);
      circleRef.current = null;
    }
    if (current) {
      const circle = new amap.Circle({
        center: [current.lng, current.lat],
        radius: Math.max(current.deliveryRadius, 0.05) * 1000,
        strokeColor: "#f59e0b",
        strokeWeight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 0.15,
      });
      circle.setMap(map);
      circleRef.current = circle;
      map.setCenter([current.lng, current.lat]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amap, locations, currentId]);

  // ---- 关键词搜索 ----
  const searchPlace = () => {
    if (!amap || !keyword.trim()) return;
    setSearching(true);
    const ps = new amap.PlaceSearch({ pageSize: 10 });
    ps.search(keyword.trim(), (status: string, result: any) => {
      setSearching(false);
      if (status === "complete" && result.poiList?.pois) {
        setSearchResults(result.poiList.pois);
      } else {
        setSearchResults([]);
      }
    });
  };

  const pickSearchResult = (poi: any) => {
    const lng = poi.location?.lng ?? poi.location?.getLng?.();
    const lat = poi.location?.lat ?? poi.location?.getLat?.();
    if (typeof lng !== "number" || typeof lat !== "number") return;
    createLocation({ name: poi.name, address: poi.address || poi.name, lng, lat });
    setKeyword("");
    setSearchResults([]);
  };

  // ---- 周边 POI 查询 ----
  const queryNearbyPoi = () => {
    if (!amap || !current) return;
    setQueryingPoi(true);
    const center = [current.lng, current.lat];
    const radius = Math.max(current.deliveryRadius, 0.1) * 1000;
    const ps = new amap.PlaceSearch({ pageSize: 50 }); // ponytail: 单页 50 条，够 MVP 用
    ps.searchNearBy("", center, radius, (status: string, result: any) => {
      setQueryingPoi(false);
      if (status !== "complete" || !result.poiList?.pois) return;
      const names: string[] = [];
      for (const p of result.poiList.pois) {
        const t: string = p.type || "";
        const cat = POI_CATEGORIES.find(
          (c) => t.split(";").includes(c.code) || t.startsWith(c.code),
        );
        if (cat && p.name) names.push(`${cat.label}·${p.name}`);
      }
      if (names.length) patchLocation(current.id, { poi: names.slice(0, 100) });
    });
  };

  const addManual = () => {
    const lng = Number(manualLng);
    const lat = Number(manualLat);
    if (!manualName.trim() || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    createLocation({ name: manualName.trim(), address: manualAddress.trim(), lng, lat });
    setManualName("");
    setManualAddress("");
    setManualLng("");
    setManualLat("");
  };

  return (
    <div className="space-y-3">
      {/* 地图 / 手动降级 */}
      {loadError ? (
        <div className="brutal bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
          <div>⚠️ {loadError}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="名称（如：中山公园店）"
              className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
            />
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="地址"
              className="w-full px-2 py-1.5 text-sm border-2 border-border bg-card"
            />
            <input
              type="number"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              placeholder="经度 lng"
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
            <input
              type="number"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="纬度 lat"
              className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border bg-card"
            />
          </div>
          <button
            onClick={addManual}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white"
          >
            <Plus className="w-3.5 h-3.5" /> 手动添加候选地址
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchPlace();
              }}
              placeholder="搜索地址关键词（如：中山公园 / 写字楼 / 地铁站）"
              className="flex-1 px-2 py-1.5 text-sm border-2 border-border bg-card"
            />
            <button
              onClick={searchPlace}
              disabled={searching}
              className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              搜索
            </button>
          </div>

          {searchResults.length > 0 && (
            <ul className="brutal bg-card max-h-48 overflow-auto divide-y-2 divide-border">
              {searchResults.map((poi, i) => (
                <li key={poi.id || i}>
                  <button
                    onClick={() => pickSearchResult(poi)}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted flex items-start gap-2"
                  >
                    <Plus className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="font-bold block">{poi.name}</span>
                      <span className="text-muted-foreground">{poi.address}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div
            ref={containerRef}
            className="brutal w-full h-64 bg-muted/30 relative"
          >
            {!amap && !loadError && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 地图加载中…
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5" /> 点击地图任意位置选点，点击标记切换当前编辑的候选地址
          </div>
        </>
      )}

      {/* 候选地址列表 */}
      {locations.length === 0 ? (
        <div className="brutal bg-card p-3 text-xs text-muted-foreground">
          还没有候选地址。搜索关键词或直接在地图上点选以添加。
        </div>
      ) : (
        <ul className="space-y-2">
          {locations.map((loc) => (
            <li key={loc.id} className="brutal bg-card p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setCurrentId(loc.id)}
                      className={`text-xs font-bold text-left truncate ${
                        loc.id === current?.id ? "text-blue" : "text-foreground"
                      }`}
                    >
                      {loc.name || "未命名候选地址"}
                    </button>
                    {loc.selected && (
                      <span className="brutal-chip px-1.5 py-0.5 text-[10px] bg-lime">当前经营地址</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {loc.address} · {loc.lng.toFixed(5)}, {loc.lat.toFixed(5)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => markSelected(loc.id)}
                    title="设为当前经营地址"
                    className={`brutal-btn p-1.5 ${loc.selected ? "text-lime" : "text-muted-foreground"}`}
                  >
                    <Star className="w-3.5 h-3.5" fill={loc.selected ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={() => removeLocation(loc.id)}
                    title="删除候选地址"
                    className="brutal-btn p-1.5 text-muted-foreground"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 当前地址：配送半径 + 周边 POI */}
      {current && (
        <div className="brutal bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <MapPin className="w-4 h-4" />
              {current.name || "当前候选地址"}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">配送半径</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={current.deliveryRadius}
                onChange={(e) =>
                  patchLocation(current.id, {
                    deliveryRadius: Math.max(0.5, Number(e.target.value) || 0.5),
                  })
                }
                className="w-20 px-2 py-1 text-sm font-mono border-2 border-border bg-card"
              />
              <span className="text-xs text-muted-foreground">km</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={queryNearbyPoi}
              disabled={queryingPoi || loadError != null}
              className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground"
            >
              {queryingPoi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              查询周边 POI
            </button>
            <span className="text-xs text-muted-foreground">
              住宅区 / 写字楼 / 学校 / 商场 / 餐饮
            </span>
          </div>

          {current.poi.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {current.poi.map((p, i) => (
                <span key={i} className="brutal-chip px-2 py-0.5 text-[11px] bg-muted/40">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
