import React, { useState, useEffect, useRef, useMemo } from 'react';

// =============================================================
//  UTILIDADES
// =============================================================
const norm = (v) => String(v ?? '').trim().toUpperCase();

// Parseo numérico tolerante a comas decimales / miles (Excel en español)
const parseNum = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
};

// Coordenadas: aceptan número o texto con coma decimal (ej. "4,5399684")
const parseCoord = (v) => {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v === undefined || v === null) return NaN;
    let s = String(v).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
};

const parseIntSafe = (v) => {
    if (typeof v === 'number') return Math.round(v);
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) ? n : 0;
};

// Diccionario de columnas. Cubre AMBOS archivos (anterior y nuevo); como cada
// fila solo trae uno de los alias, get() devuelve el primero presente.
const F = {
    lat:        ['LATITUD', 'LATITUD ', 'Latitud', 'LAT'],
    lng:        ['LONGITUD', 'LONGITUD ', 'Longitud', 'LNG', 'LON'],
    ruta:       ['RUTA', 'RUTA ', 'Ruta'],
    ciudad:     ['CIUDAD', 'CIUDAD ', 'Ciudad'],
    regional:   ['REGIONAL VYM', 'REGIONAL', 'REGIONAL ', 'REGION', 'REGIÓN', 'Regional'],
    supervisor: ['SUPERVISOR', 'NOMBRE SUPERVISOR ', 'NOMBRE SUPERVISOR', 'USUARIO SUPERVISOR', 'Supervisor'],
    pdv:        ['PUNTO DE VENTA', 'PUNTO DE VENTA ', 'Punto de Venta'],
    codigo:     ['Codigo  PDV', 'Codigo PDV', 'CODIGO PDV', 'Código PDV', 'CÓDIGO PDV'],
    cadena:     ['CRUCE', 'CADENA', 'SUBCADENA', 'Cadena'],
    frecuencia: ['FRECUENCIA', 'FRECUENCIA ', 'Frecuencia'],
    hrs:        ['TOTAL HRS B', 'Total Hrs B', 'HRS B', 'HRS', 'Hrs'],
    desp:       ['DESPLAZAMIENTO', 'TOTAL TIEMPO DEZPLASAMIENTO', 'TOTAL TIEMPO DESPLAZAMIENTO', 'TIEMPO DESPLAZAMIENTO', 'Desplazamiento'],
};

const get = (row, keys) => {
    if (!row) return undefined;
    for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k];
    }
    return undefined;
};

// Fallback de color (rutas sin entrada en la paleta)
const stringToColor = (str) => {
    if (!str) return '#94a3b8';
    str = String(str);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    let color = '#';
    for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).substr(-2);
    return color;
};

// Paleta estable y bien diferenciada para N usuarios/rutas
const buildColorMap = (routes) => {
    const sorted = [...new Set(routes.map((r) => String(r).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const n = sorted.length || 1;
    const map = {};
    sorted.forEach((r, i) => {
        const hue = Math.round((i * 360 / n + (i % 2) * 180) % 360);
        const sat = 62 + (i % 3) * 9;
        const light = 44 + (i % 4) * 6;
        map[r] = `hsl(${hue}, ${sat}%, ${light}%)`;
    });
    return map;
};

// ¿La fila cumple los filtros indicados?
const rowMatches = (row, f) => {
    if (f.CIUDAD && norm(get(row, F.ciudad)) !== norm(f.CIUDAD)) return false;
    if (f.REGIONAL && norm(get(row, F.regional)) !== norm(f.REGIONAL)) return false;
    if (f.RUTA && norm(get(row, F.ruta)) !== norm(f.RUTA)) return false;
    if (f.SUPERVISOR && norm(get(row, F.supervisor)) !== norm(f.SUPERVISOR)) return false;
    return true;
};

const FIELD_KEYS = { CIUDAD: F.ciudad, REGIONAL: F.regional, RUTA: F.ruta, SUPERVISOR: F.supervisor };

// Opciones de un filtro (en cascada con los demás filtros activos del MISMO lado)
const optionsFor = (baseRows, filters, field) => {
    const others = { ...filters, [field]: '' };
    const set = new Set();
    (baseRows || []).filter((r) => rowMatches(r, others)).forEach((r) => {
        const v = get(r, FIELD_KEYS[field]);
        if (v !== undefined && String(v).trim() !== '') set.add(String(v).trim());
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
};

// Aplica filtros a un lado (base + desplazamiento) de forma independiente
const filterSide = (base, desp, filters) => {
    const anyActive = Object.values(filters).some(Boolean);
    if (!anyActive) return { base: base || [], desp: desp || [] };
    const b = (base || []).filter((r) => rowMatches(r, filters));
    const allowed = new Set(b.map((r) => norm(get(r, F.ruta))).filter(Boolean));
    const d = (desp || []).filter((r) => allowed.has(norm(get(r, F.ruta))));
    return { base: b, desp: d };
};

// Resumen por ruta (idéntico para ambos lados). El desplazamiento sale de la
// hoja dedicada si existe; si no, de la columna DESPLAZAMIENTO de la base.
const computeRouteSummary = (baseRows, despRows, colorMap) => {
    const grouped = {};
    (baseRows || []).forEach((row) => {
        const r = String(get(row, F.ruta) ?? '').trim();
        if (!r) return;
        if (!grouped[r]) grouped[r] = { hrsServ: 0, desp: 0 };
        grouped[r].hrsServ += parseNum(get(row, F.hrs));
    });
    const despSource = (despRows && despRows.length) ? despRows : baseRows;
    (despSource || []).forEach((row) => {
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

// Clasifica cada hoja del Excel: lado (anterior/nuevo) y si es hoja de desplazamiento.
// Usa el nombre y, como respaldo, las columnas (más robusto).
const classifySheet = (name, rows) => {
    const U = String(name).toUpperCase();
    const keys = rows && rows[0] ? Object.keys(rows[0]).map((k) => k.toUpperCase().trim()) : [];
    const hasKey = (s) => keys.some((k) => k.includes(s));
    const nameHasDesp = U.includes('DEZPLASAMIENTO') || U.includes('DESPLAZAMIENTO');
    const isDespSheet = nameHasDesp && (hasKey('TIEMPO') || keys.length <= 6);

    let side = null;
    if (U.includes('NUEV') || U.includes('ACTUAL') || U.includes('OPTIM')) side = 'nuevo';
    else if (U.includes('VIEJ') || U.includes('ANTERIOR') || U.includes('ANTES')) side = 'anterior';
    if (!side) {
        if (hasKey('REGIONAL VYM') || hasKey('CRUCE') || hasKey('BASE/CORRERIA') || hasKey('CIUDAD BASE CLIENTE')) side = 'nuevo';
        else if (hasKey('SUBCADENA') || hasKey('CANAL') || hasKey('NOMBRE USUARIO') || hasKey('USUARIO SUPERVISOR')) side = 'anterior';
    }
    return { side, isDespSheet };
};

// =============================================================
//  MAPA (Leaflet) — cada lado usa SUS PROPIAS coordenadas
// =============================================================
const MapComponent = ({ data, colorMap }) => {
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
            const lat = parseCoord(get(row, F.lat));
            const lng = parseCoord(get(row, F.lng));
            if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
            const ruta = String(get(row, F.ruta) ?? '').trim();
            const color = colorMap[ruta] || stringToColor(ruta);
            lats.push(lat); lngs.push(lng);
            window.L.circleMarker([lat, lng], {
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
    }, [data, colorMap]);

    return <div ref={mapRef} className="w-full h-full bg-slate-100 z-0 relative" />;
};

// =============================================================
//  BARRA DE FILTROS (independiente por lado)
// =============================================================
function FilterBar({ title, subtitle, accent = '', baseRows, filters, setFilters }) {
    const fields = ['CIUDAD', 'REGIONAL', 'RUTA', 'SUPERVISOR'];
    const active = Object.values(filters).filter(Boolean).length;
    const disabled = !baseRows || baseRows.length === 0;
    return (
        <div className={`bg-white rounded-2xl p-4 shadow-sm border border-slate-200 ${accent}`}>
            <div className="flex items-center justify-between mb-3 gap-2">
                <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-800 truncate">{title}</h4>
                    {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
                </div>
                <button
                    onClick={() => setFilters({ CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' })}
                    disabled={active === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                    Limpiar {active > 0 ? `(${active})` : ''}
                </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {fields.map((field) => (
                    <div key={field} className="flex flex-col gap-1 min-w-0">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{field}</label>
                        <select
                            value={filters[field]}
                            disabled={disabled}
                            onChange={(e) => setFilters((f) => ({ ...f, [field]: e.target.value }))}
                            className="border border-slate-300 rounded-lg px-2 py-2 text-xs text-slate-700 bg-white focus:ring-2 focus:ring-[#56D400] focus:border-[#56D400] outline-none disabled:bg-slate-50 disabled:text-slate-300"
                        >
                            <option value="">Todas</option>
                            {optionsFor(baseRows, filters, field).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
            </div>
        </div>
    );
}

// =============================================================
//  COMPONENTE PRINCIPAL
// =============================================================
function Dashboard({ scriptsLoaded, onHome }) {
    const [status, setStatus] = useState('Esperando archivo Excel...');
    const [isLoading, setIsLoading] = useState(false);
    const [dataState, setDataState] = useState({ bNuevas: [], dNuevas: [], bViejas: [], dViejas: [] });
    const [autoLoaded, setAutoLoaded] = useState(false); // Evita re-cargas múltiples

    const emptyFilters = { CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' };
    const [filtersA, setFiltersA] = useState(emptyFilters); // Propuesta ANTERIOR
    const [filtersN, setFiltersN] = useState(emptyFilters); // Propuesta NUEVA

    // --- Procesa el Excel en crudo (centralizado) ---
    const processExcelBuffer = (buffer) => {
        const wb = window.XLSX.read(buffer, { type: 'array' });
        const raw = { bNuevas: [], dNuevas: [], bViejas: [], dViejas: [] };
        wb.SheetNames.forEach((sn) => {
            const sd = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
            if (!sd.length) return;
            const { side, isDespSheet } = classifySheet(sn, sd);
            if (side === 'nuevo') {
                if (isDespSheet) raw.dNuevas = raw.dNuevas.concat(sd);
                else raw.bNuevas = raw.bNuevas.concat(sd);
            } else if (side === 'anterior') {
                if (isDespSheet) raw.dViejas = raw.dViejas.concat(sd);
                else raw.bViejas = raw.bViejas.concat(sd);
            }
        });
        setDataState(raw);
        setFiltersA(emptyFilters);
        setFiltersN(emptyFilters);
    };

    // --- Auto-carga del Excel (desde /datos.xlsx en la carpeta public) ---
    useEffect(() => {
        if (!scriptsLoaded || autoLoaded) return;
        const fetchExcel = async () => {
            try {
                setIsLoading(true);
                setStatus('⏳ Auto-cargando datos...');
                // 📌 Coloca tu Excel en /public/datos.xlsx
                const fileUrl = '/datos.xlsx';
                const response = await fetch(fileUrl + '?t=' + new Date().getTime());
                if (!response.ok) throw new Error(`HTTP ${response.status} (No encontrado)`);
                const arrayBuffer = await response.arrayBuffer();
                processExcelBuffer(arrayBuffer);
                setStatus('✅ ¡Dashboard Auto-Alimentado!');
                setTimeout(() => setStatus('Datos listos'), 3000);
            } catch (err) {
                console.warn('Fallo auto-carga:', err);
                setStatus(`⚠️ Falló: ${err.message}`);
            } finally {
                setIsLoading(false);
                setAutoLoaded(true);
            }
        };
        fetchExcel();
    }, [scriptsLoaded, autoLoaded]);

    // --- lectura del Excel (manual / Plan B) ---
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !window.XLSX) return;
        setIsLoading(true);
        setStatus('⏳ Leyendo archivo Excel...');
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                processExcelBuffer(new Uint8Array(evt.target.result));
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

    // --- paletas de color INDEPENDIENTES por lado ---
    const colorMapA = useMemo(
        () => buildColorMap((dataState.bViejas || []).map((r) => get(r, F.ruta)).filter(Boolean)),
        [dataState]
    );
    const colorMapN = useMemo(
        () => buildColorMap((dataState.bNuevas || []).map((r) => get(r, F.ruta)).filter(Boolean)),
        [dataState]
    );

    // --- datos filtrados de forma INDEPENDIENTE ---
    const filteredA = useMemo(() => filterSide(dataState.bViejas, dataState.dViejas, filtersA), [dataState, filtersA]);
    const filteredN = useMemo(() => filterSide(dataState.bNuevas, dataState.dNuevas, filtersN), [dataState, filtersN]);

    // --- KPIs (sin mezclar datos entre archivos) ---
    const kpis = useMemo(() => {
        const bV = filteredA.base, dV = filteredA.desp, bN = filteredN.base, dN = filteredN.desp;
        const despSrcV = dV.length ? dV : bV;
        const despSrcN = dN.length ? dN : bN;
        return {
            pdvViejas: bV.length, pdvNuevas: bN.length,
            cuposViejas: new Set(bV.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            cuposNuevas: new Set(bN.map((r) => get(r, F.ruta)).filter(Boolean)).size,
            despViejas: despSrcV.reduce((s, r) => s + parseNum(get(r, F.desp)), 0),
            despNuevas: despSrcN.reduce((s, r) => s + parseNum(get(r, F.desp)), 0),
            hrsViejas: bV.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0),
            hrsNuevas: bN.reduce((s, r) => s + parseNum(get(r, F.hrs)), 0),
            frecViejas: bV.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0),
            frecNuevas: bN.reduce((s, r) => s + parseIntSafe(get(r, F.frecuencia)), 0),
        };
    }, [filteredA, filteredN]);

    const summaryViejas = useMemo(() => computeRouteSummary(filteredA.base, filteredA.desp, colorMapA), [filteredA, colorMapA]);
    const summaryNuevas = useMemo(() => computeRouteSummary(filteredN.base, filteredN.desp, colorMapN), [filteredN, colorMapN]);

    // --- fila de tabla de resumen por ruta (compartida) ---
    const RouteRow = ({ s }) => {
        const over = s.pct > 100;
        const warn = s.pct > 85 && s.pct <= 100;
        const barColor = over ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-[#56D400]';
        return (
            <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="p-3 text-sm font-medium text-slate-800">
                    <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="truncate">{s.ruta}</span>
                    </span>
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

    // --- directorio general (rutas nuevas, respeta el filtro del lado nuevo) ---
    const renderTableGeneral = () => {
        const rows = filteredN.base || [];
        if (rows.length === 0) return emptyRow(7, 'Esperando archivo Excel para mostrar el detalle de puntos de venta...');
        return rows.slice(0, 200).map((row, idx) => (
            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="p-3 text-sm text-slate-600">{String(get(row, F.codigo) ?? '-')}</td>
                <td className="p-3 text-sm font-medium text-slate-800">{String(get(row, F.cadena) ?? '-')}</td>
                <td className="p-3 text-sm text-slate-600 truncate max-w-xs">{String(get(row, F.pdv) ?? '-')}</td>
                <td className="p-3 text-sm text-slate-600">{String(get(row, F.ciudad) ?? '-')}</td>
                <td className="p-3 text-sm">
                    <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorMapN[String(get(row, F.ruta) ?? '').trim()] || stringToColor(get(row, F.ruta)) }} />
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
                    <div className="flex flex-col items-start">
                        <button onClick={onHome} className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors mb-1">
                            ← Portada
                        </button>
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

                {/* KPIS (comparan cada lado según su propio filtro) */}
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

                {/* DOS COLUMNAS INDEPENDIENTES */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* ===== LADO IZQUIERDO: ANTERIOR ===== */}
                    <div className="flex flex-col gap-4">
                        <FilterBar
                            title="Filtros · Propuesta Anterior"
                            subtitle="Aplican solo a esta propuesta"
                            baseRows={dataState.bViejas}
                            filters={filtersA}
                            setFilters={setFiltersA}
                        />
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Anterior <span className="text-slate-400 font-normal">(No Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filteredA.base} colorMap={colorMapA} />
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

                    {/* ===== LADO DERECHO: OPTIMIZADA ===== */}
                    <div className="flex flex-col gap-4">
                        <FilterBar
                            title="Filtros · Propuesta Optimizada"
                            subtitle="Aplican solo a esta propuesta"
                            accent="border-t-4 border-t-[#56D400]"
                            baseRows={dataState.bNuevas}
                            filters={filtersN}
                            setFilters={setFiltersN}
                        />
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 h-[500px] flex flex-col border-t-4 border-t-[#56D400]">
                            <h3 className="text-lg font-bold text-slate-800 mb-3">Visualización Actual <span className="text-[#56D400]">(Optimizada)</span></h3>
                            <div className="flex-grow rounded-xl overflow-hidden bg-slate-100 relative z-0">
                                {scriptsLoaded
                                    ? <MapComponent data={filteredN.base} colorMap={colorMapN} />
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

                {/* DIRECTORIO GENERAL (rutas nuevas) */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col max-h-[620px]">
                    <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0 flex flex-wrap gap-2 justify-between items-end">
                        <h3 className="text-xl font-bold text-slate-800">Directorio de Puntos de Venta (Rutas Nuevas)</h3>
                        <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                            Mostrando {Math.min(200, (filteredN.base || []).length)} de {(filteredN.base || []).length}
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

// =============================================================
//  PORTADA / PANTALLA DE BIENVENIDA (con mapa de Colombia)
// =============================================================
const PORTADA_CIUDADES = [
    { n: 'Bogotá', lat: 4.7110, lng: -74.0721, hub: true },
    { n: 'Medellín', lat: 6.2442, lng: -75.5812, hub: true },
    { n: 'Cali', lat: 3.4516, lng: -76.5320, hub: true },
    { n: 'Barranquilla', lat: 10.9685, lng: -74.7813, hub: true },
    { n: 'Cartagena', lat: 10.3910, lng: -75.4794 },
    { n: 'Bucaramanga', lat: 7.1193, lng: -73.1227 },
    { n: 'Cúcuta', lat: 7.8939, lng: -72.5078 },
    { n: 'Ibagué', lat: 4.4389, lng: -75.2322 },
    { n: 'Armenia', lat: 4.5339, lng: -75.6811 },
    { n: 'Pereira', lat: 4.8133, lng: -75.6961 },
    { n: 'Manizales', lat: 5.0703, lng: -75.5138 },
    { n: 'Santa Marta', lat: 11.2408, lng: -74.1990 },
    { n: 'Villavicencio', lat: 4.1420, lng: -73.6266 },
    { n: 'Neiva', lat: 2.9273, lng: -75.2819 },
    { n: 'Pasto', lat: 1.2136, lng: -77.2811 },
];
// Rutas decorativas (secuencias de índices de ciudad)
const PORTADA_RUTAS = [
    [0, 7, 8, 9, 10, 2, 14],
    [0, 5, 6],
    [1, 3, 4, 11],
    [0, 1],
    [0, 12, 13],
];

function PortadaMap() {
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    useEffect(() => {
        if (!window.L || !mapRef.current || mapInstance.current) return;
        const map = window.L.map(mapRef.current, {
            zoomControl: false, attributionControl: false, dragging: false,
            scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
            keyboard: false, touchZoom: false, zoomSnap: 0.25,
        });
        mapInstance.current = map;
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

        PORTADA_RUTAS.forEach((seq) => {
            const pts = seq.map((i) => [PORTADA_CIUDADES[i].lat, PORTADA_CIUDADES[i].lng]);
            window.L.polyline(pts, { color: '#56D400', weight: 2, opacity: 0.65, dashArray: '4 10', lineCap: 'round', className: 'pf-route', interactive: false }).addTo(map);
        });

        PORTADA_CIUDADES.forEach((c) => {
            if (c.hub) {
                window.L.circleMarker([c.lat, c.lng], { radius: 13, stroke: false, fillColor: '#56D400', fillOpacity: 0.18, className: 'pf-halo', interactive: false }).addTo(map);
            }
            window.L.circleMarker([c.lat, c.lng], { radius: c.hub ? 5 : 3, color: '#ffffff', weight: c.hub ? 1.5 : 1, fillColor: '#56D400', fillOpacity: 0.95, interactive: false }).addTo(map);
            if (c.hub) {
                window.L.marker([c.lat, c.lng], { interactive: false, icon: window.L.divIcon({ className: 'pf-label', html: `<span>${c.n}</span>`, iconSize: [0, 0] }) }).addTo(map);
            }
        });

        const bounds = window.L.latLngBounds(PORTADA_CIUDADES.map((c) => [c.lat, c.lng]));
        const fit = () => { map.invalidateSize(); map.fitBounds(bounds, { padding: [60, 60] }); };
        fit();
        window.addEventListener('resize', fit);
        map._pfFit = fit;

        return () => {
            window.removeEventListener('resize', map._pfFit);
            map.remove();
            mapInstance.current = null;
        };
    }, []);
    return <div ref={mapRef} className="absolute inset-0 w-full h-full" style={{ background: '#0b1120' }} />;
}

function Portada({ onEnter, scriptsLoaded }) {
    return (
        <div className="min-h-screen relative overflow-hidden bg-slate-950 font-sans">
            <style>{`
                @keyframes pf { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
                @keyframes pfRoute { to { stroke-dashoffset: -56; } }
                @keyframes pfHalo { 0%,100% { opacity: .12; } 50% { opacity: .42; } }
                .pf-route { animation: pfRoute 1.6s linear infinite; }
                .pf-halo { animation: pfHalo 3s ease-in-out infinite; }
                .pf-label span {
                    position: absolute; transform: translate(10px, -9px);
                    font-size: 11px; font-weight: 600; letter-spacing: .02em;
                    color: rgba(226,232,240,0.85); white-space: nowrap;
                    text-shadow: 0 1px 4px rgba(0,0,0,0.95); pointer-events: none;
                }
                .leaflet-container { background: #0b1120 !important; }
            `}</style>

            {/* MAPA DE FONDO */}
            {scriptsLoaded ? <PortadaMap /> : <div className="absolute inset-0" style={{ background: '#0b1120' }} />}

            {/* velos para legibilidad */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(2,6,23,0.96) 0%, rgba(2,6,23,0.85) 38%, rgba(2,6,23,0.35) 70%, rgba(2,6,23,0.12) 100%)' }} />
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(2,6,23,0.7) 0%, transparent 22%, transparent 74%, rgba(2,6,23,0.88) 100%)' }} />
            <div className="absolute -top-32 -left-24 w-[480px] h-[480px] rounded-full blur-3xl pointer-events-none" style={{ background: 'rgba(86,212,0,0.16)' }} />

            {/* CONTENIDO */}
            <div className="relative z-10 min-h-screen flex flex-col">
                {/* top bar */}
                <div className="flex items-center justify-between px-6 md:px-12 py-6" style={{ animation: 'pf .5s ease-out both' }}>
                    <div className="bg-white rounded-lg px-3 py-1.5 shadow-lg">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Haleon_logo.svg/1280px-Haleon_logo.svg.png" alt="Haleon" className="h-6" />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                        <span className="w-2 h-2 rounded-full bg-[#56D400]" style={{ boxShadow: '0 0 10px #56D400' }} />
                        {scriptsLoaded ? 'Entorno listo · datos en vivo' : 'Preparando entorno…'}
                    </div>
                </div>

                {/* hero */}
                <div className="flex-1 flex items-center px-6 md:px-12">
                    <div className="max-w-2xl">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold mb-6"
                            style={{ background: 'rgba(86,212,0,0.10)', borderColor: 'rgba(86,212,0,0.30)', color: '#9bf06a', animation: 'pf .7s ease-out both' }}>
                            <span className="w-1.5 h-1.5 rounded-full bg-[#56D400]" />
                            OPTIMIZACIÓN DE RUTAS COMERCIALES
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-[1.05]" style={{ animation: 'pf .8s ease-out both' }}>
                            Comparativa de Rutas
                            <span className="block text-[#56D400]">Antes <span className="text-slate-500 font-bold">vs.</span> Después</span>
                        </h1>
                        <p className="mt-6 text-lg md:text-xl text-slate-300 leading-relaxed max-w-xl" style={{ animation: 'pf .95s ease-out both' }}>
                            Analiza, filtra y compara dos propuestas de cobertura comercial a nivel nacional:
                            eficiencia, ocupación laboral y distribución geoespacial de cada usuario.
                        </p>

                        <div className="mt-7 flex flex-wrap gap-3" style={{ animation: 'pf 1.1s ease-out both' }}>
                            {['Filtros independientes', 'Mapas por usuario', 'KPIs comparativos'].map((t) => (
                                <span key={t} className="px-4 py-2 rounded-full text-sm font-medium text-slate-200 bg-white/5 border border-white/10 backdrop-blur">
                                    {t}
                                </span>
                            ))}
                        </div>

                        <div className="mt-10 flex flex-wrap items-center gap-4" style={{ animation: 'pf 1.25s ease-out both' }}>
                            <button
                                onClick={onEnter}
                                className="px-9 py-4 rounded-xl bg-[#56D400] text-black font-extrabold text-lg shadow-[0_10px_40px_-10px_rgba(86,212,0,0.7)] hover:scale-105 hover:shadow-[0_16px_55px_-10px_rgba(86,212,0,0.95)] transition-all duration-200"
                            >
                                Entrar al Dashboard →
                            </button>
                            <span className="text-sm text-slate-400">Cobertura nacional · Colombia</span>
                        </div>
                    </div>
                </div>

                {/* footer mini-stats */}
                <div className="px-6 md:px-12 py-6 border-t border-white/5" style={{ animation: 'pf 1.4s ease-out both' }}>
                    <div className="flex flex-wrap items-end gap-8 md:gap-12">
                        {[['2', 'Propuestas comparadas'], ['Antes / Después', 'Escenarios'], ['Tiempo real', 'Filtros y mapas']].map(([big, small]) => (
                            <div key={small}>
                                <div className="text-xl md:text-2xl font-black text-white">{big}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{small}</div>
                            </div>
                        ))}
                        <div className="ml-auto text-[11px] text-slate-600">Haleon · Análisis de Rutas</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// =============================================================
//  RAÍZ: muestra la portada y, al entrar, el dashboard
// =============================================================
export default function App() {
    const [view, setView] = useState('portada');
    const [scriptsLoaded, setScriptsLoaded] = useState(false);

    // Precarga Leaflet + SheetJS mientras el usuario está en la portada
    useEffect(() => {
        const loadScript = (src) => new Promise((resolve) => {
            if ([...document.scripts].some((s) => s.src === src)) { resolve(); return; }
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
        ]).then(() => setScriptsLoaded(true));
    }, []);

    if (view === 'portada') {
        return <Portada onEnter={() => setView('dashboard')} scriptsLoaded={scriptsLoaded} />;
    }
    return <Dashboard scriptsLoaded={scriptsLoaded} onHome={() => setView('portada')} />;
}
