import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const message = document.getElementById("authMessage");
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const returnUrl = new URLSearchParams(location.search).get("return") || "./";
if (new URLSearchParams(location.search).get("disabled") === "1") message.textContent = "此帳號已停用，請聯絡管理員。";

document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("loginButton");
    const username = document.getElementById("username").value.trim().toLowerCase();
    const email = username.includes("@") ? username : `${username}@accounts.landsurvey.invalid`;
    button.disabled = true;
    message.textContent = "登入中…";
    const { error } = await supabase.auth.signInWithPassword({
        email,
        password: document.getElementById("password").value
    });
    button.disabled = false;
    message.textContent = error ? "帳號或密碼不正確。" : "";
    if (!error) location.replace(returnUrl);
});
