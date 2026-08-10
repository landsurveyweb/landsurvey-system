"use strict";

const initialLatitude = 25.066;
const initialLongitude = 121.56;

const map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
}).setView(
    [initialLatitude, initialLongitude],
    13
);

const baseMapLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 21,
        attribution: "&copy; OpenStreetMap contributors"
    }
).addTo(map);

const aerialMapLayer = L.tileLayer(
    "https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/EPSG:3857/{z}/{y}/{x}",
    {
        maxNativeZoom: 19,
        maxZoom: 21,
        attribution:
            "正射影像：內政部國土測繪中心"
    }
);

L.control.scale({
    imperial: false,
    metric: true,
    position: "bottomleft"
}).addTo(map);

const controlPointLayer =
    L.layerGroup().addTo(map);

const supplementPointLayer =
    L.layerGroup().addTo(map);

const missingPointLayer =
    L.layerGroup().addTo(map);

const noteLayer =
    L.layerGroup().addTo(map);

const sectionLayer =
    L.geoJSON(null, {
        style: {
            color: "#8050a6",
            weight: 1.5,
            fillColor: "#a986c5",
            fillOpacity: 0.08
        },

        onEachFeature(feature, layer) {
            const properties =
                feature.properties ?? {};

            layer.bindTooltip(
                properties.fullName
                ?? properties.sectionName
                ?? "地籍段"
            );
        }
    });

proj4.defs(
    "EPSG:3826",
    "+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 " +
    "+x_0=250000 +y_0=0 +ellps=GRS80 +units=m +no_defs"
);

const sidebar =
    document.getElementById("sidebar");

const screenOverlay =
    document.getElementById("screenOverlay");

const contextMenu =
    document.getElementById("contextMenu");

const coordinatePanel =
    document.getElementById("coordinatePanel");

const pointDialog =
    document.getElementById("pointDialog");

const duplicateWarningPanel =
    document.getElementById("duplicateWarningPanel");

const photoDialog =
    document.getElementById("photoDialog");

const photoDialogTitle =
    document.getElementById("photoDialogTitle");

const photoList =
    document.getElementById("photoList");

const cameraPhotoInput =
    document.getElementById(
        "cameraPhotoInput"
    );

const cameraPhotoButton =
    document.getElementById(
        "cameraPhotoButton"
    );

const photoFileInput =
    document.getElementById(
        "photoFileInput"
    );

const uploadPhotoButton =
    document.getElementById(
        "uploadPhotoButton"
    );

const closePhotoDialogButton =
    document.getElementById("closePhotoDialogButton");

const cancelPhotoDialogButton =
    document.getElementById("cancelPhotoDialogButton");

const ct2FileInput =
    document.getElementById("ct2FileInput");

const importDialog =
    document.getElementById("importDialog");

const importFileName =
    document.getElementById("importFileName");

const importSummary =
    document.getElementById("importSummary");

const importPreviewBody =
    document.getElementById("importPreviewBody");

const importPointsButton =
    document.getElementById("importPointsButton");

const chooseAnotherCt2Button =
    document.getElementById("chooseAnotherCt2Button");

const closeImportDialogButton =
    document.getElementById("closeImportDialogButton");

const cancelImportButton =
    document.getElementById("cancelImportButton");

const historyDialog =
    document.getElementById("historyDialog");

const historyDialogTitle =
    document.getElementById(
        "historyDialogTitle"
    );

const historyList =
    document.getElementById("historyList");

const closeHistoryDialogButton =
    document.getElementById(
        "closeHistoryDialogButton"
    );

const cancelHistoryDialogButton =
    document.getElementById(
        "cancelHistoryDialogButton"
    );

let currentCt2File = null;
let currentCt2Preview = null;

let allPoints = [];
let markerByPointId = new Map();

let contextLatLng = null;

let pointPlacementMode = false;

let messageTimer = null;

let currentPhotoPointId = null;

let allowDuplicateOnNextSave = false;

// ===== 新增 =====

// null = 新增
// 有值 = 編輯中的點位 id
let editingPointId = null;
let allNotes = [];
let editingNoteId = null;
let notePlacementMode = false;

let longPressTimer = null;
let longPressStart = null;
let suppressNextMapClick = false;

const noteDialog =
    document.getElementById("noteDialog");

const noteDialogTitle =
    document.getElementById("noteDialogTitle");

const noteEmojiInput =
    document.getElementById("noteEmojiInput");

const noteXInput =
    document.getElementById("noteXInput");

const noteYInput =
    document.getElementById("noteYInput");

const noteRemarkInput =
    document.getElementById("noteRemarkInput");

const saveNoteButton =
    document.getElementById("saveNoteButton");

const deleteNoteButton =
    document.getElementById("deleteNoteButton");

function toTwd97(latitude, longitude) {
    const result = proj4(
        "EPSG:4326",
        "EPSG:3826",
        [longitude, latitude]
    );

    return {
        x: Number(result[0].toFixed(3)),
        y: Number(result[1].toFixed(3))
    };
}

function updateCoordinateDisplay(latitude, longitude) {
    const twd97 =
        toTwd97(latitude, longitude);

    coordinatePanel.innerHTML = `
        <div class="coordinate-title">TWD97</div>
        <div>X：${twd97.x.toFixed(3)}</div>
        <div>Y：${twd97.y.toFixed(3)}</div>
    `;
}

function showMessage(message) {
    const messageElement =
        document.getElementById("mapMessage");

    window.clearTimeout(messageTimer);

    messageElement.textContent = message;
    messageElement.classList.remove("hidden");

    messageTimer = window.setTimeout(() => {
        messageElement.classList.add("hidden");
    }, 2800);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getPointTypeName(pointType) {
    return pointType === "supplement"
        ? "補點"
        : "圖根點";
}

function getStatusName(status) {
    switch (status) {
        case "missing":
            return "已滅失";

        case "pending":
            return "待確認";

        default:
            return "正常";
    }
}

function getPointFillColor(point) {
    // 已滅失不分圖根點或補點，全部顯示灰色
    if (point.status === "missing") {
        return "#737a82";
    }

    // 補點藍色、圖根點紅色
    return point.pointType === "supplement"
        ? "#1769d2"
        : "#df2525";
}

function getPointBorderColor(point) {
    // 待確認使用黃色外框，
    // 中心仍保留圖根點紅色或補點藍色
    if (point.status === "pending") {
        return "#f2b705";
    }

    // 已滅失使用較深的灰色外框
    if (point.status === "missing") {
        return "#50565d";
    }

    // 正常點位使用白色外框
    return "#ffffff";
}

function getPointBorderWeight(point) {
    return point.status === "pending"
        ? 4
        : 2;
}

function getPointMarkerStyle(point, selected = false) {
    return {
        radius: selected ? 10 : 7,
        color: getPointBorderColor(point),
        weight:
            getPointBorderWeight(point)
            + (selected ? 1 : 0),
        fillColor: getPointFillColor(point),
        fillOpacity:
            point.status === "missing"
                ? 0.82
                : 1
    };
}

function getTargetLayer(point) {
    if (point.status === "missing") {
        return missingPointLayer;
    }

    return point.pointType === "supplement"
        ? supplementPointLayer
        : controlPointLayer;
}

function createPointMarker(point) {
    const marker = L.circleMarker(
    [point.latitude, point.longitude],
    getPointMarkerStyle(point)
);

function getHistoryActionName(action) {
    switch (action) {
        case "create":
            return "新增點位";

        case "update":
            return "修改點位";

        case "delete":
            return "刪除點位";

        case "import":
            return "匯入點位";

        default:
            return action || "未知操作";
    }
}

function formatHistoryTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return date.toLocaleString(
        "zh-TW",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

function getHistoryDetail(log) {
    if (log.action === "import") {
        return log.sourceFileName
            ? `來源檔案：${log.sourceFileName}`
            : "由 .ct2 檔案匯入";
    }

    if (log.action === "create") {
        return "建立正式點位";
    }

    if (log.action === "delete") {
        return "刪除正式點位";
    }

    if (log.action === "update") {
        return "修改點位資料";
    }

    return "";
}

window.showPointHistory =
    async function (pointId) {
                map.closePopup();
        const point =
            allPoints.find(
                item => item.id === pointId
            );

        historyDialogTitle.textContent =
            point
                ? `${point.pointName}－操作歷程`
                : "點位操作歷程";

        historyList.innerHTML = `
            <div class="history-empty">
                正在載入操作歷程……
            </div>
        `;

        if (!historyDialog.open) {
            historyDialog.showModal();
        }

        try {
            const response = await fetch(
                `/api/points/${pointId}/history`
            );

            const responseText =
                await response.text();

            let history = [];

            if (responseText) {
                try {
                    history =
                        JSON.parse(responseText);
                } catch {
                    history = [];
                }
            }

            if (!response.ok) {
                throw new Error(
                    history?.message
                    ?? responseText
                    ?? `讀取失敗（HTTP ${response.status}）`
                );
            }

            if (
                !Array.isArray(history)
                || history.length === 0
            ) {
                historyList.innerHTML = `
                    <div class="history-empty">
                        這個點位目前沒有操作紀錄。
                    </div>
                `;

                return;
            }

            historyList.innerHTML =
                history.map(log => `
                    <article class="history-item">
                        <div class="history-item-header">
                            <span class="history-action">
                                ${escapeHtml(
                                    getHistoryActionName(
                                        log.action
                                    )
                                )}
                            </span>

                            <span class="history-time">
                                ${escapeHtml(
                                    formatHistoryTime(
                                        log.createdAt
                                    )
                                )}
                            </span>
                        </div>

                        <div class="history-user">
                            操作者：
                            ${escapeHtml(
                                log.userDisplayName
                                || "未知使用者"
                            )}
                        </div>

                        <div class="history-detail">
                            ${escapeHtml(
                                getHistoryDetail(log)
                            )}
                        </div>
                    </article>
                `).join("");
        } catch (error) {
            console.error(error);

            historyList.innerHTML = `
                <div class="history-empty">
                    ${escapeHtml(
                        error.message
                        ?? "無法讀取操作歷程"
                    )}
                </div>
            `;
        }
    };



    marker.bindPopup(`
    <div class="point-popup">

        <div class="point-popup-title">
            ${escapeHtml(point.pointName)}
        </div>

        <div class="point-popup-row">
            ${escapeHtml(getPointTypeName(point.pointType))}
            ・
            ${escapeHtml(getStatusName(point.status))}
        </div>

        <div class="point-popup-row">
            地籍段：
            ${escapeHtml(point.sectionName || "未判定")}
        </div>

        <div class="point-popup-coordinate">
            <div>X：${Number(point.x).toFixed(3)}</div>
            <div>Y：${Number(point.y).toFixed(3)}</div>
        </div>

        ${
          point.remark
            ? `
                <div class="point-popup-row">
                    備註：
                    ${escapeHtml(point.remark)}
                </div>
            `
            : ""
        }

                <div class="point-popup-user-info">
            <div>
                上傳者：
                ${escapeHtml(
                    point.createdByName
                    || "舊資料／未記錄"
                )}
            </div>

            <div>
                最後修改：
                ${escapeHtml(
                    point.updatedByName
                    || point.createdByName
                    || "舊資料／未記錄"
                )}
            </div>
        </div>

        <hr>

        <hr>

<button
    class="popup-photo-button"
    onclick="showPhotos(${point.id})">

    📷 照片

</button>

<button
    type="button"
    class="popup-copy-button"
    onclick="
        window.showPointHistory(${point.id});
        return false;
    "
>
    🕘 操作歷程
</button>

<button
    class="popup-copy-button"
    onclick="copyPointCoordinate(${point.id})">

    📋 複製 TWD97 座標

</button>

<button
    class="popup-copy-button"
    onclick="copyPointInfo(${point.id})">

    📄 複製 Excel

</button>

<button
    class="popup-navigation-button"
    onclick="navigateToPoint(${point.id})">

    🧭 Google Maps

</button>

<hr>

<button
    class="popup-edit-button"
    onclick="editPoint(${point.id})">

    ✏ 編輯

</button>

<button
    class="popup-delete-button"
    onclick="deletePoint(${point.id})"
>
    🗑 刪除
</button>

    </div>
`);

    marker.addTo(getTargetLayer(point));
    marker.on("popupopen", () => {
    marker.setStyle(
        getPointMarkerStyle(
            point,
            true
        )
    );

    marker.bringToFront();
});

marker.on("popupclose", () => {
    marker.setStyle(
        getPointMarkerStyle(
            point,
            false
        )
    );
});
    markerByPointId.set(point.id, marker);
}

async function loadPoints() {
    try {
        const response =
            await fetch("/api/points");

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        allPoints =
            await response.json();

        controlPointLayer.clearLayers();
        supplementPointLayer.clearLayers();
        missingPointLayer.clearLayers();
        markerByPointId.clear();

        allPoints.forEach(createPointMarker);

        renderPointList();

        if (allPoints.length > 0) {
            const bounds = L.latLngBounds(
                allPoints.map(point => [
                    point.latitude,
                    point.longitude
                ])
            );

            map.fitBounds(bounds, {
                padding: [35, 35],
                maxZoom: 18
            });
        }
    } catch (error) {
        console.error(error);

        document.getElementById(
            "pointListPanel"
        ).textContent = "點位載入失敗";

        showMessage(
            "無法載入正式點位，請確認網站與資料庫連線。"
        );
    }
}

function renderPointList() {
    const panel =
        document.getElementById("pointListPanel");

    if (allPoints.length === 0) {
        panel.textContent = "目前沒有正式點位";
        return;
    }

    const grouped = new Map();

    for (const point of allPoints) {
        const groupName =
            point.sectionName || "未判定";

        if (!grouped.has(groupName)) {
            grouped.set(groupName, []);
        }

        grouped.get(groupName).push(point);
    }

    panel.innerHTML = "";

    for (const [sectionName, points] of grouped) {
        const group =
            document.createElement("div");

        group.className = "section-group";

        const title =
            document.createElement("button");

        title.type = "button";
        title.className = "section-group-title";
        title.textContent =
            `${sectionName}（${points.length}）`;

        const pointList =
            document.createElement("div");

        pointList.className = "section-point-list";

        for (const point of points) {
            const button =
                document.createElement("button");

            button.type = "button";
            button.className =
                "point-list-button";

            button.innerHTML = `
                <span
                    class="point-type-dot"
                    style="
    background:${getPointFillColor(point)};
    border:2px solid ${getPointBorderColor(point)};
"
                ></span>

                <span>
                    ${escapeHtml(point.pointName)}
                </span>
            `;

            button.addEventListener(
                "click",
                () => locatePoint(point)
            );

            pointList.appendChild(button);
        }

        title.addEventListener("click", () => {
            pointList.classList.toggle("hidden");
        });

        group.appendChild(title);
        group.appendChild(pointList);
        panel.appendChild(group);
    }
}

function locatePoint(point) {
    const marker =
        markerByPointId.get(point.id);

    map.setView(
        [point.latitude, point.longitude],
        19
    );

    if (marker) {
        marker.openPopup();
    }

    closeMobileSidebar();
}

function searchPoints() {
    const keyword =
        document.getElementById(
            "pointSearchInput"
        ).value.trim().toLowerCase();

    const resultPanel =
        document.getElementById(
            "searchResultPanel"
        );

    if (!keyword) {
        resultPanel.classList.add("hidden");
        return;
    }

    const matches = allPoints
        .filter(point =>
            point.pointName
                .toLowerCase()
                .includes(keyword)
        )
        .slice(0, 20);

    resultPanel.innerHTML = "";

    if (matches.length === 0) {
        resultPanel.textContent =
            "找不到符合的點位";

        resultPanel.classList.remove("hidden");
        return;
    }

    for (const point of matches) {
        const button =
            document.createElement("button");

        button.type = "button";
        button.className =
            "search-result-button";

        button.textContent =
            `${point.pointName}－${point.sectionName || "未判定"}`;

        button.addEventListener(
            "click",
            () => {
                locatePoint(point);
                resultPanel.classList.add("hidden");
            }
        );

        resultPanel.appendChild(button);
    }

    resultPanel.classList.remove("hidden");
}

let addressLocationMarker = null;

async function searchAddresses() {
    const input =
        document.getElementById(
            "addressSearchInput"
        );

    const resultPanel =
        document.getElementById(
            "addressSearchResultPanel"
        );

    const query = input.value.trim();

    resultPanel.innerHTML = "";
    resultPanel.classList.remove("hidden");

    if (query.length < 2) {
        resultPanel.textContent =
            "請至少輸入 2 個字。";
        return;
    }

    resultPanel.textContent = "搜尋中……";

    try {
        const response = await fetch(
            `/api/addresses/search?q=${
                encodeURIComponent(query)
            }&limit=20`
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "地址搜尋失敗。"
            );
        }

        resultPanel.innerHTML = "";

        if (!data.results ||
            data.results.length === 0) {
            resultPanel.textContent =
                "找不到符合的地址。";
            return;
        }

        for (const address of data.results) {
            const button =
                document.createElement("button");

            button.type = "button";
            button.className =
                "search-result-button";

            button.textContent =
                address.fullAddress;

            button.addEventListener(
                "click",
                () => locateAddress(address)
            );

            resultPanel.appendChild(button);
        }
    }
    catch (error) {
        console.error(error);

        resultPanel.textContent =
            error.message || "地址搜尋失敗。";
    }
}

function locateAddress(address) {
    const latitude =
        Number(address.latitude);

    const longitude =
        Number(address.longitude);

    if (!Number.isFinite(latitude) ||
        !Number.isFinite(longitude)) {
        alert("這筆地址沒有有效座標。");
        return;
    }

    if (addressLocationMarker) {
        map.removeLayer(
            addressLocationMarker
        );
    }

        const addressPinIcon =
        L.divIcon({
            className:
                "address-pin-container",

            html: `
                <div class="address-pin">
                    <div class="address-pin-dot"></div>
                </div>
            `,

            iconSize: [36, 46],
            iconAnchor: [18, 46],
            popupAnchor: [0, -42]
        });

    addressLocationMarker =
        L.marker(
            [latitude, longitude],
            {
                icon: addressPinIcon,
                zIndexOffset: 2000
            }
        ).addTo(map);

    const popupContent =
        document.createElement("div");

    const title =
        document.createElement("strong");

    title.textContent =
        address.fullAddress;

    const coordinates =
        document.createElement("div");

    coordinates.textContent =
        `TWD97：${address.x}, ${address.y}`;

    popupContent.appendChild(title);
    popupContent.appendChild(coordinates);

    addressLocationMarker
        .bindPopup(popupContent)
        .openPopup();

    map.setView(
        [latitude, longitude],
        19
    );

    document.getElementById(
        "addressSearchResultPanel"
    ).classList.add("hidden");

    closeMobileSidebar();
}

async function loadSections() {
    try {
        const response =
            await fetch(
                "/api/system/sections-geojson"
            );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const geoJson =
            await response.json();

        sectionLayer.clearLayers();
        sectionLayer.addData(geoJson);
        populateParcelSectionOptions(geoJson);
    } catch (error) {
        console.error(error);

        showMessage(
            "地籍段界載入失敗。"
        );
    }
}

function beginPointPlacement() {
    pointPlacementMode = true;

    map.getContainer().style.cursor =
        "crosshair";

    closeMobileSidebar();
    closeContextMenu();

    showMessage(
        "請在地圖上點選正式點位位置"
    );
}

function openPointDialog(latLng) {
    editingPointId = null;

    document.getElementById("pointDialogTitle").textContent = "新增正式點位";
    contextLatLng = latLng;


    const twd97 =
        toTwd97(latLng.lat, latLng.lng);

    document.getElementById(
        "pointNameInput"
    ).value = "";

    document.getElementById(
        "pointXInput"
    ).value = twd97.x.toFixed(3);

    document.getElementById(
        "pointYInput"
    ).value = twd97.y.toFixed(3);

    document.getElementById(
        "pointTypeInput"
    ).value = "control";

    document.getElementById(
        "pointStatusInput"
    ).value = "active";

    document.getElementById(
        "pointRemarkInput"
    ).value = "";

    duplicateWarningPanel.classList.add(
        "hidden"
    );

    duplicateWarningPanel.innerHTML = "";

    allowDuplicateOnNextSave = false;

    document.getElementById(
        "savePointButton"
    ).textContent = "儲存";

    pointDialog.showModal();

    window.setTimeout(() => {
        document.getElementById(
            "pointNameInput"
        ).focus();
    }, 100);
}

async function savePoint() {
    const pointName =
        document.getElementById(
            "pointNameInput"
        ).value.trim();

    const x =
        Number(
            document.getElementById(
                "pointXInput"
            ).value
        );

    const y =
        Number(
            document.getElementById(
                "pointYInput"
            ).value
        );

    if (!pointName) {
        alert("請輸入點名。");
        return;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        alert("請輸入正確的 X、Y 座標。");
        return;
    }

    const body = {
        pointName,
        pointType:
            document.getElementById(
                "pointTypeInput"
            ).value,

        status:
            document.getElementById(
                "pointStatusInput"
            ).value,

        x,
        y,

        remark:
            document.getElementById(
                "pointRemarkInput"
            ).value.trim(),

        allowDuplicate:
            allowDuplicateOnNextSave
    };

    const isEdit =
    editingPointId !== null;

    const saveButton =
        document.getElementById(
            "savePointButton"
        );

    saveButton.disabled = true;

    try {
        const response = await fetch(
          isEdit ? `/api/points/${editingPointId}` : "/api/points",
          {
            method: isEdit ? "PUT" : "POST",

            headers: {
              "Content-Type": "application/json",
            },

            body: JSON.stringify(body),
          },
        );

        const responseText =
            await response.text();

        let result = null;

        if (responseText) {
            try {
                result =
                    JSON.parse(responseText);
            } catch {
                result = {
                    message: responseText
                };
            }
        }

        if (response.status === 409) {
          showDuplicateWarnings(result?.warnings ?? []);

          allowDuplicateOnNextSave = true;

          saveButton.textContent = isEdit ? "仍要儲存" : "仍要新增";

          return;
        }

        if (!response.ok) {
          throw new Error(
            result?.message ??
              (isEdit
                ? `更新失敗（HTTP ${response.status}）`
                : `新增失敗（HTTP ${response.status}）`),
          );
        }

        pointDialog.close();

        showMessage(isEdit ? `已更新 ${pointName}` : `已新增 ${pointName}`);

        await loadPoints();
    } catch (error) {
        console.error(error);

        alert(error.message ?? (isEdit ? "更新點位失敗。" : "新增點位失敗。"));
    } finally {
        saveButton.disabled = false;
    }
}

function showDuplicateWarnings(warnings) {
    duplicateWarningPanel.innerHTML = `
        <strong>發現可能重複的點位：</strong>
        ${
            warnings.length === 0
                ? "<div>系統偵測到重複資料。</div>"
                : warnings
                    .map(warning => `
                        <div>
                            ${escapeHtml(warning.pointName)}
                            ｜${escapeHtml(warning.reason)}
                            ｜距離 ${Number(warning.distance).toFixed(3)} 公尺
                        </div>
                    `)
                    .join("")
        }

        <div style="margin-top:8px;">
            確認仍要建立時，請再次按「仍要新增」。
        </div>
    `;

    duplicateWarningPanel.classList.remove(
        "hidden"
    );
}

async function previewCt2File(file) {
    currentCt2File = file;
    currentCt2Preview = null;

    importFileName.textContent =
        `檔案：${file.name}`;

    importSummary.textContent =
        "正在解析檔案……";

    importPreviewBody.innerHTML = `
        <tr>
            <td
                colspan="6"
                style="padding:18px;text-align:center;"
            >
                正在解析……
            </td>
        </tr>
    `;

    importPointsButton.disabled = true;

    if (!importDialog.open) {
        importDialog.showModal();
    }

   

    const formData =
        new FormData();

    formData.append("file", file);

    try {
        const response = await fetch(
            "/api/import/ct2/preview",
            {
                method: "POST",
                body: formData
            }
        );

        const responseText =
            await response.text();

        let result = null;

        if (responseText) {
            try {
                result =
                    JSON.parse(responseText);
            } catch {
                result = null;
            }
        }

        if (!response.ok) {
            throw new Error(
                result?.message
                ?? result?.detail
                ?? responseText
                ?? `解析失敗（HTTP ${response.status}）`
            );
        }

        currentCt2Preview = result;

        renderCt2Preview(result);
    } catch (error) {
        console.error(error);

        importSummary.textContent =
            "檔案解析失敗";

        importPreviewBody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    style="
                        padding:18px;
                        color:#b42318;
                        text-align:center;
                    "
                >
                    ${escapeHtml(
                        error.message
                        ?? "無法解析檔案"
                    )}
                </td>
            </tr>
        `;

        alert(
            error.message
            ?? "無法解析 .ct2 檔案"
        );
    }
}

function renderCt2Preview(result) {
    const totalCount =
        Number(result.totalCount ?? 0);

    const validCount =
        Number(result.validCount ?? 0);

    const skippedCount =
        Number(result.skippedCount ?? 0);

    importSummary.innerHTML = `
        共 ${totalCount} 筆｜
        <strong style="color:#18794e;">
            正確 ${validCount} 筆
        </strong>｜
        <strong style="color:#b42318;">
            錯誤 ${skippedCount} 筆
        </strong>
    `;

    const items =
        Array.isArray(result.items)
            ? result.items
            : [];

    if (items.length === 0) {
        importPreviewBody.innerHTML = `
            <tr>
                <td
                    colspan="6"
                    style="padding:18px;text-align:center;"
                >
                    沒有可顯示的資料
                </td>
            </tr>
        `;

        return;
    }

    importPreviewBody.innerHTML =
        items
            .map(item => {
                const isValid =
                    item.status === "valid";

                const pointType =
                    item.pointType === "supplement"
                        ? "補點"
                        : item.pointType === "control"
                            ? "圖根點"
                            : "—";

                const resultText =
                    isValid
                        ? "格式正確"
                        : item.message ?? "格式錯誤";

                return `
                    <tr
                        style="
                            border-top:1px solid #e5e7eb;
                            color:${
                                isValid
                                    ? "#20242a"
                                    : "#b42318"
                            };
                        "
                    >
                        <td style="padding:8px;">
                            ${Number(item.lineNumber ?? 0)}
                        </td>

                        <td style="padding:8px;">
                            ${escapeHtml(
                                item.pointName ?? ""
                            )}
                        </td>

                        <td style="padding:8px;">
                            ${
                                item.x == null
                                    ? "—"
                                    : Number(item.x).toFixed(3)
                            }
                        </td>

                        <td style="padding:8px;">
                            ${
                                item.y == null
                                    ? "—"
                                    : Number(item.y).toFixed(3)
                            }
                        </td>

                        <td style="padding:8px;">
                            ${pointType}
                        </td>

                        <td style="padding:8px;">
                            ${escapeHtml(resultText)}
                        </td>
                    </tr>
                `;
            })
            .join("");

    importPointsButton.disabled =
    validCount === 0;
}

async function importCt2Points() {
    if (!currentCt2File) {
        alert("請重新選擇 .ct2 檔案。");
        return;
    }

    const validCount =
        Number(
            currentCt2Preview?.validCount ?? 0
        );

    if (validCount === 0) {
        alert("沒有可匯入的點位。");
        return;
    }

    if (
        !window.confirm(
            `確定匯入 ${validCount} 筆點位？\n`
            + "重複點位會自動略過。"
        )
    ) {
        return;
    }

    const formData =
        new FormData();

    formData.append(
        "file",
        currentCt2File
    );

    importPointsButton.disabled = true;
    importPointsButton.textContent =
        "匯入中……";

    try {
        const response = await fetch(
            "/api/import/ct2/import",
            {
                method: "POST",
                body: formData
            }
        );

        const responseText =
            await response.text();

        let result = null;

        if (responseText) {
            try {
                result =
                    JSON.parse(responseText);
            } catch {
                result = null;
            }
        }

        if (!response.ok) {
            throw new Error(
                result?.message
                ?? result?.detail
                ?? responseText
                ?? `匯入失敗（HTTP ${response.status}）`
            );
        }

        currentCt2Preview = result;

        renderCt2ImportResult(result);

        await loadPoints();

        currentCt2File = null;
        ct2FileInput.value = "";

        showMessage(
            `成功匯入 ${
                Number(result.importedCount ?? 0)
            } 筆點位`
        );
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "匯入點位失敗"
        );

        importPointsButton.disabled = false;
    } finally {
        importPointsButton.textContent =
            "確認匯入";
    }
}

function renderCt2ImportResult(result) {
    const importedCount =
        Number(result.importedCount ?? 0);

    const skippedCount =
        Number(result.skippedCount ?? 0);

    importSummary.innerHTML = `
        <strong style="color:#18794e;">
            成功匯入 ${importedCount} 筆
        </strong>
        ｜
        <strong style="color:#b54708;">
            略過 ${skippedCount} 筆
        </strong>
    `;

    const items =
        Array.isArray(result.items)
            ? result.items
            : [];

    importPreviewBody.innerHTML =
        items.map(item => {
            const xText =
                item.x == null
                    ? "—"
                    : Number(item.x).toFixed(3);

            const yText =
                item.y == null
                    ? "—"
                    : Number(item.y).toFixed(3);

            const pointType =
                item.pointType === "supplement"
                    ? "補點"
                    : "圖根點";

            const color =
                item.status === "imported"
                    ? "#18794e"
                    : item.status === "duplicate"
                        ? "#b54708"
                        : "#b42318";

            return `
                <tr style="
                    border-top:1px solid #e5e7eb;
                    color:${color};
                ">
                    <td style="padding:8px;">
                        ${Number(item.lineNumber ?? 0)}
                    </td>
                    <td style="padding:8px;">
                        ${escapeHtml(item.pointName ?? "")}
                    </td>
                    <td style="padding:8px;">
                        ${xText}
                    </td>
                    <td style="padding:8px;">
                        ${yText}
                    </td>
                    <td style="padding:8px;">
                        ${pointType}
                    </td>
                    <td style="padding:8px;">
                        ${escapeHtml(item.message ?? "")}
                    </td>
                </tr>
            `;
        }).join("");

    importPointsButton.disabled = true;
}
async function loadNotes() {
    try {
        const response =
            await fetch("/api/notes");

        if (!response.ok) {
            throw new Error(
                `讀取備註點位失敗（HTTP ${response.status}）`
            );
        }

        allNotes = await response.json();

        renderNotes();
    } catch (error) {
        console.error(error);

        showMessage(
            error.message ?? "讀取備註點位失敗"
        );
    }
}

function renderNotes() {
    noteLayer.clearLayers();

    for (const note of allNotes) {
        const emoji =
            note.emoji?.trim() || "⭐";

        const icon = L.divIcon({
            className: "",
            html: `
                <div style="
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    width:28px;
                    height:28px;
                    font-size:18px;
                    line-height:1;
                    border:2px solid white;
                    border-radius:50%;
                    background:rgba(255,255,255,.92);
                    box-shadow:0 2px 7px rgba(0,0,0,.35);
                ">
                    ${escapeHtml(emoji)}
                </div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -15]
        });

        const marker = L.marker(
            [
                Number(note.latitude),
                Number(note.longitude)
            ],
            { icon }
        );

        const popup = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = `${emoji} 備註點位`;

        const remark = document.createElement("div");
        remark.style.marginTop = "7px";
        remark.style.whiteSpace = "pre-wrap";
        remark.textContent =
            note.remark?.trim() || "沒有備註";

        const coordinate = document.createElement("div");
        coordinate.style.marginTop = "7px";
        coordinate.style.color = "#68707a";
        coordinate.style.fontSize = "12px";
        coordinate.textContent =
            `X：${Number(note.x).toFixed(3)}　`
            + `Y：${Number(note.y).toFixed(3)}`;

        const editButton =
            document.createElement("button");

        editButton.type = "button";
        editButton.textContent = "編輯備註";
        editButton.style.marginTop = "10px";
        editButton.style.padding = "6px 10px";
        editButton.style.cursor = "pointer";

        editButton.addEventListener(
            "click",
            () => openNoteDialogForEdit(note)
        );

        popup.append(
            title,
            remark,
            coordinate,
            editButton
        );

        marker.bindPopup(popup);
        marker.addTo(noteLayer);
    }
}

function openNoteDialogAt(latlng) {
    const twd97 =
        toTwd97(latlng.lat, latlng.lng);

    editingNoteId = null;

    noteDialogTitle.textContent =
        "新增備註點位";

    noteEmojiInput.value = "⭐";
    noteXInput.value = twd97.x.toFixed(3);
    noteYInput.value = twd97.y.toFixed(3);
    noteRemarkInput.value = "";

    deleteNoteButton.classList.add("hidden");

    noteDialog.showModal();
}

function openNoteDialogForEdit(note) {
    editingNoteId = note.id;

    noteDialogTitle.textContent =
        "編輯備註點位";

    noteEmojiInput.value =
        note.emoji?.trim() || "⭐";

    noteXInput.value =
        Number(note.x).toFixed(3);

    noteYInput.value =
        Number(note.y).toFixed(3);

    noteRemarkInput.value =
        note.remark ?? "";

    deleteNoteButton.classList.remove("hidden");

    map.closePopup();
    noteDialog.showModal();
}

function beginNotePlacement() {
    notePlacementMode = true;
    pointPlacementMode = false;

    closeMobileSidebar();

    map.getContainer().style.cursor =
        "crosshair";

    const isMobilePointer =
        window.matchMedia(
            "(pointer: coarse)"
        ).matches;

    showMessage(
        isMobilePointer
            ? "請在地圖上長按要新增備註的位置"
            : "請在地圖上點選備註位置"
    );
}

async function saveNote() {
    const emoji =
        noteEmojiInput.value.trim() || "⭐";

    const x =
        Number(noteXInput.value);

    const y =
        Number(noteYInput.value);

    const remark =
        noteRemarkInput.value.trim();

    if (
        !Number.isFinite(x)
        || !Number.isFinite(y)
        || x <= 0
        || y <= 0
    ) {
        alert("請輸入正確的 X、Y 座標。");
        return;
    }

    const isEdit =
        editingNoteId !== null;

    const url = isEdit
        ? `/api/notes/${editingNoteId}`
        : "/api/notes";

    saveNoteButton.disabled = true;
    saveNoteButton.textContent = "儲存中……";

    try {
        const response = await fetch(
            url,
            {
                method: isEdit ? "PUT" : "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    emoji,
                    x,
                    y,
                    remark:
                        remark.length === 0
                            ? null
                            : remark
                })
            }
        );

        const responseText =
            await response.text();

        let result = null;

        if (responseText) {
            try {
                result =
                    JSON.parse(responseText);
            } catch {
                result = null;
            }
        }

        if (!response.ok) {
            throw new Error(
                result?.message
                ?? responseText
                ?? `儲存失敗（HTTP ${response.status}）`
            );
        }

        noteDialog.close();

        showMessage(
            isEdit
                ? "備註點位已更新"
                : "備註點位已新增"
        );

        await loadNotes();
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "儲存備註點位失敗"
        );
    } finally {
        saveNoteButton.disabled = false;
        saveNoteButton.textContent = "儲存";
    }
}

async function deleteCurrentNote() {
    if (editingNoteId === null) {
        return;
    }

    if (!window.confirm("確定刪除這個備註點位？")) {
        return;
    }

    deleteNoteButton.disabled = true;

    try {
        const response = await fetch(
            `/api/notes/${editingNoteId}`,
            {
                method: "DELETE"
            }
        );

        if (!response.ok) {
            let message =
                `刪除失敗（HTTP ${response.status}）`;

            try {
                const result =
                    await response.json();

                message =
                    result.message ?? message;
            } catch {
                // 沒有 JSON 錯誤內容時保留原訊息。
            }

            throw new Error(message);
        }

        noteDialog.close();

        showMessage("備註點位已刪除");

        await loadNotes();
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "刪除備註點位失敗"
        );
    } finally {
        deleteNoteButton.disabled = false;
    }
}

function showContextMenu(event) {
    contextLatLng = event.latlng;

    const menuWidth = 220;
    const menuHeight = 145;

    let left =
        event.originalEvent.clientX;

    let top =
        event.originalEvent.clientY;

    if (left + menuWidth > window.innerWidth) {
        left =
            window.innerWidth
            - menuWidth
            - 8;
    }

    if (top + menuHeight > window.innerHeight) {
        top =
            window.innerHeight
            - menuHeight
            - 8;
    }

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;

    contextMenu.classList.remove("hidden");
}

function closeContextMenu() {
    contextMenu.classList.add("hidden");
}

async function copyContextCoordinate() {
    if (!contextLatLng) {
        return;
    }

    const twd97 =
        toTwd97(
            contextLatLng.lat,
            contextLatLng.lng
        );

    const text =
        `X：${twd97.x.toFixed(3)}\n`
        + `Y：${twd97.y.toFixed(3)}`;

    try {
        await navigator.clipboard.writeText(
            text
        );

        showMessage(
            "TWD97 座標已複製"
        );
    } catch {
        window.prompt(
            "請手動複製座標",
            text
        );
    }

    closeContextMenu();
}

function locateCurrentPosition() {
    if (!navigator.geolocation) {
        alert(
            "此裝置不支援定位功能。"
        );

        return;
    }

    showMessage(
        "正在取得目前位置……"
    );

    navigator.geolocation.getCurrentPosition(
        position => {
            const latitude =
                position.coords.latitude;

            const longitude =
                position.coords.longitude;

            map.setView(
                [latitude, longitude],
                18
            );

            const icon = L.divIcon({
                className: "",
                html:
                    '<div class="location-marker"></div>',
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            });

            L.marker(
                [latitude, longitude],
                { icon }
            )
                .addTo(map)
                .bindPopup("目前位置")
                .openPopup();

            closeMobileSidebar();

            showMessage(
                "已定位到目前位置"
            );
        },

        error => {
            console.error(error);

            alert(
                "無法取得目前位置，請確認瀏覽器已允許定位權限。"
            );
        },

        {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 0
        }
    );
}

function openMobileSidebar() {
    sidebar.classList.add("mobile-open");
    screenOverlay.classList.remove("hidden");
}

function closeMobileSidebar() {
    sidebar.classList.remove("mobile-open");
    screenOverlay.classList.add("hidden");
}

const mapContainer =
    map.getContainer();

function cancelMapLongPress() {
    if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }

    longPressStart = null;
}

mapContainer.addEventListener(
    "pointerdown",
    event => {
        if (
    event.pointerType !== "touch"
    || !notePlacementMode
) {
    return;
}

        longPressStart = {
            x: event.clientX,
            y: event.clientY
        };

        longPressTimer = window.setTimeout(
            () => {
                const rect =
                    mapContainer.getBoundingClientRect();

                const containerPoint =
                    L.point(
                        event.clientX - rect.left,
                        event.clientY - rect.top
                    );

                const latlng =
                    map.containerPointToLatLng(
                        containerPoint
                    );

                suppressNextMapClick = true;
                longPressTimer = null;
                longPressStart = null;
                notePlacementMode = false;

                map.getContainer().style.cursor = "";

                if (navigator.vibrate) {
                    navigator.vibrate(40);
                }

                openNoteDialogAt(latlng);
            },
            650
        );
    }
);

mapContainer.addEventListener(
    "pointermove",
    event => {
        if (!longPressStart) {
            return;
        }

        const distance =
            Math.hypot(
                event.clientX - longPressStart.x,
                event.clientY - longPressStart.y
            );

        if (distance > 12) {
            cancelMapLongPress();
        }
    }
);

mapContainer.addEventListener(
    "pointerup",
    cancelMapLongPress
);

mapContainer.addEventListener(
    "pointercancel",
    cancelMapLongPress
);

map.on("mousemove", event => {
    updateCoordinateDisplay(
        event.latlng.lat,
        event.latlng.lng
    );
});

map.on("contextmenu", event => {
    pointPlacementMode = false;
    map.getContainer().style.cursor = "";
    showContextMenu(event);
});

map.on("click", event => {
    closeContextMenu();

    if (suppressNextMapClick) {
        suppressNextMapClick = false;
        return;
    }

    if (notePlacementMode) {
    const requiresLongPress =
        window.matchMedia(
            "(pointer: coarse)"
        ).matches;

    if (requiresLongPress) {
        showMessage(
            "請長按地圖以新增備註點位"
        );

        return;
    }

    notePlacementMode = false;
    map.getContainer().style.cursor = "";

    openNoteDialogAt(event.latlng);
    return;
}

    if (pointPlacementMode) {
        pointPlacementMode = false;
        map.getContainer().style.cursor = "";

        openPointDialog(event.latlng);
    }
});

document.addEventListener("click", event => {
    if (!contextMenu.contains(event.target)) {
        closeContextMenu();
    }
});

document.getElementById(
    "sidebarToggleButton"
).addEventListener("click", () => {
    if (
        sidebar.classList.contains(
            "mobile-open"
        )
    ) {
        closeMobileSidebar();
    } else {
        openMobileSidebar();
    }
});

screenOverlay.addEventListener(
    "click",
    closeMobileSidebar
);

document.getElementById(
    "startAddPointButton"
).addEventListener(
    "click",
    beginPointPlacement
);

document.getElementById(
    "contextAddPointButton"
).addEventListener("click", () => {
    if (contextLatLng) {
        openPointDialog(contextLatLng);
    }

    closeContextMenu();
});

document.getElementById(
    "contextAddNoteButton"
).addEventListener("click", () => {
    if (contextLatLng) {
        openNoteDialogAt(contextLatLng);
    }

    closeContextMenu();
});

document.getElementById(
    "contextCopyCoordinateButton"
).addEventListener(
    "click",
    copyContextCoordinate
);

document.getElementById(
    "addNotePlaceholderButton"
).addEventListener(
    "click",
    beginNotePlacement
);

document.getElementById(
    "importPlaceholderButton"
).addEventListener("click", () => {
    ct2FileInput.value = "";
    ct2FileInput.click();
});

document.getElementById(
    "pointSearchButton"
).addEventListener(
    "click",
    searchPoints
);

document.getElementById(
    "pointSearchInput"
).addEventListener("keydown", event => {
    if (event.key === "Enter") {
        searchPoints();
    }
});

document.getElementById(
    "addressSearchButton"
).addEventListener(
    "click",
    searchAddresses
);

document.getElementById(
    "addressSearchInput"
).addEventListener(
    "keydown",
    event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchAddresses();
        }
    }
);

document.getElementById(
    "savePointButton"
).addEventListener(
    "click",
    savePoint
);

saveNoteButton.addEventListener(
    "click",
    saveNote
);

deleteNoteButton.addEventListener(
    "click",
    deleteCurrentNote
);

document.getElementById(
    "locateButton"
).addEventListener(
    "click",
    locateCurrentPosition
);


function selectStreetBaseMap() {
    if (map.hasLayer(aerialMapLayer)) {
        map.removeLayer(aerialMapLayer);
    }

    if (!map.hasLayer(baseMapLayer)) {
        baseMapLayer.addTo(map);
    }

    baseMapLayer.bringToBack();
}

function selectAerialBaseMap() {
    if (map.hasLayer(baseMapLayer)) {
        map.removeLayer(baseMapLayer);
    }

    if (!map.hasLayer(aerialMapLayer)) {
        aerialMapLayer.addTo(map);
    }

    aerialMapLayer.bringToBack();
}

document.getElementById(
    "baseMapToggle"
).addEventListener(
    "change",
    event => {
        if (event.target.checked) {
            selectStreetBaseMap();
        }
    }
);

document.getElementById(
    "aerialMapToggle"
).addEventListener(
    "change",
    event => {
        if (event.target.checked) {
            selectAerialBaseMap();
        }
    }
);


document.getElementById(
    "controlLayerToggle"
).addEventListener("change", event => {
    if (event.target.checked) {
        controlPointLayer.addTo(map);
    } else {
        map.removeLayer(controlPointLayer);
    }
});

document.getElementById(
    "supplementLayerToggle"
).addEventListener("change", event => {
    if (event.target.checked) {
        supplementPointLayer.addTo(map);
    } else {
        map.removeLayer(supplementPointLayer);
    }
});

document.getElementById(
    "missingLayerToggle"
).addEventListener("change", event => {
    if (event.target.checked) {
        missingPointLayer.addTo(map);
    } else {
        map.removeLayer(missingPointLayer);
    }
});

document.getElementById(
    "noteLayerToggle"
).addEventListener("change", event => {
    if (event.target.checked) {
        noteLayer.addTo(map);
    } else {
        map.removeLayer(noteLayer);
    }
});

document.getElementById(
    "sectionLayerToggle"
).addEventListener("change", async event => {
    if (event.target.checked) {
        if (
            sectionLayer.getLayers().length === 0
        ) {
            await loadSections();
        }

        sectionLayer.addTo(map);
    } else {
        map.removeLayer(sectionLayer);
    }
});

document.getElementById("parcelLayerToggle")?.addEventListener("change", event => {
    if (event.target.checked) {
        parcelLayer.addTo(map);
    } else {
        map.removeLayer(parcelLayer);
    }
});

ct2FileInput.addEventListener(
    "change",
    async () => {
        const file =
            ct2FileInput.files?.[0];

        if (!file) {
            return;
        }

        if (
            !file.name
                .toLowerCase()
                .endsWith(".ct2")
        ) {
            alert("請選擇 .ct2 檔案。");
            ct2FileInput.value = "";
            return;
        }

        await previewCt2File(file);
    }
);

importPointsButton.addEventListener(
    "click",
    importCt2Points
);

chooseAnotherCt2Button.addEventListener(
    "click",
    () => {
        ct2FileInput.value = "";
        ct2FileInput.click();
    }
);

closeImportDialogButton.addEventListener(
    "click",
    () => {
        importDialog.close();
    }
);

cancelImportButton.addEventListener(
    "click",
    () => {
        importDialog.close();
    }
);

window.addEventListener("resize", () => {
    map.invalidateSize();
});

updateCoordinateDisplay(
    initialLatitude,
    initialLongitude
);

loadPoints();
loadNotes();

function openEditDialog(point)
{
    editingPointId = point.id;

    document.getElementById(
        "pointDialogTitle"
    ).textContent = "編輯正式點位";

    document.getElementById(
        "pointNameInput"
    ).value = point.pointName;

    document.getElementById(
        "pointXInput"
    ).value = Number(point.x).toFixed(3);

    document.getElementById(
        "pointYInput"
    ).value = Number(point.y).toFixed(3);

    document.getElementById(
        "pointTypeInput"
    ).value = point.pointType;

    document.getElementById(
        "pointStatusInput"
    ).value = point.status;

    document.getElementById(
        "pointRemarkInput"
    ).value = point.remark ?? "";

    allowDuplicateOnNextSave = false;

    duplicateWarningPanel.classList.add("hidden");
    duplicateWarningPanel.innerHTML = "";

    document.getElementById(
        "savePointButton"
    ).textContent = "儲存";

    pointDialog.showModal();
}

window.editPoint = function(id)
{
    const point =
        allPoints.find(p => p.id === id);

    if (!point)
    {
        return;
    }

    openEditDialog(point);
}

window.deletePoint = async function (id) {
    const point =
        allPoints.find(item => item.id === id);

    if (!point) {
        alert("找不到要刪除的點位。");
        return;
    }

    const confirmed = window.confirm(
        `確定要刪除點位「${point.pointName}」嗎？\n\n刪除後無法復原。`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            `/api/points/${id}`,
            {
                method: "DELETE"
            }
        );

        if (!response.ok) {
            const responseText =
                await response.text();

            let message =
                `刪除失敗（HTTP ${response.status}）`;

            if (responseText) {
                try {
                    const result =
                        JSON.parse(responseText);

                    message =
                        result.message ?? message;
                } catch {
                    message = responseText;
                }
            }

            throw new Error(message);
        }

        map.closePopup();

        showMessage(
            `已刪除點位 ${point.pointName}`
        );

        await loadPoints();
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "刪除點位失敗。"
        );
    }
};

function formatPhotoDate(value) {
    if (!value) {
        return "時間不明";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "時間不明";
    }

    return new Intl.DateTimeFormat(
        "zh-TW",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }
    ).format(date);
}

async function deletePointPhoto(
    pointId,
    photo
) {
    const confirmed = window.confirm(
        `確定要刪除照片「${photo.originalFileName ?? "未命名照片"}」嗎？\n\n刪除後無法復原。`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            `/api/points/${pointId}/photos/${photo.id}`,
            {
                method: "DELETE"
            }
        );

        if (!response.ok) {
            const responseText =
                await response.text();

            let message =
                `照片刪除失敗（HTTP ${response.status}）`;

            if (responseText) {
                try {
                    const result =
                        JSON.parse(responseText);

                    message =
                        result.message ?? message;
                } catch {
                    message = responseText;
                }
            }

            throw new Error(message);
        }

        showMessage("照片已刪除");

        if (
            currentPhotoPointId === pointId
            && photoDialog.open
        ) {
            await loadPointPhotos(pointId);
        }
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "照片刪除失敗"
        );
    }
}

async function loadPointPhotos(pointId) {
    photoList.textContent = "照片載入中...";

    try {
        const response = await fetch(
            `/api/points/${pointId}/photos`
        );

        if (!response.ok) {
            const responseText =
                await response.text();

            let message =
                `照片載入失敗（HTTP ${response.status}）`;

            if (responseText) {
                try {
                    const result =
                        JSON.parse(responseText);

                    message =
                        result.message ?? message;
                } catch {
                    message = responseText;
                }
            }

            throw new Error(message);
        }

        const photos =
            await response.json();

        photoList.innerHTML = "";

        if (photos.length === 0) {
            photoList.textContent =
                "目前尚無照片";
            return;
        }

        for (const photo of photos) {
    const item =
        document.createElement("div");

    item.className = "photo-item";

    const link =
        document.createElement("a");

    link.href = photo.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className =
        "photo-item-image-button";

    link.title =
        photo.originalFileName ?? "查看原圖";

    const image =
        document.createElement("img");

    image.src = photo.url;
    image.alt =
        photo.originalFileName ?? "點位照片";

    image.loading = "lazy";

    const information =
        document.createElement("div");

    information.className =
        "photo-item-info";

    const name =
        document.createElement("div");

    name.className =
        "photo-item-name";

    name.textContent =
    photo.originalFileName
    ?? "未命名照片";

name.title =
    photo.originalFileName
    ?? "未命名照片";

const meta =
    document.createElement("div");

meta.className =
    "photo-item-meta";

meta.textContent =
    `上傳時間：${formatPhotoDate(photo.createdAt)}`;

const deleteButton =
    document.createElement("button");

    deleteButton.type = "button";
    deleteButton.className =
        "photo-delete-button";

    deleteButton.textContent =
        "🗑 刪除照片";

    deleteButton.addEventListener(
        "click",
        async () => {
            deleteButton.disabled = true;
            deleteButton.textContent =
                "刪除中...";

            await deletePointPhoto(
                pointId,
                photo
            );

            if (deleteButton.isConnected) {
                deleteButton.disabled = false;
                deleteButton.textContent =
                    "🗑 刪除照片";
            }
        }
    );

    link.appendChild(image);

    information.appendChild(name);
    information.appendChild(meta);
    information.appendChild(deleteButton);

    item.appendChild(link);
    item.appendChild(information);

    photoList.appendChild(item);
}
    } catch (error) {
        console.error(error);

        photoList.textContent =
            error.message ?? "照片載入失敗";
    }
}

window.showPhotos = async function (pointId) {
    const point =
        allPoints.find(item => item.id === pointId);

    currentPhotoPointId = pointId;

    photoDialogTitle.textContent =
        point
            ? `${point.pointName}－照片`
            : "點位照片";

    photoFileInput.value = "";

    if (!photoDialog.open) {
        photoDialog.showModal();
    }

    await loadPointPhotos(pointId);
};

window.copyPointCoordinate = async function (id) {

    const point =
        allPoints.find(p => p.id === id);

    if (!point) {
        return;
    }

    const text =
         `${Number(point.y).toFixed(3)},${Number(point.x).toFixed(3)}`;

    try {

        await navigator.clipboard.writeText(text);

        showMessage("已複製 TWD97 座標（Y,X）");

    } catch {

        window.prompt(
            "請手動複製：",
            text
        );

    }

};

window.copyPointInfo = async function (id) {
    const point =
        allPoints.find(item => item.id === id);

    if (!point) {
        alert("找不到要複製的點位。");
        return;
    }

    const text = [
        point.pointName,
        getPointTypeName(point.pointType),
        getStatusName(point.status),
        point.sectionName ?? "",
        Number(point.y).toFixed(3),
        Number(point.x).toFixed(3),
        Number(point.longitude).toFixed(8),
        Number(point.latitude).toFixed(8),
        point.remark ?? ""
    ].join("\t");

    try {
        await navigator.clipboard.writeText(text);

        showMessage(
            "已複製，可直接貼到 Excel"
        );
    } catch {
        window.prompt(
            "請手動複製：",
            text
        );
    }
};

window.navigateToPoint = function (id) {
    const point =
        allPoints.find(
            item => item.id === id
        );

    if (!point) {
        alert("找不到這個點位。");
        return;
    }

    const latitude =
        Number(point.latitude);

    const longitude =
        Number(point.longitude);

    if (
        !Number.isFinite(latitude)
        || !Number.isFinite(longitude)
    ) {
        alert("這個點位沒有有效的經緯度。");
        return;
    }

    const destination =
        `${latitude},${longitude}`;

    const googleMapsUrl =
        "https://www.google.com/maps/dir/?" +
        new URLSearchParams({
            api: "1",
            destination,
            travelmode: "driving",
            dir_action: "navigate"
        }).toString();

    const navigationWindow =
        window.open(
            googleMapsUrl,
            "_blank",
            "noopener,noreferrer"
        );

    if (!navigationWindow) {
        window.location.href =
            googleMapsUrl;
    }
};


function closePhotoDialog() {
    if (photoDialog.open) {
        photoDialog.close();
    }

    currentPhotoPointId = null;
    cameraPhotoInput.value = "";
    photoFileInput.value = "";
}

window.closePhotoDialog = closePhotoDialog;

closePhotoDialogButton.addEventListener(
    "click",
    closePhotoDialog
);

cancelPhotoDialogButton.addEventListener(
    "click",
    closePhotoDialog
);

photoDialog.addEventListener(
    "cancel",
    event => {
        event.preventDefault();
        closePhotoDialog();
    }
);

photoDialog.addEventListener(
    "click",
    event => {
        if (event.target === photoDialog) {
            closePhotoDialog();
        }
    }
);

cameraPhotoButton.addEventListener(
    "click",
    () => {
        if (currentPhotoPointId === null) {
            return;
        }

        cameraPhotoInput.value = "";
        cameraPhotoInput.click();
    }
);

uploadPhotoButton.addEventListener(
    "click",
    () => {
        if (currentPhotoPointId === null) {
            return;
        }

        photoFileInput.value = "";
        photoFileInput.click();
    }
);

async function uploadSelectedPhoto(
    inputElement
) {
    if (
        currentPhotoPointId === null
        || inputElement.files.length === 0
    ) {
        return;
    }

    const pointId = currentPhotoPointId;
    const originalFile = inputElement.files[0];

    cameraPhotoButton.disabled = true;
    uploadPhotoButton.disabled = true;

    cameraPhotoButton.textContent =
        "壓縮中……";

    uploadPhotoButton.textContent =
        "壓縮中……";

    try {
        const file = await compressPhotoForUpload(originalFile);
        const formData = new FormData();
        formData.append("file", file);

        cameraPhotoButton.textContent = "上傳中……";
        uploadPhotoButton.textContent = "上傳中……";

        const response = await fetch(
            `/api/points/${pointId}/photos`,
            {
                method: "POST",
                body: formData
            }
        );

        const responseText =
            await response.text();

        let result = {};

        if (responseText) {
            try {
                result =
                    JSON.parse(responseText);
            } catch {
                result = {};
            }
        }

        if (!response.ok) {
            throw new Error(
                result.message
                ?? responseText
                ?? `照片上傳失敗（HTTP ${response.status}）`
            );
        }

        cameraPhotoInput.value = "";
        photoFileInput.value = "";

        await loadPointPhotos(pointId);

        const savedPercent = originalFile.size > 0
            ? Math.max(0, Math.round((1 - file.size / originalFile.size) * 100))
            : 0;
        showMessage(`照片已壓縮並上傳（節省 ${savedPercent}%）`);
    } catch (error) {
        console.error(error);

        alert(
            error.message
            ?? "照片上傳失敗"
        );
    } finally {
        cameraPhotoButton.disabled = false;
        uploadPhotoButton.disabled = false;

        cameraPhotoButton.textContent =
            "📷 開啟相機";

        uploadPhotoButton.textContent =
            "📁 選擇檔案";
    }
}

function populateParcelSectionOptions(geoJson) {
    if (parcelSectionsLoaded) return;
    const select = document.getElementById("parcelSectionSelect");
    if (!select) return;
    const items = (geoJson.features ?? []).map(feature => {
        const p = feature.properties ?? {};
        return {
            code: String(p.sectionCode ?? p.SECTION_COD ?? "").trim(),
            name: String(p.sectionName ?? p.fullName ?? "").trim()
        };
    }).filter(item => item.code && item.name)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    for (const item of items) {
        const option = document.createElement("option");
        option.value = item.code.padStart(4, "0");
        option.textContent = item.name;
        select.appendChild(option);
    }
    parcelSectionsLoaded = true;
}

function normalizeParcelNumber(value) {
    const text = String(value ?? "").trim().replace(/－/g, "-");
    if (!text) return "";
    if (/^\d{8}$/.test(text)) return text;
    const match = text.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    return match[1].padStart(4, "0") + (match[2] || "0").padStart(4, "0");
}

async function loadAndSearchParcels() {
    const sectionCode = document.getElementById("parcelSectionSelect").value;
    const input = document.getElementById("parcelNumberInput").value;
    const status = document.getElementById("parcelStatus");
    if (!sectionCode) {
        status.textContent = "請先選擇地籍段。";
        return;
    }
    const normalized = normalizeParcelNumber(input);
    if (normalized === null) {
        status.textContent = "地號格式不正確，請輸入 123 或 123-1。";
        return;
    }
    try {
        status.textContent = "正在從安全資料庫載入地籍圖……";
        if (loadedParcelSectionCode !== sectionCode) {
            const { data, error } = await window.landSurveySupabase.storage
                .from("cadastral-data").download(`${sectionCode}.geojson`);
            if (error) throw error;
            const geoJson = JSON.parse(await data.text());
            parcelLayer.clearLayers();
            parcelLayer.addData(geoJson);
            loadedParcelSectionCode = sectionCode;
            if (!map.hasLayer(parcelLayer)) parcelLayer.addTo(map);
        }
        let found = null;
        parcelLayer.eachLayer(layer => {
            const raw = String(layer.feature?.properties?.landNoRaw ?? "");
            layer.setStyle?.({ color: "#e87916", weight: 1, fillOpacity: 0.08 });
            if (normalized && raw === normalized) found = layer;
        });
        if (normalized) {
            if (!found) {
                status.textContent = "此地籍段找不到該地號。";
                return;
            }
            found.setStyle?.({ color: "#dc2626", weight: 3, fillOpacity: 0.22 });
            map.fitBounds(found.getBounds(), { maxZoom: 20, padding: [24, 24] });
            found.openPopup();
            status.textContent = "已定位地號。";
        } else {
            map.fitBounds(parcelLayer.getBounds(), { padding: [20, 20] });
            status.textContent = `已載入本段 ${parcelLayer.getLayers().length.toLocaleString()} 筆地籍，可直接點選查看。`;
        }
        closeMobileSidebar();
    } catch (error) {
        console.error(error);
        status.textContent = "地籍資料載入失敗，請確認帳號權限或稍後再試。";
    }
}

document.getElementById("parcelSearchButton")?.addEventListener("click", loadAndSearchParcels);
document.getElementById("parcelNumberInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") loadAndSearchParcels();
});
document.getElementById("parcelClearButton")?.addEventListener("click", () => {
    parcelLayer.clearLayers();
    loadedParcelSectionCode = "";
    document.getElementById("parcelStatus").textContent = "已清除地籍圖。";
});

loadSections();

async function compressPhotoForUpload(file) {
    if (!file.type.startsWith("image/")) {
        throw new Error("請選擇圖片檔案。");
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        // 部分瀏覽器無法直接解碼 HEIC；此時保留原檔，避免照片無法上傳。
        return file;
    }

    const maximumSide = 1280;
    const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const toBlob = quality => new Promise(resolve =>
        canvas.toBlob(resolve, "image/webp", quality)
    );
    let compressed = null;
    for (const quality of [0.62, 0.52, 0.44, 0.36]) {
        compressed = await toBlob(quality);
        if (!compressed || compressed.size <= 250 * 1024) break;
    }

    if (!compressed || compressed.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([compressed], `${baseName}.webp`, {
        type: "image/webp",
        lastModified: Date.now()
    });

const parcelLayer = L.geoJSON(null, {
    style: { color: "#e87916", weight: 1, fillColor: "#fbbf24", fillOpacity: 0.08 },
    onEachFeature(feature, layer) {
        const p = feature.properties ?? {};
        const area = p.registeredArea || p.calculatedArea || "未提供";
        layer.bindPopup(`<strong>${escapeHtml(p.sectionName || "地籍")}</strong><br>地號：${escapeHtml(p.landNo || "未提供")}<br>登記面積：${escapeHtml(String(area))} 平方公尺`);
    }
}).addTo(map);

let loadedParcelSectionCode = "";
let parcelSectionsLoaded = false;
}

cameraPhotoInput.addEventListener(
    "change",
    () => uploadSelectedPhoto(
        cameraPhotoInput
    )
);

photoFileInput.addEventListener(
    "change",
    () => uploadSelectedPhoto(
        photoFileInput
    )
);

closeHistoryDialogButton.addEventListener(
    "click",
    () => {
        historyDialog.close();
    }
);

cancelHistoryDialogButton.addEventListener(
    "click",
    () => {
        historyDialog.close();
    }
);

function tryAutoLocateOnMobile() {
    const isMobile =
        window.matchMedia(
            "(pointer: coarse)"
        ).matches;

    if (!isMobile) {
        return;
    }

    if (!navigator.geolocation) {
        return;
    }

    // 同一個瀏覽器分頁只自動定位一次
    if (
        sessionStorage.getItem(
            "mobileAutoLocated"
        ) === "true"
    ) {
        return;
    }

    // 手機定位正式上線時必須使用 HTTPS
    if (
        !window.isSecureContext
        && location.hostname !== "localhost"
    ) {
        console.warn(
            "手機自動定位需要 HTTPS。"
        );

        return;
    }

    sessionStorage.setItem(
        "mobileAutoLocated",
        "true"
    );

    locateCurrentPosition();
}

window.addEventListener(
    "load",
    () => {
        window.setTimeout(
            tryAutoLocateOnMobile,
            800
        );
    }
);
