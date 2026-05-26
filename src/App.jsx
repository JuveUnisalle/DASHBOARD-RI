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
    const [autoLoaded, setAutoLoaded] = useState(false); // Bandera para evitar re-cargas múltiples

    const emptyFilters = { CIUDAD: '', REGIONAL: '', RUTA: '', SUPERVISOR: '' };
    const [filtersA, setFiltersA] = useState(emptyFilters);
    const [filtersN, setFiltersN] = useState(emptyFilters);

    // --- Función centralizada para procesar el Excel en crudo ---
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

    // =========================================================
    //  NUEVO: Auto-carga del Excel usando Fetch al iniciar
    // =========================================================
    useEffect(() => {
        // Solo ejecuta si los scripts (XLSX) ya cargaron y no se ha auto-cargado antes
        if (!scriptsLoaded || autoLoaded) return;

        const fetchExcel = async () => {
            try {
                setIsLoading(true);
                setStatus('⏳ Auto-cargando datos...');

                // 📌 AQUI PONES LA RUTA DE TU EXCEL
                // Si pones el excel en la carpeta "public" de Vercel, la ruta es "/datos.xlsx"
                const fileUrl = '/datos.xlsx'; 
                
                // Añadimos '?t=' con la hora actual para FORZAR al navegador a no usar la caché
                const response = await fetch(fileUrl + '?t=' + new Date().getTime());
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status} (No encontrado)`);
                }

                const arrayBuffer = await response.arrayBuffer();
                processExcelBuffer(arrayBuffer);

                setStatus('✅ ¡Dashboard Auto-Alimentado!');
                setTimeout(() => setStatus('Datos listos'), 3000);
            } catch (err) {
                console.warn('Fallo auto-carga:', err);
                // Ahora mostrará el error exacto en la pantalla al lado del botón
                setStatus(`⚠️ Falló: ${err.message}`);
            } finally {
                setIsLoading(false);
                setAutoLoaded(true); // Evitar re-intentos
            }
        };

        fetchExcel();
    }, [scriptsLoaded, autoLoaded]);


    // --- lectura del Excel (Plan B / Manual) ---
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
//  PORTADA / PANTALLA DE BIENVENIDA
// =============================================================
function Portada({ onEnter, scriptsLoaded }) {
    return (
        <div className="min-h-screen relative overflow-hidden bg-slate-950 flex items-center justify-center p-6 font-sans">
            <style>{`
                @keyframes pf { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
                @keyframes pg { 0%,100% { opacity: .45; } 50% { opacity: .9; } }
                @keyframes pdash { to { stroke-dashoffset: 0; } }
            `}</style>

            {/* atmósfera */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgba(86,212,0,0.18), transparent 70%), radial-gradient(40% 45% at 82% 92%, rgba(86,212,0,0.10), transparent 70%)' }} />
            <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full blur-3xl" style={{ background: 'rgba(86,212,0,0.22)', animation: 'pg 5s ease-in-out infinite' }} />
            <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

            {/* contenido */}
            <div className="relative z-10 w-full max-w-3xl text-center flex flex-col items-center">
                <div className="bg-white rounded-xl px-4 py-2 shadow-lg" style={{ animation: 'pf .6s ease-out both' }}>
                    <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Haleon_logo.svg/1280px-Haleon_logo.svg.png" alt="Haleon" className="h-7" />
                </div>

                {/* ruta decorativa */}
                <svg viewBox="0 0 320 90" className="w-72 mt-10" style={{ animation: 'pf .7s ease-out both' }}>
                    <path d="M20 70 C 80 70, 80 25, 140 25 S 240 70, 300 30" fill="none" stroke="#56D400" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" style={{ strokeDashoffset: 220, animation: 'pdash 2s ease-out .4s forwards' }} />
                    {[[20, 70], [140, 25], [300, 30]].map(([cx, cy], i) => (
                        <g key={i}>
                            <circle cx={cx} cy={cy} r="9" fill="#56D400" opacity="0.25" />
                            <circle cx={cx} cy={cy} r="4.5" fill="#56D400" />
                        </g>
                    ))}
                </svg>

                <h1 className="mt-8 text-4xl md:text-5xl font-black text-white tracking-tight leading-tight" style={{ animation: 'pf .8s ease-out both' }}>
                    Comparativa de Rutas
                </h1>
                <p className="mt-1 text-2xl md:text-3xl font-bold text-[#56D400]" style={{ animation: 'pf .9s ease-out both' }}>
                    Antes <span className="text-slate-500 font-normal">vs.</span> Después
                </p>
                <p className="mt-5 max-w-xl text-slate-400 text-base md:text-lg leading-relaxed" style={{ animation: 'pf 1s ease-out both' }}>
                    Visualiza, filtra y compara dos propuestas de optimización de rutas:
                    eficiencia, ocupación laboral y cobertura geoespacial de cada usuario.
                </p>

                <div className="mt-8 flex flex-wrap justify-center gap-3" style={{ animation: 'pf 1.1s ease-out both' }}>
                    {['Filtros independientes', 'Mapas por usuario', 'KPIs comparativos'].map((t) => (
                        <span key={t} className="px-4 py-2 rounded-full text-sm font-medium text-slate-200 bg-white/5 border border-white/10 backdrop-blur">
                            {t}
                        </span>
                    ))}
                </div>

                <button
                    onClick={onEnter}
                    className="mt-10 px-9 py-4 rounded-xl bg-[#56D400] text-black font-extrabold text-lg shadow-[0_10px_40px_-10px_rgba(86,212,0,0.7)] hover:scale-105 hover:shadow-[0_16px_50px_-10px_rgba(86,212,0,0.9)] transition-all duration-200"
                    style={{ animation: 'pf 1.2s ease-out both' }}
                >
                    Entrar al Dashboard →
                </button>
                <p className="mt-4 text-xs text-slate-500" style={{ animation: 'pf 1.3s ease-out both' }}>
                    {scriptsLoaded ? 'Entorno listo · carga automática activada' : 'Preparando entorno…'}
                </p>
            </div>

            <div className="absolute bottom-4 left-0 right-0 text-center text-[11px] text-slate-600">
                Haleon · Análisis de Rutas
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
