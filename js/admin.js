import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const message = document.getElementById("adminMessage");
const list = document.getElementById("memberList");
const { data: { session } } = await supabase.auth.getSession();
if (!session) location.replace("./login.html?return=" + encodeURIComponent("/landsurvey-system/admin.html"));

const callAdmin = async (action, payload = {}) => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "管理操作失敗");
    return result;
};

const formatDate = value => value ? new Date(value).toLocaleString("zh-TW") : "-";

document.getElementById("createMemberForm").addEventListener("submit", async event => {
    event.preventDefault();
    message.textContent = "正在建立會員…";
    try {
        await callAdmin("create", {
            username: document.getElementById("newUsername").value.trim(),
            displayName: document.getElementById("newDisplayName").value.trim(),
            password: document.getElementById("newPassword").value
        });
        event.target.reset();
        message.textContent = "會員已建立。";
        await loadMembers();
    } catch (error) { message.textContent = error.message; }
});

async function loadMembers() {
    message.textContent = "載入會員中…";
    try {
        const { members } = await callAdmin("list");
        list.innerHTML = "";
        for (const member of members) {
            const row = document.createElement("tr");
            row.innerHTML = `<td><input aria-label="顯示名稱"></td><td class="member-account"></td><td><select aria-label="角色"><option value="member">一般會員</option><option value="admin">管理員</option></select></td><td class="${member.isActive ? 'status-active' : 'status-disabled'}">${member.isActive ? '使用中' : '已停用'}</td><td>${formatDate(member.createdAt)}</td><td><button class="save-member" type="button">儲存</button> <button class="toggle-member" type="button">${member.isActive ? '停用' : '啟用'}</button> <button class="password-button" type="button">重設密碼</button> <button class="danger-button" type="button">刪除</button></td>`;
            const name = row.querySelector("input"), role = row.querySelector("select"), buttons = row.querySelectorAll("button");
            name.value = member.displayName;
            row.querySelector(".member-account").textContent = member.username || member.email;
            role.value = member.role;
            buttons[0].onclick = () => updateMember(member, name.value, role.value, member.isActive);
            buttons[1].onclick = () => updateMember(member, name.value, role.value, !member.isActive);
            buttons[2].onclick = () => resetPassword(member);
            buttons[3].onclick = () => deleteMember(member);
            list.appendChild(row);
        }
        message.textContent = `共 ${members.length} 位會員。`;
    } catch (error) { message.textContent = error.message; }
}

async function updateMember(member, displayName, role, isActive) {
    try { await callAdmin("update", { userId: member.id, displayName, role, isActive }); await loadMembers(); }
    catch (error) { message.textContent = error.message; }
}

async function resetPassword(member) {
    const password = prompt(`請輸入「${member.username || member.email}」的新密碼（至少 8 碼）：`);
    if (!password) return;
    try { await callAdmin("reset-password", { userId: member.id, password }); message.textContent = "密碼已重設。"; }
    catch (error) { message.textContent = error.message; }
}

async function deleteMember(member) {
    if (!confirm(`確定永久刪除帳號「${member.username || member.email}」嗎？`)) return;
    try { await callAdmin("delete", { userId: member.id }); await loadMembers(); }
    catch (error) { message.textContent = error.message; }
}

loadMembers();
