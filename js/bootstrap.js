import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { installApiAdapter } from "./supabase-api.js";

if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    document.body.innerHTML = `<main style="max-width:720px;margin:8vh auto;padding:24px;font-family:system-ui;line-height:1.7">
        <h1>網站尚未連接 Supabase</h1>
        <p>請先依照 README 建立免費專案，然後在 <code>js/config.js</code> 填入 Project URL 與 anon key。</p>
    </main>`;
    throw new Error("Supabase 尚未設定");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const { data: { session } } = await supabase.auth.getSession();
if (!session) {
    location.replace(`./login.html?return=${encodeURIComponent(location.pathname + location.search)}`);
    throw new Error("尚未登入");
}

const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, role, is_active")
    .eq("id", session.user.id)
    .single();
if (profileError || !profile?.is_active) {
    await supabase.auth.signOut();
    location.replace("./login.html?disabled=1");
    throw new Error("帳號已停用或會員資料無法讀取");
}

window.landSurveySupabase = supabase;
window.landSurveyCurrentUser = { isAdmin: profile.role === "admin", id: session.user.id };
document.getElementById("currentUserName").textContent = profile.display_name || session.user.email || "使用者";
document.getElementById("adminLink").hidden = profile.role !== "admin";

document.getElementById("logoutButton").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.replace("./login.html");
});

installApiAdapter(supabase, session.user);

await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./js/map.js?v=202608191145";
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
});

const syncStatus = document.getElementById("syncStatus");
const refreshSharedData = () => {
    window.clearTimeout(window.__landSurveyRefreshTimer);
    window.__landSurveyRefreshTimer = window.setTimeout(() => {
        window.loadPoints?.();
        window.loadNotes?.();
        window.loadTraverses?.();
    }, 200);
};

supabase.channel("landsurvey-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "survey_points" }, refreshSharedData)
    .on("postgres_changes", { event: "*", schema: "public", table: "map_notes" }, refreshSharedData)
    .on("postgres_changes", { event: "*", schema: "public", table: "traverse_routes" }, refreshSharedData)
    .on("postgres_changes", { event: "*", schema: "public", table: "traverse_route_points" }, refreshSharedData)
    .subscribe(status => {
        syncStatus.textContent = status === "SUBSCRIBED" ? "● 已同步" : "○ 連線中";
    });
