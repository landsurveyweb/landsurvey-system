import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const message = document.getElementById("authMessage");
if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    message.textContent = "請先依 README 設定 Supabase。";
    throw new Error("Supabase 尚未設定");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const returnUrl = new URLSearchParams(location.search).get("return") || "./";
const setBusy = value => document.querySelectorAll("button").forEach(button => button.disabled = value);

document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(true);
    message.textContent = "登入中…";
    const { error } = await supabase.auth.signInWithPassword({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value
    });
    setBusy(false);
    if (error) message.textContent = error.message;
    else location.replace(returnUrl);
});

document.getElementById("signupButton").addEventListener("click", async () => {
    const displayName = document.getElementById("displayName").value.trim();
    if (!displayName) {
        message.textContent = "建立帳號時請填寫顯示名稱。";
        return;
    }
    setBusy(true);
    message.textContent = "建立帳號中…";
    const { data, error } = await supabase.auth.signUp({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
        options: { data: { display_name: displayName } }
    });
    setBusy(false);
    if (error) message.textContent = error.message;
    else if (data.session) location.replace(returnUrl);
    else message.textContent = "帳號已建立，請到信箱完成驗證後登入。";
});

