/**
 * 高德地图 JS API 加载器（单例 + Promise 缓存）
 * - 加载前注入 window._AMapSecurityConfig（securityJsCode）
 * - 通过 plugin 参数一次性加载 AMap.PlaceSearch / AMap.Geocoder 插件
 * - 仅在浏览器环境按需加载，不做 SSR require
 * - Key 缺失 / 加载超时 / 失败均 reject 明确错误，由 UI 降级到手动输入
 */

let loading: Promise<any> | null = null;

const LOAD_TIMEOUT_MS = 15000;

export function loadAMap(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("高德地图仅支持浏览器环境"));
  }
  if ((window as any).AMap) return Promise.resolve((window as any).AMap);
  if (loading) return loading;

  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;

  loading = new Promise<any>((resolve, reject) => {
    if (!key) {
      loading = null;
      reject(new Error("未配置 NEXT_PUBLIC_AMAP_JS_KEY，已切换到手动输入"));
      return;
    }
    if (securityCode) {
      (window as any)._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.PlaceSearch,AMap.Geocoder`;
    script.async = true;
    const timer = window.setTimeout(() => {
      loading = null;
      reject(new Error("高德地图加载超时，请检查网络，已切换到手动输入"));
    }, LOAD_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      const A = (window as any).AMap;
      if (A && A.PlaceSearch && A.Geocoder) {
        resolve(A);
      } else {
        loading = null;
        reject(new Error("高德地图插件加载失败，已切换到手动输入"));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      loading = null;
      reject(new Error("高德地图加载失败，请检查网络或 Key，已切换到手动输入"));
    };
    document.head.appendChild(script);
  });

  return loading;
}
