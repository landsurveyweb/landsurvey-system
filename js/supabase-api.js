const jsonResponse = (body, status = 200, headers = {}) => new Response(
    body === null ? null : JSON.stringify(body),
    { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } }
);

const noContent = () => new Response(null, { status: 204 });
const errorResponse = (error, status = 400) => jsonResponse({ message: error?.message || String(error) }, status);
const round3 = value => Math.round(Number(value) * 1000) / 1000;

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

async function duplicateWarnings(supabase, pointName, x, y, excludedId = null) {
    const { data, error } = await supabase.from("survey_points").select("id,point_name,section_name,x,y");
    if (error) throw error;
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
    return {
        payload: {
            point_name: pointName,
            point_type: body.pointType === "supplement" ? "supplement" : "control",
            status: ["active", "missing", "pending"].includes(body.status) ? body.status : "active",
            x, y, longitude, latitude,
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
                const { data, error } = await supabase.from("survey_points").select("*").order("id");
                if (error) throw error;
                return jsonResponse(data.map(pointFromRow));
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
                    const { data, error } = await supabase.from("survey_points").select("*").eq("id", id).single();
                    if (error) throw error;
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

            if (url.pathname === "/api/import/ct2/preview" && method === "POST") {
                return jsonResponse(await parseCt2(init.body?.get("file")));
            }

            if (url.pathname === "/api/import/ct2/import" && method === "POST") {
                const file = init.body?.get("file");
                const result = await parseCt2(file);
                for (const item of result.items.filter(item => item.status === "valid")) {
                    const warnings = await duplicateWarnings(supabase, item.pointName, item.x, item.y);
                    if (warnings.length) {
                        item.status = "duplicate";
                        item.message = "發現可能重複的點位，已略過。";
                        result.skippedCount++;
                        continue;
                    }
                    const { longitude, latitude } = coordinates(item.x, item.y);
                    const { error } = await supabase.from("survey_points").insert({
                        point_name: item.pointName, point_type: item.pointType, status: "active",
                        x: item.x, y: item.y, longitude, latitude,
                        remark: `由 ${file.name} 匯入`, created_by: user.id, updated_by: user.id,
                        import_source: file.name
                    });
                    if (error) {
                        item.status = "error";
                        item.message = error.message;
                        result.skippedCount++;
                    } else {
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
                return jsonResponse({ type: "FeatureCollection", features: [] });
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

