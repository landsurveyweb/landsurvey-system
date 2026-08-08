import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const form = document.getElementById("resetForm");
const message = document.getElementById("authMessage");
const button = document.getElementById("resetButton");

const { data: { session } } = await supabase.auth.getSession();
if (session) message.textContent = "連結有效，請設定新密碼。";
else message.textContent = "重設連結無效或已過期，請回登入頁重新申請。";

form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = document.getElementById("newPassword").value;
    const confirmation = document.getElementById("confirmPassword").value;
    if (password !== confirmation) {
        message.textContent = "兩次輸入的密碼不相同。";
        return;
    }
    button.disabled = true;
    message.textContent = "正在更新密碼…";
    const { error } = await supabase.auth.updateUser({ password });
    button.disabled = false;
    if (error) message.textContent = error.message;
    else {
        message.textContent = "密碼已更新，正在返回系統…";
        setTimeout(() => location.replace("./"), 800);
    }
});
