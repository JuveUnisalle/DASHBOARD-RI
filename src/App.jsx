import React, { useState, useEffect, useRef, useMemo } from 'react';

// =============================================================
//  UTILIDADES
// =============================================================

// Normaliza un valor para comparaciones/llaves (trim + mayúsculas)
const norm = (v) => String(v ?? '').trim().toUpperCase();

// Parseo numérico tolerante a comas decimales (Excel en español)
const parseNum = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
};
const parseIntSafe = (v) => {
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) ? n : 0;
};

// Diccionario de posibles nombres de columna (tolerante a espacios/acentos/variantes)
const F = {
    lat:        ['LATITUD', 'LATITUD ', 'Latitud', 'latitud', 'LAT'],
    lng:        ['LONGITUD', 'LONGITUD ', 'Longitud', 'longitud', 'LNG', 'LON'],
    ruta:       ['RUTA', 'RUTA ', 'Ruta', 'ruta'],
    ciudad:     ['CIUDAD', 'CIUDAD ', 'Ciudad', 'ciudad'],
    regional:   ['REGIONAL', 'REGIONAL ', 'Regional', 'regional', 'REGION', 'REGIÓN', 'REGION '],
    supervisor: ['SUPERVISOR', 'SUPERVISOR ', 'Supervisor', 'supervisor', 'SUPERVISOR '],
    pdv:        ['PUNTO DE VENTA', 'PUNTO DE VENTA ', 'Punto de Venta', 'PUNTO_DE_VENTA'],
    codigo:     ['Codigo  PDV', 'Codigo PDV', 'CODIGO PDV', 'Código PDV', 'CÓDIGO PDV', 'COD PDV', 'CODIGO_PDV'],
    cadena:     ['CRUCE', 'CADENA', 'Cadena', 'Cruce'],
    frecuencia: ['FRECUENCIA', 'FRECUENCIA ', 'Frecuencia', 'frecuencia'],
    hrs:        ['TOTAL HRS B', 'Total Hrs B', 'HRS B', 'HRS', 'Hrs'],
    desp:       ['TOTAL TIEMPO DEZPLASAMIENTO', 'TOTAL TIEMPO DESPLAZAMIENTO', 'TIEMPO DESPLAZAMIENTO', 'TOTAL TIEMPO DESPLAZAMIENTO ']
};

// Lee un campo de una fila probando los alias conocidos
const get = (row, keys) => {
    if (!row) return undefined;
    for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
    }
    return undefined;
};

// Fallback de color (por si aparece una ruta sin entrada en el mapa de colores)
const stringToColor = (str) => {
    if (!str) return '#94a3b8';
    str = String(str);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).substr(-2);
    return color;
};

// Paleta estable y bien diferenciada para N usuarios (rutas).
// Reparte el matiz uniformemente y alterna saturación/luminosidad
// para separar matices contiguos (clave con ~81 rutas).
const buildColorMap = (routes) => {
    const sorted = [...new Set(routes.map((r) => String(r).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const n = sorted.length || 1;
    const map = {};
    sorted.forEach((r, i) => {
        // golden-angle-ish hop para máxima separación visual entre vecinos
        const hue = Math.round((i * 360 / n + (i % 2) * 180) % 360);
        const sat = 62 + (i % 3) * 9;   // 62 / 71 / 80
        const light = 44 + (i % 4) * 6; // 44 / 50 / 56 / 62
        map[r] = `hsl(${hue}, ${sat}%, ${light}%)`;
    });
    return map;
};

// Índice de coordenadas a partir de TODAS las hojas (los PDV son los mismos
// puntos físicos en ambas propuestas; solo cambia su agrupación en rutas).
const buildCoordMap = (state) => {
    const map = {};
    const add = (rows) => (rows || []).forEach((r) => {
        const lat = parseFloat(String(get(r, F.lat)).replace(',', '.'));
        const lng = parseFloat(String(get(r, F.lng)).replace(',', '.'));
        if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
            const cod = norm(get(r, F.codigo));
            const pv = norm(get(r, F.pdv));
            if (cod) map['C:' + cod] = { lat, lng };
            if (pv) map['P:' + pv] = { lat, lng };
        }
    });
    add(state.bNuevas); add(state.bViejas); add(state.dNuevas); add(state.dViejas);
    return map;
};

// Devuelve las coordenadas de una fila; si no las trae, las busca en el índice
const getCoords = (row, coordMap) => {
    let lat = parseFloat(String(get(row, F.lat)).replace(',', '.'));
    let lng = parseFloat(String(get(row, F.lng)).replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
        const c = coordMap['C:' + norm(get(row, F.codigo))] || coordMap['P:' + norm(get(row, F.pdv))];
        if (c) { lat = c.lat; lng = c.lng; }
    }
    return isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0) ? [lat, lng] : null;
};

// Resumen por ruta (idéntico para "antes" y "después")
const computeRouteSummary = (baseRows, despRows, colorMap) => {
    const grouped = {};
    (baseRows || []).forEach((row) => {
        const r = String(get(row, F.ruta) ?? '').trim();
        if (!r) return;
        if (!grouped[r]) grouped[r] = { hrsServ: 0, desp: 0 };
        grouped[r].hrsServ += parseNum(get(row, F.hrs));
    });
    (despRows || []).forEach((row) => {
        const r = String(get(row, F.ruta) ?? '').trim();
        if (!r) return;
        if (!grouped[r]) grouped[r] = { hrsServ: 0, desp: 0 };
        grouped[r].desp += parseNum(get(row, F.desp));
    });
    return Object.entries(grouped)
        .map(([ruta, v]) => {
            const total = v.hrsServ + v.desp;
            return { ruta, hrsServ: v.hrsServ, desp: v.desp, total, pct: (total / 168) * 100, color: colorMap[ruta] || stringToColor(ruta) };
        })
        .sort((a, b) => b.total - a.total);
};

// =============================================================
//  MAPA (Leaflet sin react-leaflet)
// =============================================================
const MapComponent = ({ data, coordMap, colorMap }) => {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        if (!window.L || !mapRef.current || mapInstance.current) return;
        mapInstance.current = window.L.map(mapRef.current, { preferCanvas: true }).setView([4.6097, -74.0817], 5);
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
            .addTo(mapInstance.current);
        return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
    }, []);

    useEffect(() => {
        if (!mapInstance.current || !window.L) return;
        mapInstance.current.eachLayer((layer) => {
            if (layer instanceof window.L.CircleMarker) mapInstance.current.removeLayer(layer);
        });

        const lats = [], lngs = [];
        (data || []).forEach((row) => {
            const coords = getCoords(row, coordMap);
            if (!coords) return;
            const ruta = String(get(row, F.ruta) ?? '').trim();
            const color = colorMap[ruta] || stringToColor(ruta);
            lats.push(coords[0]); lngs.push(coords[1]);
            window.L.circleMarker(coords, {
                color: '#ffffff', fillColor: color, weight: 1, fillOpacity: 0.9, radius: 5
            })
                .bindPopup(
                    `<b>Ruta:</b> ${ruta || 'N/A'}<br/>` +
                    `<b>PDV:</b> ${get(row, F.pdv) || 'N/A'}<br/>` +
                    `<b>Ciudad:</b> ${get(row, F.ciudad) || 'N/A'}`
                )
                .addTo(mapInstance.current);
        });

        if (lats.length > 0) {
            mapInstance.current.fitBounds(
                [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
                { padding: [40, 40], maxZoom: 14 }
            );
        }
    }, [data, coordMap, colorMap]);

    return <div ref={mapRef} className="w-full h-full bg-slate-100 z-0 relative" />;
};

// =============================================================
//  COMPONENTE PRINCIPAL
// =============================================================
export default function App() {
    const [scriptsLoaded, setScriptsLoaded] = useState(false);
    const [status, setStatus] = useState('Cargando entorno...');
    const [isLoading, setIsLoading] = useState(false);

    const [dataState, setDataState] = useState({ bNuevas: [], dNuevas: [], bViejas: [], dViejas: [] });
    const [filters, setFilters] = useState({ CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' });

    // --- carga de librerías externas ---
    useEffect(() => {
        const loadScript = (src) => new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; document.head.appendChild(s);
        });
        if (!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css'; link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }
        Promise.all([
            loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
            loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
        ]).then(() => { setScriptsLoaded(true); setStatus('Esperando archivo Excel...'); });
    }, []);

    // --- lectura del Excel ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !window.XLSX) return;
        setIsLoading(true);
        setStatus('⏳ Leyendo archivo Excel...');
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
                const raw = { bNuevas: [], dNuevas: [], bViejas: [], dViejas: [] };
                wb.SheetNames.forEach((sheetName) => {
                    const name = sheetName.toUpperCase();
                    const sd = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
                    const isDesp = name.includes('DEZPLASAMIENTO') || name.includes('DESPLAZAMIENTO');
                    if (name.includes('NUEVA')) (isDesp ? (raw.dNuevas = sd) : (raw.bNuevas = sd));
                    else if (name.includes('VIEJA') || name.includes('ANTERIOR')) (isDesp ? (raw.dViejas = sd) : (raw.bViejas = sd));
                });
                setDataState(raw);
                setFilters({ CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' });
                setStatus('✅ ¡Dashboard Actualizado!');
                setTimeout(() => setStatus('Datos cargados'), 3000);
            } catch (err) {
                console.error('Error parsing Excel:', err);
                setStatus('❌ Error al procesar el archivo');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // --- colores estables (independientes del filtro) ---
    const colorMap = useMemo(() => {
        const all = [
            ...(dataState.bNuevas || []), ...(dataState.bViejas || []),
            ...(dataState.dNuevas || []), ...(dataState.dViejas || [])
        ].map((r) => get(r, F.ruta)).filter(Boolean);
        return buildColorMap(all);
    }, [dataState]);

    // --- índice de coordenadas (para que el mapa "anterior" también muestre puntos) ---
    const coordMap = useMemo(() => buildCoordMap(dataState), [dataState]);

    // --- base unificada para construir opciones de filtros ---
    const allBase = useMemo(
        () => [...(dataState.bNuevas || []), ...(dataState.bViejas || [])],
        [dataState]
    );

    // ¿La fila cumple los filtros indicados?
    const rowMatches = (row, f) => {
        if (f.CIUDAD && norm(get(row, F.ciudad)) !== norm(f.CIUDAD)) return false;
        if (f.REGIONAL && norm(get(row, F.regional)) !== norm(f.REGIONAL)) return false;
        if (f.RUTA && norm(get(row, F.ruta)) !== norm(f.RUTA)) return false;
        if (f.SUPERVISOR && norm(get(row, F.supervisor)) !== norm(f.SUPERVISOR)) return false;
        return true;
    };

    // Opciones en cascada: cada filtro muestra valores compatibles con los demás filtros activos
    const optionsFor = (field) => {
        const keyMap = { CIUDAD: F.ciudad, REGIONAL: F.regional, RUTA: F.ruta, SUPERVISOR: F.supervisor };
        const others = { ...filters, [field]: '' };
        const set = new Set();
        allBase.filter((r) => rowMatches(r, others)).forEach((r) => {
            const v = get(r, keyMap[field]);
            if (v !== undefined && String(v).trim() !== '') set.add(String(v).trim());
        });
        return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    };

    // --- datos filtrados (alimentan KPIs, mapas y tablas) ---
    const filtered = useMemo(() => {
        const anyActive = Object.values(filters).some(Boolean);
        if (!anyActive) return dataState;

        const bV = (dataState.bViejas || []).filter((r) => rowMatches(r, filters));
        const bN = (dataState.bNuevas || []).filter((r) => rowMatches(r, filters));
        const rutasV = new Set(bV.map((r) => norm(get(r, F.ruta))).filter(Boolean));
        const rutasN = new Set(bN.map((r) => norm(get(r, F.ruta))).filter(Boolean));
        // El desplazamiento se filtra por las rutas que sobreviven en su base correspondiente
        const dV = (dataState.dViejas || []).filter((r) => rutasV.has(norm(get(r, F.ruta))));
        const dN = (dataState.dNuevas || []).filter((r) => rutasN.has(norm(get(r, F.ruta))));
        return { bViejas: bV, bNuevas: bN, dViejas: dV, dNuevas: dN };
    }, [dataState, filters]);

    // --- KPIs derivados de los datos filtrados ---
    const kpis = useMemo(() => {
        const { bNuevas: bN = [], dNuevas: dN = [], bViejas: bV = [], dViejas: dV = [] } = filtered;
        const despViejas = dV.reduce((s, r) => s + parseNum(get(r, F.desp)), 0);
        const despNuevas = dN.reduce((s, r) => s + parseNum(get(r, F.desp)), 0);
        const hrsNuevas = bN.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0);
        const frecNuevas = bN.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0);
        // si la base "vieja" no trae horas/frecuencia (mismos PDV), reutiliza las nuevas
        const hrsViejas = bV.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0) || hrsNuevas;
        const frecViejas = bV.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0) || frecNuevas;
        return {
            pdvViejas: bV.length, pdvNuevas: bN.length,
            cuposViejas: new Set(bV.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            cuposNuevas: new Set(bN.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            despViejas, despNuevas, hrsViejas, hrsNuevas, frecViejas, frecNuevas
        };
    }, [filtered]);

    const summaryViejas = useMemo(() => computeRouteSummary(filtered.bViejas, filtered.dViejas, colorMap), [filtered, colorMap]);
    const summaryNuevas = useMemo(() => computeRouteSummary(filtered.bNuevas, filtered.dNuevas, colorMap), [filtered, colorMap]);

    const activeFilterCount = Object.values(filters).filter(Boolean).length;

    // --- fila de tabla de resumen por ruta (compartida) ---
    const RouteRow = ({ s }) => {
        const over = s.pct > 100;
        const warn = s.pct > 85 && s.pct <= 100;
        const barColor = over ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-[#56D400]';
        return (
            <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-sm flex items-center gap-2 font-medium text-slate-800">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.ruta}</span>
                </td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.hrsServ.toFixed(1)}h</td>
                <td className="p-3 text-sm text-slate-600 whitespace-nowrap">{s.desp.toFixed(1)}h</td>
                <td className="p-3 text-sm font-bold text-slate-800 whitespace-nowrap">{s.total.toFixed(1)}h</td>
                <td className="p-3 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden shrink-0">
                            <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(s.pct, 100)}%` }} />
                        </div>
                        <span className={over ? 'text-red-600 font-bold' : 'text-slate-700'}>
                            {s.pct.toFixed(1)}%{over ? ' ⚠' : ''}
                        </span>
                    </div>
                </td>
            </tr>
        );
    };

    const RouteTableHead = () => (
        <thead className="sticky top-0 z-20">
            <tr className="text-xs uppercase text-slate-500">
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200">Ruta / Usuario</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Serv.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Desp.</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">T. Total</th>
                <th className="p-3 font-semibold bg-slate-100 border-b border-slate-200 whitespace-nowrap">% Ocup (168h)</th>
            </tr>
        </thead>
    );

    const emptyRow = (cols, msg) => (
        <tr><td colSpan={cols} className="text-center text-slate-400 py-8">{msg}</td></tr>
    );

    // --- directorio general (rutas nuevas) ---
    const renderTableGeneral = () => {
        const rows = filtered.bNuevas || [];
        if (rows.length === 0) return emptyRow(7, 'Esperando archivo Excel para mostrar el detalle de puntos de venta...');
        return rows.slice(0, 200).map((row, idx) => (
            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="p-3 text-sm text-slate-600">{String(get(row, F.codigo) ?? '-')}</td>
                <td className="p-3 text-sm font-medium text-slate-800">{String(get(row, F.cadena) ?? '-')}</td>
                <td className="p-3 text-sm text-slate-600 truncate max-w-xs">{String(get(row, F.pdv) ?? '-')}</td>
                <td className="p-3 text-sm text-slate-600">{String(get(row, F.ciudad) ?? '-')}</td>
                <td className="p-3 text-sm">
                    <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorMap[String(get(row, F.ruta) ?? '').trim()] || stringToColor(get(row, F.ruta)) }} />
                        {String(get(row, F.ruta) ?? 'Sin Asignar')}
                    </span>
                </td>
                <td className="p-3 text-sm text-center text-slate-600">{String(get(row, F.frecuencia) ?? '-')}</td>
                <td className="p-3 text-sm font-semibold text-[#56D400]">{parseNum(get(row, F.hrs)).toFixed(2)}h</td>
            </tr>
        ));
    };

    return (
        <div className="min-h-screen bg-slate-100 font-sans p-6 overflow-x-hidden flex justify-center">
            <div className="w-full max-w-[1800px] flex flex-col gap-6">

                {/* HEADER */}
                <header className="bg-white rounded-2xl p-6 shadow-sm flex flex-wrap gap-4 justify-between items-center border border-slate-200">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Comparativa de Rutas: Antes vs. Después</h1>
                        <p className="text-slate-500 mt-1">Análisis de eficiencia, ocupación laboral y agrupación geoespacial.</p>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col items-center">
                            <label className={`cursor-pointer px-6 py-3 rounded-lg font-bold text-sm shadow-lg transition-all
                                ${!scriptsLoaded || isLoading ? 'bg-yellow-400 text-white cursor-not-allowed' : 'bg-[#56D400] text-black hover:scale-105 hover:shadow-xl'}`}>
                                {isLoading ? '⏳ Procesando...' : (!scriptsLoaded ? '⏳ Cargando entorno...' : '📥 Cargar Excel (.xlsx)')}
                                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} disabled={!scriptsLoaded || isLoading} />
                            </label>
                            <span className="text-xs text-slate-500 mt-2 font-medium">{status}</span>
                        </div>
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Haleon_logo.svg/1280px-Haleon_logo.svg.png" alt="Haleon" className="h-10" />
                    </div>
                </header>

                {/* BARRA DE FILTROS GLOBALES */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex items-center gap-2 mr-2">
                            <span className="text-sm font-bold text-slate-700">Filtros</span>
                            <span className="text-[11px] text-slate-400">(aplican a toda la comparativa)</span>
                        </div>
                        {['CIUDAD', 'REGIONAL', 'RUTA', 'SUPERVISOR'].map((field) => (
                            <div key={field} className="flex flex-col gap-1 min-w-[160px] flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{field}</label>
                                <select
                                    value={filters[field]}
                                    onChange={(e) => setFilters((f) => ({ ...f, [field]: e.target.value }))}
                                    disabled={allBase.length === 0}
                                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[#56D400] focus:border-[#56D400] outline-none disabled:bg-slate-50 disabled:text-slate-300"
                                >
                                    <option value="">Todas</option>
                                    {optionsFor(field).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            </div>
                        ))}
                        <button
                            onClick={() => setFilters({ CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' })}
                            disabled={activeFilterCount === 0}
                            className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Limpiar {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
                        </button>
                    </div>
                </div>

                {/* KPIS */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 xl:gap-4">
                    <KPICard title="Total Hrs Servicio (Mes)" valB={kpis.hrsViejas} valA={kpis.hrsNuevas} format="hrs" />
                    <KPICard title="Puntos de Venta (PDV)" valB={kpis.pdvViejas} valA={kpis.pdvNuevas} format="num" />
                    <KPICard title="Total Frecuencias (Visitas)" valB={kpis.frecViejas} valA={kpis.frecNuevas} format="num" />
                    <KPICard title="Tiempo Desplazamiento" valB={kpis.despViejas} valA={kpis.despNuevas} format="hrs" inverse />
                    <KPICard title="Cupos Requeridos (Rutas)" valB={kpis.cuposViejas} valA={kpis.cuposNuevas} format="num" inverse />
                    <KPICard title="Prom. Desplaz. x Cupo"
                        valB={kpis.cuposViejas ? kpis.despViejas / kpis.cuposViejas : 0}
                        valA={kpis.cuposNuevas ? kpis.despNuevas / kpis.cuposNuevas : 0}
                        format="hrs" inverse />
                    <KPICard title="Ocupación Laboral Promedio"
                        valB={kpis.cuposViejas ? ((kpis.hrsViejas + kpis.despViejas) / (kpis.cuposViejas * 168)) * 100 : 0}
                        valA={kpis.cuposNuevas ? ((kpis.hrsNuevas + kpis.despNuevas) / (kpis.cuposNuevas * 168)) * 100 : 0}
                        format="pct" />
                </div>

                {/* MAPAS Y TABLAS POR RUTA */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* ANTES */}
                    <div className="flex flex-col gap-4">
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Anterior <span className="text-slate-400 font-normal">(No Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filtered.bViejas} coordMap={coordMap} colorMap={colorMap} />
                                    : <div className="w-full h-full flex items-center justify-center text-slate-400">Cargando mapa...</div>}
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[420px]">
                            <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                                <h3 className="text-lg font-bold text-slate-800">Detalle por Ruta (Anterior)</h3>
                            </div>
                            <div className="overflow-y-auto flex-1 px-5 pb-4">
                                <table className="w-full text-left">
                                    <RouteTableHead />
                                    <tbody>
                                        {summaryViejas.length === 0 ? emptyRow(5, 'Sin datos') : summaryViejas.map((s) => <RouteRow key={s.ruta} s={s} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* DESPUÉS */}
                    <div className="flex flex-col gap-4">
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col border-t-4 border-t-[#56D400]">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Actual <span className="text-[#56D400]">(Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filtered.bNuevas} coordMap={coordMap} colorMap={colorMap} />
                                    : <div className="w-full h-full flex items-center justify-center text-slate-400">Cargando mapa...</div>}
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[420px]">
                            <div className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                                <h3 className="text-lg font-bold text-slate-800">Detalle por Ruta (Optimizado)</h3>
                            </div>
                            <div className="overflow-y-auto flex-1 px-5 pb-4">
                                <table className="w-full text-left">
                                    <RouteTableHead />
                                    <tbody>
                                        {summaryNuevas.length === 0 ? emptyRow(5, 'Sin datos') : summaryNuevas.map((s) => <RouteRow key={s.ruta} s={s} />)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* DIRECTORIO GENERAL */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[620px]">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0 flex flex-wrap gap-2 justify-between items-end">
                        <h3 className="text-xl font-bold text-slate-800">Directorio de Puntos de Venta (Rutas Nuevas)</h3>
                        <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                            Mostrando {Math.min(200, (filtered.bNuevas || []).length)} de {(filtered.bNuevas || []).length}
                        </span>
                    </div>
                    <div className="overflow-y-auto flex-1 px-6 pb-4">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 z-20">
                                <tr className="text-xs uppercase text-slate-500">
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">ID PDV</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Cadena</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Nombre Punto de Venta</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Ciudad</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Ruta Asignada</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200 text-center">Frecuencia</th>
                                    <th className="p-4 font-semibold bg-slate-100 border-b border-slate-200">Hrs Servicio</th>
                                </tr>
                            </thead>
                            <tbody>{renderTableGeneral()}</tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}

// =============================================================
//  TARJETA KPI
// =============================================================
function KPICard({ title, valB, valA, format = 'num', inverse = false }) {
    const formatVal = (v) => {
        if (typeof v !== 'number' || isNaN(v)) return '0';
        if (format === 'num') return Math.round(v).toLocaleString();
        if (format === 'hrs') return v.toFixed(1) + 'h';
        if (format === 'pct') return v.toFixed(1) + '%';
        return String(v);
    };

    let deltaStr = '-', isGood = false, isNeutral = true;
    if (valB > 0) {
        const delta = ((valA - valB) / valB) * 100;
        deltaStr = (delta > 0 ? '+' : '') + delta.toFixed(1) + '%';
        isNeutral = Math.abs(delta) < 0.5;
        isGood = inverse ? delta < 0 : delta > 0;
    }

    return (
        <div className="bg-white rounded-2xl p-4 xl:p-5 shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition-shadow overflow-hidden w-full">
            <h4 className="text-[10px] xl:text-xs font-bold text-slate-500 uppercase tracking-wide min-h-[2.5rem] leading-tight mb-2 line-clamp-2">{title}</h4>
            <div className="flex justify-between items-end gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs xl:text-sm font-semibold text-slate-400 line-through mb-1 truncate">{formatVal(valB)}</span>
                    <span className="text-xl sm:text-2xl xl:text-3xl font-black text-slate-800 tracking-tight truncate">{formatVal(valA)}</span>
                </div>
                <div className={`px-2 py-1 rounded-full text-[10px] xl:text-xs font-bold whitespace-nowrap shrink-0
                    ${isNeutral ? 'bg-slate-100 text-slate-500' : (isGood ? 'bg-[#eaffe0] text-[#3f9b00]' : 'bg-red-100 text-red-600')}`}>
                    {deltaStr}
                </div>
            </div>
        </div>
    );
}
