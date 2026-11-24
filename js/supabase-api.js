const jsonResponse = (body, status = 200, headers = {}) => new Response(
    body === null ? null : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } }
);

const noContent = () => new Response(null, { status: 204 });
const errorResponse = (error, status = 400) => jsonResponse({ message: error?.message || String(error) }, status);
const round3 = value => Math.round(Number(value) * 1000) / 1000;
const originalFetch = window.fetch.bind(window);
let sectionsPromise;

const loadSectionFeatures = async () => {
    sectionsPromise ??= originalFetch("./sections.geojson").then(response => {
        if (!response.ok) throw new Error("無法載入地籍段界資料。");
        return response.json();
    }).then(data => data.features || []);
    return sectionsPromise;
};

const pointInRing = (longitude, latitude, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > latitude) !== (yj > latitude)) &&
            longitude < (xj - xi) * (latitude - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};

const pointInPolygon = (longitude, latitude, rings) =>
    rings.length > 0 && pointInRing(longitude, latitude, rings[0]) &&
    !rings.slice(1).some(ring => pointInRing(longitude, latitude, ring));

async function findSectionFeature(longitude, latitude) {
    const features = await loadSectionFeatures();
    return features.find(item => {
        const geometry = item.geometry;
        if (geometry?.type === "Polygon") return pointInPolygon(longitude, latitude, geometry.coordinates);
        if (geometry?.type === "MultiPolygon") return geometry.coordinates.some(polygon => pointInPolygon(longitude, latitude, polygon));
        return false;
    });
}

async function findSectionName(longitude, latitude) {
    const feature = await findSectionFeature(longitude, latitude);
    return feature?.properties?.fullName || feature?.properties?.sectionName || null;
}

const pointFromRow = row => ({
    id: row.id,
    pointName: row.point_name,
    pointType: row.point_type,
    status: row.status,
    sectionName: row.section_name,
    x: Number(row.x),
    y: Number(row.y),
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by,
    updatedByUserId: row.updated_by,
    createdByName: row.created_by_name,
    updatedByName: row.updated_by_name
});

const noteFromRow = row => ({
    id: row.id,
    emoji: row.emoji,
    remark: row.remark,
    x: Number(row.x),
    y: Number(row.y),
    longitude: Number(row.longitude),
    latitude: Number(row.latitude),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const historyFromRow = row => ({
    id: row.id,
    surveyPointId: row.survey_point_id,
    action: row.action,
    userDisplayName: row.user_display_name,
    sourceFileName: row.source_file_name,
    createdAt: row.created_at
});

function coordinates(x, y) {
    const [longitude, latitude] = window.proj4("EPSG:3826", "EPSG:4326", [Number(x), Number(y)]);
    return { longitude, latitude };
}

async function parseCt2(file) {
    if (!file) throw new Error("請選擇要匯入的 .ct2 檔案。");
    if (!file.name.toLowerCase().endsWith(".ct2")) throw new Error("目前僅支援 .ct2 檔案。");
    if (file.size > 10 * 1024 * 1024) throw new Error("檔案不可超過 10 MB。");

    const text = await file.text();
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const items = [];
    let totalCount = 0;
    let validCount = 0;
    let skippedCount = 0;

    lines.slice(1).forEach((rawLine, index) => {
        const lineNumber = index + 2;
        const line = rawLine.replace(/\t/g, " ").trim();
        if (!line) return;
        totalCount++;
        const combined = line.match(/^(\S+)\s+(\d{7}\.\d{3})(\d{6}\.\d{3})\s*$/);
        const separated = line.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/);
        const match = combined || separated;
        if (!match) {
            items.push({ lineNumber, pointName: "", status: "error", message: "資料格式不正確。" });
            skippedCount++;
            return;
        }
        const pointName = match[1].trim();
        const y = round3(match[2]);
        const x = round3(match[3]);
        if (!pointName || x <= 0 || y <= 0) {
            items.push({ lineNumber, pointName, status: "error", message: "點名或座標不正確。" });
            skippedCount++;
            return;
        }
        items.push({
            lineNumber, pointName, x, y,
            pointType: pointName.toUpperCase().startsWith("Q") ? "supplement" : "control",
            status: "valid", message: "格式正確"
        });
        validCount++;
    });

    return { totalCount, validCount, skippedCount, importedCount: 0, items };
}


async function readSurveyText(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("big5", { fatal: true }).decode(bytes); }
}

async function parseQPointFile(file, format) {
    if (!file) throw new Error("請選擇點位檔案。");
    if (file.size > 10 * 1024 * 1024) throw new Error("檔案不可超過 10 MB。");
    const lines = (await readSurveyText(file)).replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    const items = [], seen = new Set();
    let validCount = 0, skippedCount = 0, ignoredCount = 0, errorCount = 0, duplicateCount = 0;
    lines.forEach((raw, index) => {
        const line = raw.replace(/\u0000/g, "").trim();
        if (!line) return;
        let fields;
        if (format === "b90") {
            const record = line.match(/^(?:測\s*站|標\s*定\s*點|施\s*測\s*點)\s*[:：]\s*(.*)$/);
            if (!record) return;
            fields = record[1].trim().split(/\s+/);
        } else {
            fields = line.includes(",") ? line.split(",").map(value => value.trim()) : line.split(/\s+/);
            // A column heading is not a point record.
            if (/^(?:點名|點號|point_?name|name)$/i.test(fields[0])) return;
        }
        const unquote = value => String(value || "").replace(/^"(.*)"$/, "$1").trim();
        const pointName = unquote(fields[0]);
        const item = { lineNumber: index + 1, pointName, pointType: "supplement" };
        if (!/^Q/i.test(pointName)) {
            items.push({ ...item, pointType: null, status: "ignored", message: "非 Q 開頭，略過。" });
            ignoredCount++; skippedCount++; return;
        }
        const yText = unquote(fields[1]), xText = unquote(fields[2]);
        const numeric = /^\+?\d+(?:\.\d+)?$/;
        const x = round3(xText), y = round3(yText);
        if (!numeric.test(xText) || !numeric.test(yText) || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
            items.push({ ...item, status: "error", message: "座標格式錯誤，應為點名、Y、X。" });
            errorCount++; skippedCount++; return;
        }
        // Same name and millimetre-rounded coordinates are one point within this file.
        const key = JSON.stringify([pointName.toUpperCase(), x, y]);
        if (seen.has(key)) {
            items.push({ ...item, x, y, status: "duplicate", message: "檔案內相同點名與座標重複，略過。" });
            duplicateCount++; skippedCount++; return;
        }
        seen.add(key);
        items.push({ ...item, x, y, status: "valid", message: "Q 開頭，將匯入為補點。" });
        validCount++;
    });
    return { totalCount: items.length, validCount, skippedCount, ignoredCount, errorCount,
        duplicateCount, importedCount: 0, sourceFormat: format, items };
}

async function parsePointFile(file) {
    const format = file?.name.split(".").pop().toLowerCase();
    if (format === "ct2") return parseCt2(file);
    if (format === "b90" || format === "txt") return parseQPointFile(file, format);
    throw new Error("請選擇 .ct2、.b90 或 .txt 檔案。");
}

async function fetchAllSurveyPoints(supabase, columns = "*", filter = query => query) {
    const pageSize = 500;
    const rows = [];
    let lastId = null;

    while (true) {
        let query = supabase
            .from("survey_points")
            .select(columns)
            .order("id", { ascending: true })
            .limit(pageSize);

        query = filter(query);
        if (lastId !== null) {
            query = query.gt("id", lastId);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;

        rows.push(...data);
        lastId = data[data.length - 1].id;
    }

    return rows;
}


async function pointsInMetricBuffer(supabase, bounds, contains) {
    const rows = await fetchAllSurveyPoints(supabase, "*", query => query
        .gte("x", bounds.minX - 200.001).lte("x", bounds.maxX + 200.001)
        .gte("y", bounds.minY - 200.001).lte("y", bounds.maxY + 200.001));
    return rows.filter(row => contains(Number(row.x), Number(row.y))).map(pointFromRow);
}

function segmentDistanceSquared(x, y, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length)) : 0;
    return (x - a[0] - t * dx) ** 2 + (y - a[1] - t * dy) ** 2;
}

async function parcelBufferPoints(supabase, geometry) {
    const rawPolygons = geometry?.type === "Polygon" ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon" ? geometry.coordinates : null;
    if (!rawPolygons?.length) throw new Error("地號缺少有效的土地範圍。");
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const polygons = rawPolygons.map(polygon => {
        if (!Array.isArray(polygon) || !polygon.length) throw new Error("土地圖形不正確。");
        return polygon.map(ring => {
            if (!Array.isArray(ring) || ring.length < 4) throw new Error("土地邊界不正確。");
            return ring.map(coordinate => {
                const [longitude, latitude] = coordinate;
                if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
                    Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error("土地座標不正確。");
                const [x, y] = window.proj4("EPSG:4326", "EPSG:3826", [longitude, latitude]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("土地座標轉換失敗。");
                bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
                bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
                return [x, y];
            });
        });
    });
    return pointsInMetricBuffer(supabase, bounds, (x, y) => polygons.some(polygon =>
        pointInPolygon(x, y, polygon) || polygon.some(ring => ring.some((a, index) =>
            segmentDistanceSquared(x, y, a, ring[(index + 1) % ring.length]) <= 40000 + 1e-6))));
}

async function duplicateWarnings(supabase, pointName, x, y, excludedId = null) {
    // Query duplicate candidates across the whole database, independently of map scope.
    const columns = "id,point_name,section_name,x,y";
    const [sameNames, nearby] = await Promise.all([
        fetchAllSurveyPoints(supabase, columns, query => query.eq("point_name", pointName)),
        fetchAllSurveyPoints(supabase, columns, query => query
            .gte("x", x - 1).lte("x", x + 1)
            .gte("y", y - 1).lte("y", y + 1))
    ]);
    const data = [...new Map([...sameNames, ...nearby].map(row => [row.id, row])).values()];
    return data.filter(row => row.id !== excludedId).map(row => {
        const distance = Math.hypot(Number(row.x) - x, Number(row.y) - y);
        const sameName = row.point_name === pointName;
        const sameCoordinate = Number(row.x) === x && Number(row.y) === y;
        if (!sameName && !sameCoordinate && distance > 1) return null;
        return {
            id: row.id, pointName: row.point_name, sectionName: row.section_name || "",
            x: Number(row.x), y: Number(row.y), distance,
            reason: sameName && sameCoordinate ? "同名且同座標" : sameName ? "同名" : sameCoordinate ? "同座標" : "1 公尺內附近點位"
        };
    }).filter(Boolean).slice(0, 20);
}

async function pointPayload(supabase, user, body, excludedId = null) {
    const pointName = String(body.pointName || "").trim();
    const x = round3(body.x);
    const y = round3(body.y);
    if (!pointName) throw new Error("請輸入點名。");
    if (!(x > 0) || !(y > 0)) throw new Error("請輸入正確的 X、Y 座標。");
    const warnings = await duplicateWarnings(supabase, pointName, x, y, excludedId);
    if (warnings.length && !body.allowDuplicate) return { warnings };
    const { longitude, latitude } = coordinates(x, y);
    const sectionName = await findSectionName(longitude, latitude);
    return {
        payload: {
            point_name: pointName,
            point_type: body.pointType === "supplement" ? "supplement" : "control",
            status: ["active", "missing", "pending"].includes(body.status) ? body.status : "active",
            x, y, longitude, latitude, section_name: sectionName,
            remark: String(body.remark || "").trim() || null,
            updated_by: user.id
        }
    };
}

export function installApiAdapter(supabase, user) {
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, location.origin);
        if (!url.pathname.startsWith("/api/")) return nativeFetch(input, init);
        const method = String(init.method || "GET").toUpperCase();

        try {
            if (url.pathname === "/api/points" && method === "GET") {
                const keyword = (url.searchParams.get("q") || "").trim();
                const district = (url.searchParams.get("district") || "").trim();
                const section = (url.searchParams.get("section") || "").trim();
                const hasNear = url.searchParams.has("x") || url.searchParams.has("y");
                let data;
                const idsText = url.searchParams.get("ids");
                if (idsText !== null) {
                    const ids = idsText.split(",");
                    if (!ids.length || ids.length > 100 || ids.some(id => !/^[1-9]\d*$/.test(id)))
                        throw new Error("點位編號不正確。");
                    const result = await supabase.from("survey_points").select("*").in("id", ids.map(Number));
                    if (result.error) throw result.error;
                    return jsonResponse(result.data.map(pointFromRow));
                } else if (hasNear) {
                    const xText = url.searchParams.get("x"), yText = url.searchParams.get("y");
                    const x = Number(xText), y = Number(yText);
                    if (!xText || !yText || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0)
                        throw new Error("搜尋中心座標不正確。");
                    return jsonResponse(await pointsInMetricBuffer(supabase,
                        { minX: x, maxX: x, minY: y, maxY: y },
                        (px, py) => (px - x) ** 2 + (py - y) ** 2 <= 40000 + 1e-6));
                } else if (section) {
                    data = await fetchAllSurveyPoints(supabase, "*", query => query.eq("section_name", section));
                } else if (keyword) {
                    // Escape SQL LIKE wildcards so a point name is treated as literal text.
                    const pattern = keyword.replace(/[\\%_]/g, "\\$&");
                    const result = await supabase.from("survey_points").select("*")
                        .ilike("point_name", "%" + pattern + "%").order("point_name").order("id").limit(21);
                    if (result.error) throw result.error;
                    data = result.data;
                } else if (district) {
                    if (!/^[\u3400-\u9fff]{1,20}區$/.test(district)) throw new Error("行政區格式不正確。");
                    data = await fetchAllSurveyPoints(supabase, "*",
                        query => query.like("section_name", district + "%"));
                } else {
                    // No unfiltered map reads, including startup and realtime refreshes.
                    return jsonResponse([]);
                }
                return jsonResponse(data.map(pointFromRow));
            }

            if (url.pathname === "/api/points/buffer" && method === "POST") {
                const body = JSON.parse(init.body || "{}");
                return jsonResponse(await parcelBufferPoints(supabase, body.geometry));
            }

            if (url.pathname === "/api/points" && method === "POST") {
                const body = JSON.parse(init.body || "{}");
                const result = await pointPayload(supabase, user, body);
                if (result.warnings) return jsonResponse({ warnings: result.warnings }, 409);
                const { data, error } = await supabase.from("survey_points")
                    .insert({ ...result.payload, created_by: user.id }).select().single();
                if (error) throw error;
                return jsonResponse(pointFromRow(data), 201);
            }

            const historyMatch = url.pathname.match(/^\/api\/points\/(\d+)\/history$/);
            if (historyMatch && method === "GET") {
                const { data, error } = await supabase.from("point_audit_logs").select("*")
                    .eq("survey_point_id", Number(historyMatch[1])).order("created_at", { ascending: false });
                if (error) throw error;
                return jsonResponse(data.map(historyFromRow));
            }

            const pointMatch = url.pathname.match(/^\/api\/points\/(\d+)$/);
            if (pointMatch) {
                const id = Number(pointMatch[1]);
                if (method === "GET") {
                    const { data, error } = await supabase.from("survey_points").select("*").eq("id", id).maybeSingle();
                    if (error) throw error;
                    if (!data) return jsonResponse({ message: "此點位已刪除或目前無法讀取。" }, 404);
                    return jsonResponse(pointFromRow(data));
                }
                if (method === "PUT") {
                    const body = JSON.parse(init.body || "{}");
                    const result = await pointPayload(supabase, user, body, id);
                    if (result.warnings) return jsonResponse({ warnings: result.warnings }, 409);
                    const { data, error } = await supabase.from("survey_points").update(result.payload).eq("id", id).select().single();
                    if (error) throw error;
                    return jsonResponse(pointFromRow(data));
                }
                if (method === "DELETE") {
                    const { data: photos } = await supabase.from("point_photos").select("storage_path").eq("survey_point_id", id);
                    if (photos?.length) await supabase.storage.from("point-photos").remove(photos.map(photo => photo.storage_path));
                    const { error } = await supabase.from("survey_points").delete().eq("id", id);
                    if (error) throw error;
                    return noContent();
                }
            }

            if (url.pathname === "/api/notes" && method === "GET") {
                const { data, error } = await supabase.from("map_notes").select("*").order("id");
                if (error) throw error;
                return jsonResponse(data.map(noteFromRow));
            }

            if (url.pathname === "/api/notes" && method === "POST") {
                const body = JSON.parse(init.body || "{}");
                const x = round3(body.x), y = round3(body.y);
                const { longitude, latitude } = coordinates(x, y);
                const { data, error } = await supabase.from("map_notes").insert({
                    emoji: String(body.emoji || "⭐").slice(0, 16), remark: body.remark || null,
                    x, y, longitude, latitude, created_by: user.id, updated_by: user.id
                }).select().single();
                if (error) throw error;
                return jsonResponse(noteFromRow(data), 201);
            }

            const noteMatch = url.pathname.match(/^\/api\/notes\/(\d+)$/);
            if (noteMatch) {
                const id = Number(noteMatch[1]);
                if (method === "PUT") {
                    const body = JSON.parse(init.body || "{}");
                    const x = round3(body.x), y = round3(body.y);
                    const { longitude, latitude } = coordinates(x, y);
                    const { data, error } = await supabase.from("map_notes").update({
                        emoji: String(body.emoji || "⭐").slice(0, 16), remark: body.remark || null,
                        x, y, longitude, latitude, updated_by: user.id
                    }).eq("id", id).select().single();
                    if (error) throw error;
                    return jsonResponse(noteFromRow(data));
                }
                if (method === "DELETE") {
                    const { error } = await supabase.from("map_notes").delete().eq("id", id);
                    if (error) throw error;
                    return noContent();
                }
            }

            if (["/api/import/points/preview", "/api/import/ct2/preview"].includes(url.pathname) && method === "POST") {
                const file = init.body?.get("file");
                return jsonResponse(await parsePointFile(file));
            }

            if (["/api/import/points/import", "/api/import/ct2/import"].includes(url.pathname) && method === "POST") {
                const file = init.body?.get("file");
                const result = await parsePointFile(file);
                for (const item of result.items.filter(item => item.status === "valid")) {
                    // Q-file examples include differently named points only centimetres apart.
                    // For these imports, only identical name + rounded coordinates is a duplicate.
                    const warnings = result.sourceFormat
                        ? await fetchAllSurveyPoints(supabase, "id", query => query
                            .eq("point_name", item.pointName).eq("x", item.x).eq("y", item.y))
                        : await duplicateWarnings(supabase, item.pointName, item.x, item.y);
                    if (warnings.length) {
                        item.status = "duplicate";
                        item.message = "已有相同點位，將沿用既有資料。";
                        result.skippedCount++;
                        continue;
                    }
                    const { longitude, latitude } = coordinates(item.x, item.y);
                    const sectionName = await findSectionName(longitude, latitude);
                    const { data: inserted, error } = await supabase.from("survey_points").insert({
                        point_name: item.pointName, point_type: item.pointType, status: "active",
                        x: item.x, y: item.y, longitude, latitude, section_name: sectionName,
                        remark: `由 ${file.name} 匯入`, created_by: user.id, updated_by: user.id,
                        import_source: file.name
                    }).select("*").single();
                    if (error) {
                        item.status = "error";
                        item.message = error.message;
                        result.skippedCount++;
                    } else {
                        item.point = pointFromRow(inserted);
                        item.status = "imported";
                        item.message = "匯入成功";
                        result.importedCount++;
                    }
                }
                return jsonResponse(result);
            }

            const photosMatch = url.pathname.match(/^\/api\/points\/(\d+)\/photos$/);
            if (photosMatch) {
                const pointId = Number(photosMatch[1]);
                if (method === "GET") {
                    const { data, error } = await supabase.from("point_photos").select("*").eq("survey_point_id", pointId).order("created_at");
                    if (error) throw error;
                    const result = await Promise.all(data.map(async row => {
                        const { data: signed } = await supabase.storage.from("point-photos").createSignedUrl(row.storage_path, 3600);
                        return {
                            id: row.id, surveyPointId: row.survey_point_id,
                            originalFileName: row.original_file_name, contentType: row.content_type,
                            fileSize: row.file_size, description: row.description,
                            createdAt: row.created_at, url: signed?.signedUrl || ""
                        };
                    }));
                    return jsonResponse(result);
                }
                if (method === "POST") {
                    const file = init.body?.get("file");
                    if (!file || !file.type.startsWith("image/")) throw new Error("請選擇圖片檔案。");
                    if (file.size > 20 * 1024 * 1024) throw new Error("照片不可超過 20 MB。");
                    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                    const storagePath = `${pointId}/${crypto.randomUUID()}-${safeName}`;
                    const { error: uploadError } = await supabase.storage.from("point-photos").upload(storagePath, file, { contentType: file.type });
                    if (uploadError) throw uploadError;
                    const { data, error } = await supabase.from("point_photos").insert({
                        survey_point_id: pointId, original_file_name: file.name, storage_path: storagePath,
                        content_type: file.type, file_size: file.size, uploaded_by: user.id
                    }).select().single();
                    if (error) {
                        await supabase.storage.from("point-photos").remove([storagePath]);
                        throw error;
                    }
                    return jsonResponse({ id: data.id, surveyPointId: pointId, originalFileName: file.name }, 201);
                }
            }

            const photoDeleteMatch = url.pathname.match(/^\/api\/points\/(\d+)\/photos\/(\d+)$/);
            if (photoDeleteMatch && method === "DELETE") {
                const pointId = Number(photoDeleteMatch[1]), photoId = Number(photoDeleteMatch[2]);
                const { data, error: readError } = await supabase.from("point_photos").select("storage_path")
                    .eq("id", photoId).eq("survey_point_id", pointId).single();
                if (readError) throw readError;
                const { error } = await supabase.from("point_photos").delete().eq("id", photoId);
                if (error) throw error;
                await supabase.storage.from("point-photos").remove([data.storage_path]);
                return noContent();
            }

            if (url.pathname === "/api/system/sections-geojson" && method === "GET") {
                const response = await originalFetch("./sections.geojson");
                if (!response.ok) throw new Error("無法載入地籍段界資料。");
                return new Response(await response.text(), { headers: { "Content-Type": "application/geo+json; charset=utf-8" } });
            }

            if (["/api/addresses/district", "/api/system/location-context"].includes(url.pathname) && method === "GET") {
                const longitudeText = url.searchParams.get("longitude");
                const latitudeText = url.searchParams.get("latitude");
                const longitude = Number(longitudeText), latitude = Number(latitudeText);
                if (!longitudeText || !latitudeText || !Number.isFinite(longitude) ||
                    !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
                    throw new Error("地址座標不正確。");
                }
                // Resolve against this project's section polygons, not ambiguous address text.
                const feature = await findSectionFeature(longitude, latitude);
                const sectionName = feature?.properties?.fullName || feature?.properties?.sectionName || null;
                const districtName = sectionName?.match(/^(.+?區)/)?.[1] || null;
                return jsonResponse({ districtName, sectionName,
                    ...(url.pathname === "/api/system/location-context" ? { feature: feature || null } : {}) });
            }

            if (url.pathname === "/api/addresses/search" && method === "GET") {
                const query = url.searchParams.get("q") || "";
                const response = await nativeFetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=tw&limit=20&q=${encodeURIComponent(query)}`, {
                    headers: { "Accept-Language": "zh-TW" }
                });
                const rows = response.ok ? await response.json() : [];
                const results = rows.map((row, index) => {
                    const longitude = Number(row.lon), latitude = Number(row.lat);
                    const [x, y] = window.proj4("EPSG:4326", "EPSG:3826", [longitude, latitude]);
                    return { id: index + 1, fullAddress: row.display_name, districtName: "", village: null, x: round3(x), y: round3(y), longitude, latitude };
                });
                return jsonResponse({ results });
            }

            return jsonResponse({ message: "此功能尚未提供。" }, 404);
        } catch (error) {
            console.error("Supabase API adapter", error);
            return errorResponse(error, error?.code === "PGRST116" ? 404 : 400);
        }
    };
}
