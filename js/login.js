import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const message = document.getElementById("authMessage");
if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
    message.textContent = "請先依 README 設定 Supabase。";
    throw new Error("Supabase 尚未設定");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const returnUrl = new URLSearchParams(location.search).get("return") || "./";
const siteRoot = new URL("./", location.href).href;
const setBusy = value => document.querySelectorAll("button").forEach(button => button.disabled = value);
const getEmail = () => document.getElementById("email").value.trim();

document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(true);
    message.textContent = "登入中…";
    const { error } = await supabase.auth.signInWithPassword({
        email: getEmail(),
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
        email: getEmail(),
        password: document.getElementById("password").value,
        options: {
            data: { display_name: displayName },
            emailRedirectTo: siteRoot
        }
    });
    setBusy(false);
    if (error) message.textContent = error.message;
    else if (data.session) location.replace(returnUrl);
    else message.textContent = "帳號已建立，請到信箱完成驗證後登入。";
});

document.getElementById("forgotPasswordButton").addEventListener("click", async () => {
    const email = getEmail();
    if (!email) {
        message.textContent = "請先填寫電子郵件。";
        return;
    }
    setBusy(true);
    message.textContent = "正在寄送密碼重設信…";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL("./reset-password.html", location.href).href
    });
    setBusy(false);
    message.textContent = error ? error.message : "密碼重設信已寄出，請到信箱查看。";
});

document.getElementById("resendButton").addEventListener("click", async () => {
    const email = getEmail();
    if (!email) {
        message.textContent = "請先填寫電子郵件。";
        return;
    }
    setBusy(true);
    message.textContent = "正在重新寄送驗證信…";
    const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: siteRoot }
    });
    setBusy(false);
    message.textContent = error ? error.message : "新的驗證信已寄出，請到信箱查看。";
});
