import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const message = document.getElementById("adminMessage");
const list = document.getElementById("memberList");
const { data: { session } } = await supabase.auth.getSession();
if (!session) location.replace("./login.html?return=" + encodeURIComponent("/landsurvey-system/admin.html"));

const { data: me } = await supabase.from("profiles").select("role,is_active").eq("id", session.user.id).single();
if (me?.role !== "admin" || !me?.is_active) location.replace("./");

const formatDate = value => value ? new Date(value).toLocaleString("zh-TW") : "-";

async function loadMembers() {
    message.textContent = "載入會員中…";
    const { data, error } = await supabase.rpc("admin_list_members");
    if (error) { message.textContent = error.message; return; }
    list.innerHTML = "";
    for (const member of data) {
        const row = document.createElement("tr");
        row.innerHTML = `<td><input aria-label="顯示名稱"></td><td class="member-email"></td><td><select aria-label="角色"><option value="member">一般會員</option><option value="admin">管理員</option></select></td><td class="${member.is_active ? 'status-active' : 'status-disabled'}">${member.is_active ? '使用中' : '已停用'}</td><td>${formatDate(member.created_at)}</td><td><button class="save-member" type="button">儲存資料</button> <button class="toggle-member" type="button">${member.is_active ? '停用' : '啟用'}</button></td>`;
        const name = row.querySelector("input"), role = row.querySelector("select"), saveButton = row.querySelector(".save-member"), toggleButton = row.querySelector(".toggle-member");
        name.value = member.display_name;
        row.querySelector(".member-email").textContent = member.email;
        role.value = member.role;
        const updateMember = async active => {
            saveButton.disabled = toggleButton.disabled = true;
            const { error: updateError } = await supabase.rpc("admin_update_member", { target_id: member.id, new_display_name: name.value.trim(), new_role: role.value, new_is_active: active });
            saveButton.disabled = toggleButton.disabled = false;
            message.textContent = updateError ? updateError.message : "會員資料已更新。";
            if (!updateError) loadMembers();
        };
        saveButton.addEventListener("click", () => updateMember(member.is_active));
        toggleButton.addEventListener("click", () => updateMember(!member.is_active));
        list.appendChild(row);
    }
    message.textContent = `共 ${data.length} 位會員。`;
}

loadMembers();
